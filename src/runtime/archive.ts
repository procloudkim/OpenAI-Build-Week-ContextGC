import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { RuntimeCapacityError, RuntimeIntegrityError, RuntimeNotFoundError } from "./errors.js";
import { redactText } from "./redaction.js";
import { sha256 } from "./io.js";
import type { ContentRef, RehydrationResult } from "./types.js";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_ITEMS = 16;
const HARD_MAX_BYTES = 1024 * 1024;
const HARD_MAX_ITEMS = 256;
export const DEFAULT_MAX_ARCHIVE_OBJECT_BYTES = 1024 * 1024;
export const DEFAULT_MAX_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024;

export interface ContentArchiveOptions {
  readonly maxObjectBytes?: number;
  readonly maxTotalBytes?: number;
}

export class ContentArchive {
  readonly root: string;
  readonly maxObjectBytes: number;
  readonly maxTotalBytes: number;

  constructor(root: string, options: ContentArchiveOptions = {}) {
    this.root = root;
    this.maxObjectBytes = positiveSafeInteger(
      options.maxObjectBytes ?? DEFAULT_MAX_ARCHIVE_OBJECT_BYTES,
      "maxObjectBytes",
    );
    this.maxTotalBytes = positiveSafeInteger(
      options.maxTotalBytes ?? DEFAULT_MAX_ARCHIVE_TOTAL_BYTES,
      "maxTotalBytes",
    );
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(content: string | Uint8Array): Promise<ContentRef> {
    const inputBytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
    if (inputBytes > this.maxObjectBytes) {
      throw new RuntimeCapacityError(
        `Archive input is ${inputBytes} bytes; maximum object size is ${this.maxObjectBytes} bytes`,
      );
    }
    const prepared =
      typeof content === "string"
        ? (() => {
            const redacted = redactText(content);
            return {
              bytes: Buffer.from(redacted.value, "utf8"),
              mediaType: "text/plain; charset=utf-8" as const,
              secretScanStatus: redacted.count > 0 ? "sanitized" as const : "clean" as const,
              sanitized: redacted.count > 0,
              redactions: redacted.count,
            };
          })()
        : {
            bytes: Buffer.from(content),
            mediaType: "application/octet-stream" as const,
            secretScanStatus: "unscanned" as const,
            sanitized: false,
            redactions: 0,
          };

    if (prepared.bytes.byteLength > this.maxObjectBytes) {
      throw new RuntimeCapacityError(
        `Sanitized archive object is ${prepared.bytes.byteLength} bytes; maximum object size is ${this.maxObjectBytes} bytes`,
      );
    }

    const hash = sha256(prepared.bytes);
    const path = this.#path(hash);
    await this.init();
    const existing = await readExisting(path);
    if (existing !== null) {
      if (existing.byteLength !== prepared.bytes.byteLength || sha256(existing) !== hash) {
        throw new RuntimeIntegrityError(`Archive object ${hash} failed its integrity check`);
      }
      return {
        algorithm: "sha256",
        hash,
        bytes: prepared.bytes.byteLength,
        mediaType: prepared.mediaType,
        secretScanStatus: prepared.secretScanStatus,
        sanitized: prepared.sanitized,
        redactions: prepared.redactions,
      };
    }
    const totalBytes = await this.#totalBytes();
    if (prepared.bytes.byteLength > this.maxTotalBytes - totalBytes) {
      throw new RuntimeCapacityError(
        `Archive capacity would exceed ${this.maxTotalBytes} bytes`,
      );
    }
    await mkdir(dirname(path), { recursive: true });

    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(prepared.bytes);
      await handle.sync();
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await readFile(path);
      if (sha256(existing) !== hash) {
        throw new RuntimeIntegrityError(`Archive object ${hash} failed its integrity check`);
      }
    } finally {
      await handle?.close();
    }

    return {
      algorithm: "sha256",
      hash,
      bytes: prepared.bytes.byteLength,
      mediaType: prepared.mediaType,
      secretScanStatus: prepared.secretScanStatus,
      sanitized: prepared.sanitized,
      redactions: prepared.redactions,
    };
  }

