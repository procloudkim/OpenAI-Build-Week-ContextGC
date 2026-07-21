import { access, readdir } from "node:fs/promises";

import { ContentArchive } from "./archive.js";
import { CheckpointStore, isCheckpointId } from "./checkpoints.js";
import { RuntimeIntegrityError, RuntimeNotFoundError } from "./errors.js";
import { sha256 } from "./io.js";
import { JsonlLedger } from "./ledger.js";
import { resolveRuntimePaths, type ResolveRuntimePathsOptions } from "./paths.js";
import { readCodexTranscriptTelemetry } from "./telemetry.js";
import type {
  ContentRef,
  JsonObject,
  JsonValue,
  LedgerRecord,
  PersistableTaskFrame,
  RehydrationResult,
  RestoredCheckpoint,
  RuntimePaths,
  RuntimeStatus,
  StoredTaskFrame,
  TranscriptTelemetry,
} from "./types.js";

export type ContextGcRuntimeOptions = ResolveRuntimePathsOptions;

export class ContextGcRuntime {
  readonly paths: RuntimePaths;
  readonly ledger: JsonlLedger;
  readonly archive: ContentArchive;
  readonly checkpoints: CheckpointStore;

  constructor(options: ContextGcRuntimeOptions = {}) {
    this.paths = resolveRuntimePaths(options);
    this.ledger = new JsonlLedger(this.paths.ledger);
    this.archive = new ContentArchive(this.paths.archive);
    this.checkpoints = new CheckpointStore(this.paths, this.archive);
  }

  async init(): Promise<void> {
    await Promise.all([this.ledger.init(), this.checkpoints.init()]);
  }

  async appendEvent<TPayload extends JsonValue>(
    type: string,
    payload: TPayload,
  ): Promise<LedgerRecord<TPayload>> {
    return this.ledger.append(type, payload);
  }

  async archiveContent(content: string | Uint8Array): Promise<ContentRef> {
    await this.archive.init();
    const ref = await this.archive.put(content);
    await this.ledger.append("content-archived", {
      hash: ref.hash,
      bytes: ref.bytes,
      mediaType: ref.mediaType,
      secretScanStatus: ref.secretScanStatus,
      sanitized: ref.sanitized,
      redactions: ref.redactions,
    });
    return ref;
  }

  async rehydrate(
    refs: readonly ContentRef[],
    options: { readonly maxBytes?: number; readonly maxItems?: number } = {},
  ): Promise<RehydrationResult> {
    const result = await this.archive.rehydrate(refs, options);
    await this.ledger.append("content-rehydrated", {
      requested: refs.length,
      restored: result.items.length,
      omitted: result.omitted.length,
      usedBytes: result.usedBytes,
      maxBytes: result.maxBytes,
      maxItems: result.maxItems,
    });
    return result;
  }

  async createCheckpoint<TFrame extends PersistableTaskFrame>(
    frame: TFrame,
    options: { readonly reason?: string; readonly sourceSessionId?: string } = {},
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const checkpoint = await this.checkpoints.create(frame, options);
    await this.ledger.append("checkpoint-created", manifestPayload(checkpoint));
    return checkpoint;
  }

  async restoreCheckpoint<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(
    checkpointId?: string,
  ): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const checkpoint = await this.checkpoints.restore<TFrame>(checkpointId);
    await this.ledger.append("checkpoint-restored", manifestPayload(checkpoint));
    return checkpoint;
  }

  async rollback<TFrame extends PersistableTaskFrame = PersistableTaskFrame>(): Promise<RestoredCheckpoint<StoredTaskFrame<TFrame>>> {
    const fromCheckpointId = await this.checkpoints.getLatestId();
    const checkpoint = await this.checkpoints.rollback<TFrame>();
    await this.ledger.append("checkpoint-rolled-back", {
      fromCheckpointId,
      toCheckpointId: checkpoint.manifest.checkpointId,
    });
    return checkpoint;
  }

  async readTranscriptTelemetry(path: string): Promise<TranscriptTelemetry> {
    const telemetry = await readCodexTranscriptTelemetry(path);
    await this.ledger.append("telemetry-ingested", {
      schemaId: telemetry.schemaId,
      cliVersion: telemetry.cliVersion,
      sessionIdHash: `sha256:${sha256(Buffer.from(telemetry.sessionId, "utf8"))}`,
      eventCount: telemetry.events.length,
      compactionCount: telemetry.compactionCount,
      latestTotal: telemetry.latestTotal as unknown as JsonValue,
    });
    return telemetry;
  }

  async status(): Promise<RuntimeStatus> {
    const initialized = await exists(this.paths.root);
    if (!initialized) {
      return {
        root: this.paths.root,
        initialized: false,
        latestCheckpointId: null,
        latestCheckpointStatus: "missing",
        checkpointCount: 0,
        archiveObjectCount: 0,
        ledgerEventCount: 0,
      };
    }

    const [latest, checkpointCount, archiveObjectCount, ledgerEventCount] = await Promise.all([
      this.#latestStatus(),
      countCheckpointDirectories(this.paths.checkpoints),
      countArchiveObjects(this.paths.archive),
      exists(this.paths.ledger).then(async (present) => (present ? (await this.ledger.readAll()).length : 0)),
    ]);
    return {
      root: this.paths.root,
      initialized: true,
      latestCheckpointId: latest.checkpointId,
      latestCheckpointStatus: latest.status,
      checkpointCount,
      archiveObjectCount,
      ledgerEventCount,
    };
  }

  async #latestStatus(): Promise<{
    readonly checkpointId: string | null;
    readonly status: RuntimeStatus["latestCheckpointStatus"];
  }> {
    const pointer = await this.checkpoints.inspectLatest();
    if (pointer.status === "missing") return { checkpointId: null, status: "missing" };
    if (pointer.status === "invalid") return { checkpointId: null, status: "invalid" };
    try {
      await this.checkpoints.readWithMirror(pointer.checkpointId);
      return { checkpointId: pointer.checkpointId, status: "verified" };
    } catch (error) {
      if (error instanceof RuntimeIntegrityError || error instanceof RuntimeNotFoundError) {
        return { checkpointId: pointer.checkpointId, status: "invalid" };
      }
      throw error;
    }
  }
}

function manifestPayload(checkpoint: RestoredCheckpoint): JsonObject {
  return {
    checkpointId: checkpoint.manifest.checkpointId,
    parentCheckpointId: checkpoint.manifest.parentCheckpointId,
    createdAt: checkpoint.manifest.createdAt,
    frameHash: checkpoint.manifest.frameRef.hash,
    frameBytes: checkpoint.manifest.frameRef.bytes,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function countCheckpointDirectories(path: string): Promise<number> {
  if (!(await exists(path))) return 0;
  return (await readdir(path, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && isCheckpointId(entry.name),
  ).length;
}

async function countArchiveObjects(path: string): Promise<number> {
  if (!(await exists(path))) return 0;
  let count = 0;
  for (const prefix of await readdir(path, { withFileTypes: true })) {
    if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue;
    count += (await readdir(`${path}/${prefix.name}`, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && /^[a-f0-9]{64}$/.test(entry.name),
    ).length;
  }
  return count;
}
