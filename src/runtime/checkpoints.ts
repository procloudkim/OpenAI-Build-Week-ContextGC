import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { posix, resolve, win32 } from "node:path";

import { ContentArchive } from "./archive.js";
import { RuntimeCapacityError, RuntimeIntegrityError, RuntimeNotFoundError } from "./errors.js";
import { atomicWriteFile, isRecord, sha256 } from "./io.js";
import { redactJson, redactText } from "./redaction.js";
import type {
  CheckpointManifest,
  ContentRef,
  PersistableTaskFrame,
  RestoredCheckpoint,
  RuntimePaths,
  JsonObject,
  StoredTaskFrame,
  StoredTaskFrameFields,
} from "./types.js";

export const CHECKPOINT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_CHECKPOINT_FRAME_BYTES = 256 * 1024;
export const MAX_CHECKPOINT_MANIFEST_BYTES = 64 * 1024;
export const MAX_LATEST_POINTER_BYTES = 4 * 1024;
export const CHECKPOINT_PRIVACY_BOUNDARY = "deterministic-minimization-v1" as const;

export type LatestCheckpointPointer =
  | { readonly status: "missing"; readonly checkpointId: null }
  | { readonly status: "invalid"; readonly checkpointId: null }
  | { readonly status: "valid"; readonly checkpointId: string };

export class CheckpointStore {
  readonly paths: RuntimePaths;
  readonly archive: ContentArchive;

  constructor(paths: RuntimePaths, archive: ContentArchive) {
    this.paths = paths;
    this.archive = archive;
  }

  async init(): Promise<void> {
    await this.#initStorage();

    const latest = await this.inspectLatest();
    if (latest.status !== "valid") return;
    try {
      const restored = await this.read(latest.checkpointId);
      await this.#writeTaskFrameMirror(restored.frame);
    } catch (error) {
      // Initialization must never inject or mirror an invalid latest frame, but
      // it also must not block an explicit restore or a strict successor.
      if (isRecoverableLatestError(error)) return;
      throw error;
    }
  }