  async get(ref: ContentRef): Promise<Uint8Array> {
    this.#validateRef(ref);
    let bytes: Buffer;
    try {
      bytes = await readFile(this.#path(ref.hash));
    } catch (error) {
      if (isNotFound(error)) {
        throw new RuntimeNotFoundError(`Archive object ${ref.hash} does not exist`);
      }
      throw error;
    }

    if (bytes.byteLength !== ref.bytes || sha256(bytes) !== ref.hash) {
      throw new RuntimeIntegrityError(`Archive object ${ref.hash} failed its integrity check`);
    }
    return bytes;
  }

  async rehydrate(
    refs: readonly ContentRef[],
    options: { readonly maxBytes?: number; readonly maxItems?: number } = {},
  ): Promise<RehydrationResult> {
    const maxBytes = boundedInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes", 1, HARD_MAX_BYTES);
    const maxItems = boundedInteger(options.maxItems ?? DEFAULT_MAX_ITEMS, "maxItems", 1, HARD_MAX_ITEMS);
    const items: RehydrationResult["items"][number][] = [];
    const omitted: RehydrationResult["omitted"][number][] = [];
    let usedBytes = 0;

    for (const ref of refs) {
      this.#validateRef(ref);
      if (items.length >= maxItems) {
        omitted.push({ ref, reason: "item-limit" });
        continue;
      }
      if (ref.bytes > maxBytes - usedBytes) {
        omitted.push({ ref, reason: "byte-limit" });
        continue;
      }
      const content = await this.get(ref);
      items.push({ ref, content });
      usedBytes += content.byteLength;
    }

    return { items, omitted, usedBytes, maxBytes, maxItems };
  }

  #path(hash: string): string {
    if (!SHA256_HEX.test(hash)) {
      throw new RuntimeIntegrityError("Content reference contains an invalid SHA-256 digest");
    }
    return resolve(this.root, hash.slice(0, 2), hash);
  }

  #validateRef(ref: ContentRef): void {
    if (
      ref.algorithm !== "sha256" ||
      !SHA256_HEX.test(ref.hash) ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 0 ||
      (ref.mediaType !== "application/octet-stream" && ref.mediaType !== "text/plain; charset=utf-8") ||
      (ref.secretScanStatus !== "clean" &&
        ref.secretScanStatus !== "sanitized" &&
        ref.secretScanStatus !== "unscanned") ||
      typeof ref.sanitized !== "boolean" ||
      !Number.isSafeInteger(ref.redactions) ||
      ref.redactions < 0 ||
      ref.sanitized !== (ref.redactions > 0) ||
      !isConsistentScanState(ref)
    ) {
      throw new RuntimeIntegrityError("Content reference has an unknown or invalid schema");
    }
  }

  async #totalBytes(): Promise<number> {
    let total = 0;
    for (const prefix of await readdir(this.root, { withFileTypes: true })) {
      if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue;
      const prefixPath = resolve(this.root, prefix.name);
      for (const entry of await readdir(prefixPath, { withFileTypes: true })) {
        if (!entry.isFile() || !SHA256_HEX.test(entry.name)) continue;
        total += (await stat(resolve(prefixPath, entry.name))).size;
        if (!Number.isSafeInteger(total)) {
          throw new RuntimeCapacityError("Archive size exceeds safe integer accounting");
        }
      }
    }
    return total;
  }
}

/** Protected exact atoms may be externalized only when this returns true. */
export function isByteExactRef(ref: ContentRef): boolean {
  return ref.secretScanStatus === "clean" && !ref.sanitized && ref.redactions === 0;
}

function isConsistentScanState(ref: ContentRef): boolean {
  if (ref.secretScanStatus === "clean") {
    return ref.mediaType === "text/plain; charset=utf-8" && !ref.sanitized && ref.redactions === 0;
  }
  if (ref.secretScanStatus === "sanitized") {
    return ref.mediaType === "text/plain; charset=utf-8" && ref.sanitized && ref.redactions > 0;
  }
  return ref.mediaType === "application/octet-stream" && !ref.sanitized && ref.redactions === 0;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

async function readExisting(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
