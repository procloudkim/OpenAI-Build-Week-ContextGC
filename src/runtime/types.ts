import type { TaskFrame } from "../core/types.js";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** A structurally typed input so the core engine and minimal callers share one boundary. */
export type PersistableTaskFrame = TaskFrame | JsonObject;

export interface StoredTaskFrameFields {
  readonly schemaVersion: 1;
  readonly checkpointId: string;
  readonly createdAt: string;
  readonly goal: string;
  readonly constraints: readonly string[];
  readonly decisions: readonly string[];
  readonly openLoops: readonly string[];
  readonly activeFiles: readonly string[];
  readonly testEvidence: readonly string[];
  readonly failedAttempts: readonly string[];
  readonly evidencePointers: readonly string[];
}

/**
 * The on-disk Task Frame is deliberately closed. Caller-defined properties
 * are never retained across a checkpoint boundary.
 *
 * The unused generic parameter preserves source compatibility for callers
 * that previously supplied an input type when restoring a checkpoint.
 */
export type StoredTaskFrame<_TFrame extends PersistableTaskFrame = PersistableTaskFrame> =
  StoredTaskFrameFields;

export interface RuntimePaths {
  readonly root: string;
  readonly ledger: string;
  readonly archive: string;
  readonly checkpoints: string;
  readonly latest: string;
  readonly taskFrame: string;
}

export interface ContentRef {
  readonly algorithm: "sha256";
  readonly hash: string;
  readonly bytes: number;
  readonly mediaType: "application/octet-stream" | "text/plain; charset=utf-8";
  /**
   * clean: scanned UTF-8 text with no detected secret
   * sanitized: detected secret values were removed before hashing
   * unscanned: opaque bytes; integrity is verified but secret safety is unknown
   */
  readonly secretScanStatus: "clean" | "sanitized" | "unscanned";
  /** True means secret removal intentionally changed the persisted bytes. */
  readonly sanitized: boolean;
  /** Count of detected values removed before hashing; never claim raw rollback when non-zero. */
  readonly redactions: number;
}

export interface LedgerRecord<TPayload extends JsonValue = JsonValue> {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly timestamp: string;
  readonly type: string;
  readonly payload: TPayload;
}

export interface CheckpointManifest {
  readonly schemaVersion: 1;
  readonly privacyBoundary: "deterministic-minimization-v1";
  readonly checkpointId: string;
  readonly parentCheckpointId: string | null;
  readonly createdAt: string;
  readonly frameRef: ContentRef;
  readonly reason: string | null;
  /** Null or a one-way deterministic digest; a raw session identifier is never persisted. */
  readonly sourceSessionId: `sha256:${string}` | null;
}

export interface RestoredCheckpoint<TFrame extends object = StoredTaskFrame> {
  readonly manifest: CheckpointManifest;
  readonly frame: TFrame;
}

export interface RehydratedItem {
  readonly ref: ContentRef;
  readonly content: Uint8Array;
}

export interface OmittedRehydration {
  readonly ref: ContentRef;
  readonly reason: "item-limit" | "byte-limit";
}

export interface RehydrationResult {
  readonly items: readonly RehydratedItem[];
  readonly omitted: readonly OmittedRehydration[];
  readonly usedBytes: number;
  readonly maxBytes: number;
  readonly maxItems: number;
}

export interface RuntimeStatus {
  readonly root: string;
  readonly initialized: boolean;
  readonly latestCheckpointId: string | null;
  readonly latestCheckpointStatus: "missing" | "verified" | "invalid";
  readonly checkpointCount: number;
  readonly archiveObjectCount: number;
  readonly ledgerEventCount: number;
}

export interface CodexTokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  /** Null means the Codex event omitted this category; it must not be treated as zero. */
  readonly cacheWriteInputTokens: number | null;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export type CodexTelemetryEvent =
  | {
      readonly kind: "token-count";
      readonly timestamp: string;
      readonly total: CodexTokenUsage;
      readonly last: CodexTokenUsage;
      readonly modelContextWindow: number;
    }
  | {
      readonly kind: "context-compacted";
      readonly timestamp: string;
    };

export interface TranscriptTelemetry {
  readonly schemaId: "codex-rollout-jsonl/event-msg-v1";
  readonly cliVersion: string;
  readonly sessionId: string;
  readonly events: readonly CodexTelemetryEvent[];
  readonly latestTotal: CodexTokenUsage | null;
  readonly compactionCount: number;
}