  async #initStorage(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.root, { recursive: true }),
      mkdir(this.paths.checkpoints, { recursive: true }),
      this.archive.init(),
    ]);
  }

  async create<TFrame extends PersistableTaskFrame>(
    frame: TFrame,
    options: { readonly reason?: string; readonly sourceSessionId?: string } = {},
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    // A strict new checkpoint must remain a recovery path when latest points
    // to a pre-privacy-boundary checkpoint. Do not mirror or inject that
    // legacy frame while preparing its marked successor.
    await this.#initStorage();
    const previousMirror = await this.#readMirrorForRollback();
    const checkpointId = randomUUID();
    const createdAt = new Date().toISOString();
    const parentCheckpointId = await this.#verifiedParentCheckpointId();
    const normalized = normalizeFrame(frame, checkpointId, createdAt);
    const unredactedBytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
    if (unredactedBytes > MAX_CHECKPOINT_FRAME_BYTES) {
      throw new RuntimeCapacityError(
        `Task frame is ${unredactedBytes} bytes; maximum is ${MAX_CHECKPOINT_FRAME_BYTES} bytes`,
      );
    }
    const redacted = redactJson(normalized as unknown as JsonObject);
    const serialized = `${JSON.stringify(redacted.value, null, 2)}\n`;
    const serializedBytes = Buffer.from(serialized, "utf8");
    if (serializedBytes.byteLength > MAX_CHECKPOINT_FRAME_BYTES) {
      throw new RuntimeCapacityError(
        `Redacted Task frame is ${serializedBytes.byteLength} bytes; maximum is ${MAX_CHECKPOINT_FRAME_BYTES} bytes`,
      );
    }
    const storedRef = await this.archive.put(serialized);
    if (storedRef.bytes !== serializedBytes.byteLength || storedRef.hash !== sha256(serializedBytes)) {
      throw new RuntimeIntegrityError("Task frame archive bytes changed after deterministic redaction");
    }
    const frameRef: ContentRef = {
      ...storedRef,
      secretScanStatus: redacted.count > 0 ? "sanitized" : "clean",
      sanitized: redacted.count > 0,
      redactions: redacted.count,
    };
    const manifest: CheckpointManifest = {
      schemaVersion: 1,
      privacyBoundary: CHECKPOINT_PRIVACY_BOUNDARY,
      checkpointId,
      parentCheckpointId,
      createdAt,
      frameRef,
      reason: options.reason === undefined ? null : redactText(options.reason).value,
      sourceSessionId:
        options.sourceSessionId === undefined ? null : hashSessionId(options.sourceSessionId),
    };
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestBytes = Buffer.byteLength(serializedManifest, "utf8");
    if (manifestBytes > MAX_CHECKPOINT_MANIFEST_BYTES) {
      throw new RuntimeCapacityError(
        `Checkpoint manifest is ${manifestBytes} bytes; maximum is ${MAX_CHECKPOINT_MANIFEST_BYTES} bytes`,
      );
    }

    const temporary = resolve(this.paths.checkpoints, `.${checkpointId}.${randomUUID()}.tmp`);
    const destination = this.#checkpointPath(checkpointId);
    await mkdir(temporary, { recursive: false });
    try {
      await atomicWriteFile(resolve(temporary, "task-frame.json"), serialized);
      await atomicWriteFile(resolve(temporary, "manifest.json"), serializedManifest);
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }

    await this.#publishLatest(checkpointId, redacted.value, previousMirror);
    return { manifest, frame: redacted.value as unknown as StoredTaskFrame<TFrame> };
  }

  async read<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(
    checkpointId: string,
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const checkpointPath = this.#checkpointPath(checkpointId);
    let manifestBytes: Buffer;
    let frameBytes: Buffer;
    try {
      [manifestBytes, frameBytes] = await Promise.all([
        readBoundedRegularFile(
          resolve(checkpointPath, "manifest.json"),
          MAX_CHECKPOINT_MANIFEST_BYTES,
          "Checkpoint manifest",
        ),
        readBoundedRegularFile(
          resolve(checkpointPath, "task-frame.json"),
          MAX_CHECKPOINT_FRAME_BYTES,
          "Checkpoint Task Frame",
        ),
      ]);
    } catch (error) {
      if (isNotFound(error)) {
        throw new RuntimeNotFoundError(`Checkpoint ${checkpointId} does not exist`);
      }
      throw error;
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestBytes.toString("utf8")) as unknown;
    } catch {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} has an invalid manifest`);
    }

    if (!isCheckpointManifest(manifestValue) || manifestValue.checkpointId !== checkpointId) {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} has an invalid manifest`);
    }
    if (frameBytes.byteLength !== manifestValue.frameRef.bytes || sha256(frameBytes) !== manifestValue.frameRef.hash) {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} task frame failed its integrity check`);
    }

    let frame: unknown;
    try {
      frame = JSON.parse(frameBytes.toString("utf8")) as unknown;
    } catch {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} task frame is not valid JSON`);
    }
    if (!isStoredTaskFrame(frame, manifestValue)) {
      throw new RuntimeIntegrityError(
        `Checkpoint ${checkpointId} task frame is not hook-loadable or does not match its manifest`,
      );
    }

    // Verify the second copy as well. It detects archive tampering before rehydration.
    await this.archive.get(manifestValue.frameRef);
    return { manifest: manifestValue, frame: frame as StoredTaskFrame<TFrame> };
  }

  async readWithMirror<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(
    checkpointId: string,
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const restored = await this.read<TFrame>(checkpointId);
    let mirrorBytes: Buffer;
    try {
      mirrorBytes = await readBoundedRegularFile(
        this.paths.taskFrame,
        MAX_CHECKPOINT_FRAME_BYTES,
        "Task Frame mirror",
      );
    } catch {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} Task Frame mirror is unavailable`);
    }
    if (
      mirrorBytes.byteLength !== restored.manifest.frameRef.bytes ||
      sha256(mirrorBytes) !== restored.manifest.frameRef.hash
    ) {
      throw new RuntimeIntegrityError(`Checkpoint ${checkpointId} Task Frame mirror failed its integrity check`);
    }
    return restored;
  }

  async restore<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(
    checkpointId?: string,
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const target = checkpointId ?? (await this.getLatestId());
    if (target === null) {
      throw new RuntimeNotFoundError("No checkpoint exists to restore");
    }
    const previousMirror = await this.#readMirrorForRollback();
    const restored = await this.read<TFrame>(target);
    await this.#publishLatest(target, restored.frame, previousMirror);
    return restored;
  }

  async rollback<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(): Promise<
    RestoredCheckpoint<StoredTaskFrame<TFrame>>
  > {
    const currentId = await this.getLatestId();
    if (currentId === null) {
      throw new RuntimeNotFoundError("No checkpoint exists to roll back");
    }
    const current = await this.read(currentId);
    if (current.manifest.parentCheckpointId === null) {
      throw new RuntimeNotFoundError(`Checkpoint ${currentId} has no parent`);
    }
    return this.restore<TFrame>(current.manifest.parentCheckpointId);
  }

  async getLatestId(): Promise<string | null> {
    const latest = await this.inspectLatest();
    if (latest.status === "invalid") {
      throw new RuntimeIntegrityError("Latest checkpoint pointer has an unknown schema");
    }
    return latest.checkpointId;
  }

  async inspectLatest(): Promise<LatestCheckpointPointer> {
    let bytes: Buffer;
    try {
      bytes = await readBoundedRegularFile(
        this.paths.latest,
        MAX_LATEST_POINTER_BYTES,
        "Latest checkpoint pointer",
      );
    } catch (error) {
      if (isNotFound(error)) return { status: "missing", checkpointId: null };
      return { status: "invalid", checkpointId: null };
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      return { status: "invalid", checkpointId: null };
    }
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      typeof value.checkpointId !== "string" ||
      !isCheckpointId(value.checkpointId)
    ) {
      return { status: "invalid", checkpointId: null };
    }
    return { status: "valid", checkpointId: value.checkpointId };
  }

  #checkpointPath(checkpointId: string): string {
    if (!isCheckpointId(checkpointId)) {
      throw new RuntimeIntegrityError("Checkpoint id has an invalid format");
    }
    return resolve(this.paths.checkpoints, checkpointId);
  }

  async #writeLatest(checkpointId: string): Promise<void> {
    await atomicWriteFile(
      this.paths.latest,
      `${JSON.stringify({ schemaVersion: 1, checkpointId }, null, 2)}\n`,
    );
  }

  async #writeTaskFrameMirror(frame: PersistableTaskFrame): Promise<void> {
    await atomicWriteFile(this.paths.taskFrame, `${JSON.stringify(frame, null, 2)}\n`);
  }

  async #verifiedParentCheckpointId(): Promise<string | null> {
    const latest = await this.inspectLatest();
    if (latest.status !== "valid") return null;
    try {
      await this.read(latest.checkpointId);
      return latest.checkpointId;
    } catch (error) {
      if (isRecoverableLatestError(error)) return null;
      throw error;
    }
  }

  async #readMirrorForRollback(): Promise<Buffer | null> {
    try {
      const details = await stat(this.paths.taskFrame);
      if (!details.isFile() || details.size > MAX_CHECKPOINT_FRAME_BYTES) {
        throw new RuntimeIntegrityError("Task Frame mirror is not a bounded regular file");
      }
      const bytes = await readFile(this.paths.taskFrame);
      if (bytes.byteLength > MAX_CHECKPOINT_FRAME_BYTES) {
        throw new RuntimeIntegrityError("Task Frame mirror changed beyond its bounded contract");
      }
      return bytes;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async #publishLatest(
    checkpointId: string,
    frame: PersistableTaskFrame,
    previousMirror: Buffer | null,
  ): Promise<void> {
    await this.#writeTaskFrameMirror(frame);
    try {
      await this.#writeLatest(checkpointId);
    } catch (error) {
      try {
        if (previousMirror === null) {
          await rm(this.paths.taskFrame, { force: true });
        } else {
          await atomicWriteFile(this.paths.taskFrame, previousMirror);
        }
      } catch {
        throw new RuntimeIntegrityError(
          "Latest checkpoint publication failed and Task Frame mirror rollback was incomplete",
        );
      }
      throw error;
    }
  }
}

function isRecoverableLatestError(error: unknown): boolean {
  return error instanceof RuntimeIntegrityError || error instanceof RuntimeNotFoundError;
}

async function readBoundedRegularFile(
  path: string,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const details = await stat(path);
  if (!details.isFile() || details.size > maxBytes) {
    throw new RuntimeIntegrityError(`${label} is not a bounded regular file`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes) {
    throw new RuntimeIntegrityError(`${label} changed beyond its bounded contract`);
  }
  return bytes;
}

const TASK_FRAME_ARRAY_KEYS = [
  "constraints",
  "decisions",
  "openLoops",
  "activeFiles",
  "testEvidence",
  "failedAttempts",
  "evidencePointers",
] as const satisfies readonly (keyof StoredTaskFrameFields)[];

const TASK_FRAME_STORED_KEYS = new Set<string>([
  "schemaVersion",
  "checkpointId",
  "createdAt",
  "goal",
  ...TASK_FRAME_ARRAY_KEYS,
]);

function normalizeFrame<TFrame extends PersistableTaskFrame>(
  frame: TFrame,
  checkpointId: string,
  createdAt: string,
): StoredTaskFrame<TFrame> {
  if (!isRecord(frame)) {
    throw new TypeError("Task frame must be a JSON object");
  }
  const value = frame;
  if (typeof value.goal !== "string" || value.goal.trim() === "") {
    throw new TypeError("Task frame goal must be a non-empty string");
  }

  const arrays = {} as Record<(typeof TASK_FRAME_ARRAY_KEYS)[number], readonly string[]>;
  for (const key of TASK_FRAME_ARRAY_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) {
      arrays[key] = [];
      continue;
    }
    if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "string")) {
      throw new TypeError(`Task frame ${key} must be an array of strings`);
    }
    arrays[key] = candidate;
  }

  assertSafeFrameReferences("activeFiles", arrays.activeFiles);
  assertSafeFrameReferences("evidencePointers", arrays.evidencePointers);

  return {
    schemaVersion: 1,
    checkpointId,
    createdAt,
    goal: value.goal,
    constraints: arrays.constraints,
    decisions: arrays.decisions,
    openLoops: arrays.openLoops,
    activeFiles: arrays.activeFiles,
    testEvidence: arrays.testEvidence,
    failedAttempts: arrays.failedAttempts,
    evidencePointers: arrays.evidencePointers,
  } satisfies StoredTaskFrame<TFrame>;
}

function isStoredTaskFrame(value: unknown, manifest: CheckpointManifest): value is StoredTaskFrame {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.checkpointId === manifest.checkpointId &&
    value.createdAt === manifest.createdAt &&
    typeof value.goal === "string" &&
    Object.keys(value).length === TASK_FRAME_STORED_KEYS.size &&
    Object.keys(value).every((key) => TASK_FRAME_STORED_KEYS.has(key)) &&
    TASK_FRAME_ARRAY_KEYS.every(
      (key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === "string"),
    )
  );
}

function isCheckpointManifest(value: unknown): value is CheckpointManifest {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.privacyBoundary === CHECKPOINT_PRIVACY_BOUNDARY &&
    typeof value.checkpointId === "string" &&
    isCheckpointId(value.checkpointId) &&
    (value.parentCheckpointId === null ||
      (typeof value.parentCheckpointId === "string" && isCheckpointId(value.parentCheckpointId))) &&
    typeof value.createdAt === "string" &&
    isContentRef(value.frameRef) &&
    (value.reason === null || typeof value.reason === "string") &&
    (value.sourceSessionId === null ||
      (typeof value.sourceSessionId === "string" && /^sha256:[a-f0-9]{64}$/.test(value.sourceSessionId)))
  );
}

function hashSessionId(sourceSessionId: string): `sha256:${string}` {
  return `sha256:${sha256(Buffer.from(sourceSessionId, "utf8"))}`;
}

function assertSafeFrameReferences(
  field: "activeFiles" | "evidencePointers",
  values: readonly string[],
): void {
  for (const value of values) {
    if (value.trim() === "") {
      throw new TypeError(`Task frame ${field} must not contain an empty reference`);
    }
    if (field === "activeFiles" && !isSafeRepositoryRelativePath(value)) {
      throw new TypeError(`Task frame ${field} must not contain an absolute or traversing local path`);
    }
    if (field === "evidencePointers" && isRemoteUrl(value)) {
      continue;
    }
    if (isUnsafeLocalReference(value)) {
      throw new TypeError(`Task frame ${field} must not contain an absolute or traversing local path`);
    }
  }
}

function isSafeRepositoryRelativePath(value: string): boolean {
  if (isUnsafeLocalReference(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    return false;
  }
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isUnsafeLocalReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    posix.isAbsolute(trimmed) ||
    win32.isAbsolute(trimmed) ||
    /^[A-Za-z]:/.test(trimmed) ||
    /^file(?::|%3a)/i.test(trimmed) ||
    /^~(?:[\\/]|$)/.test(trimmed) ||
    /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(trimmed)
  );
}

export function isCheckpointId(value: string): boolean {
  return CHECKPOINT_ID_PATTERN.test(value);
}

function isContentRef(value: unknown): value is ContentRef {
  return (
    isRecord(value) &&
    value.algorithm === "sha256" &&
    typeof value.hash === "string" &&
    /^[a-f0-9]{64}$/.test(value.hash) &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    (value.mediaType === "application/octet-stream" || value.mediaType === "text/plain; charset=utf-8") &&
    (value.secretScanStatus === "clean" ||
      value.secretScanStatus === "sanitized" ||
      value.secretScanStatus === "unscanned") &&
    typeof value.sanitized === "boolean" &&
    typeof value.redactions === "number" &&
    Number.isSafeInteger(value.redactions) &&
    value.redactions >= 0 &&
    ((value.secretScanStatus === "clean" &&
      value.mediaType === "text/plain; charset=utf-8" &&
      value.sanitized === false &&
      value.redactions === 0) ||
      (value.secretScanStatus === "sanitized" &&
        value.mediaType === "text/plain; charset=utf-8" &&
        value.sanitized === true &&
        value.redactions > 0) ||
      (value.secretScanStatus === "unscanned" &&
        value.mediaType === "application/octet-stream" &&
        value.sanitized === false &&
        value.redactions === 0))
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
