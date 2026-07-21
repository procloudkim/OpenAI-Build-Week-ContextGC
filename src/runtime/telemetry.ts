import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { TranscriptSchemaError } from "./errors.js";
import { isRecord } from "./io.js";
import type { TokenUsage as CoreTokenUsage } from "../core/types.js";
import type {
  CodexTokenUsage,
  CodexTelemetryEvent,
  TranscriptTelemetry,
} from "./types.js";

export const CODEX_TRANSCRIPT_SCHEMA_ID = "codex-rollout-jsonl/event-msg-v1" as const;
export const SUPPORTED_CODEX_CLI_VERSIONS = ["0.144.x", "0.145.0-alpha.x"] as const;

const KNOWN_TOP_LEVEL_TYPES = new Set([
  "session_meta",
  "event_msg",
  "response_item",
  "turn_context",
  "compacted",
  "world_state",
  "inter_agent_communication_metadata",
]);

export async function readCodexTranscriptTelemetry(path: string): Promise<TranscriptTelemetry> {
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let lineNumber = 0;
  let cliVersion: string | null = null;
  let sessionId: string | null = null;
  const events: CodexTelemetryEvent[] = [];

  for await (const rawLine of reader) {
    lineNumber += 1;
    const line = lineNumber === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (line.trim() === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch {
      throw schemaError(lineNumber, "record is not valid JSON");
    }
    if (!isRecord(record) || typeof record.type !== "string" || typeof record.timestamp !== "string") {
      throw schemaError(lineNumber, "record envelope has an unknown format");
    }
    if (!KNOWN_TOP_LEVEL_TYPES.has(record.type)) {
      throw schemaError(lineNumber, `unknown top-level record type ${JSON.stringify(record.type)}`);
    }

    if (cliVersion === null) {
      if (record.type !== "session_meta" || !isRecord(record.payload)) {
        throw schemaError(lineNumber, "first record must be session_meta");
      }
      const payload = record.payload;
      const id = typeof payload.session_id === "string" ? payload.session_id : payload.id;
      if (typeof payload.cli_version !== "string" || typeof id !== "string") {
        throw schemaError(lineNumber, "session_meta is missing cli_version or session id");
      }
      if (!isSupportedCodexCliVersion(payload.cli_version)) {
        throw schemaError(
          lineNumber,
          `Codex CLI ${payload.cli_version} is unsupported; supported schemas: ${SUPPORTED_CODEX_CLI_VERSIONS.join(", ")}`,
        );
      }
      cliVersion = payload.cli_version;
      sessionId = id;
      continue;
    }

    if (record.type !== "event_msg") continue;
    if (!isRecord(record.payload) || typeof record.payload.type !== "string") {
      throw schemaError(lineNumber, "event_msg payload has an unknown format");
    }

    if (record.payload.type === "context_compacted") {
      events.push({ kind: "context-compacted", timestamp: record.timestamp });
      continue;
    }

    if (record.payload.type === "token_count") {
      const info = record.payload.info;
      if (!isRecord(info)) {
        throw schemaError(lineNumber, "token_count.info has an unknown format");
      }
      events.push({
        kind: "token-count",
        timestamp: record.timestamp,
        total: parseUsage(info.total_token_usage, lineNumber, "total_token_usage"),
        last: parseUsage(info.last_token_usage, lineNumber, "last_token_usage"),
        modelContextWindow: parseNonNegativeInteger(
          info.model_context_window,
          lineNumber,
          "model_context_window",
        ),
      });
    }
  }

  if (cliVersion === null || sessionId === null) {
    throw new TranscriptSchemaError("Transcript is empty or has no session_meta record");
  }

  const tokenEvents = events.filter(
    (event): event is Extract<CodexTelemetryEvent, { kind: "token-count" }> => event.kind === "token-count",
  );
  return {
    schemaId: CODEX_TRANSCRIPT_SCHEMA_ID,
    cliVersion,
    sessionId,
    events,
    latestTotal: tokenEvents.at(-1)?.total ?? null,
    compactionCount: events.filter((event) => event.kind === "context-compacted").length,
  };
}

export function isSupportedCodexCliVersion(version: string): boolean {
  return /^0\.144\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) || /^0\.145\.0-alpha\.\d+$/.test(version);
}

/**
 * Converts Codex's cumulative input counter into the core's non-overlapping
 * categories. Null means the observed event did not contain enough data.
 */
export function toCoreTokenUsage(usage: CodexTokenUsage): CoreTokenUsage | null {
  if (usage.cacheWriteInputTokens === null || usage.cachedInputTokens > usage.inputTokens) {
    return null;
  }
  return {
    uncachedInputTokens: usage.inputTokens - usage.cachedInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    outputTokens: usage.outputTokens,
  };
}

function parseUsage(value: unknown, lineNumber: number, field: string): CodexTokenUsage {
  if (!isRecord(value)) {
    throw schemaError(lineNumber, `${field} has an unknown format`);
  }
  return {
    inputTokens: parseNonNegativeInteger(value.input_tokens, lineNumber, `${field}.input_tokens`),
    cachedInputTokens: parseNonNegativeInteger(
      value.cached_input_tokens,
      lineNumber,
      `${field}.cached_input_tokens`,
    ),
    cacheWriteInputTokens:
      value.cache_write_input_tokens === undefined
        ? null
        : parseNonNegativeInteger(
            value.cache_write_input_tokens,
            lineNumber,
            `${field}.cache_write_input_tokens`,
          ),
    outputTokens: parseNonNegativeInteger(value.output_tokens, lineNumber, `${field}.output_tokens`),
    reasoningOutputTokens: parseNonNegativeInteger(
      value.reasoning_output_tokens,
      lineNumber,
      `${field}.reasoning_output_tokens`,
    ),
    totalTokens: parseNonNegativeInteger(value.total_tokens, lineNumber, `${field}.total_tokens`),
  };
}

function parseNonNegativeInteger(value: unknown, lineNumber: number, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw schemaError(lineNumber, `${field} must be a non-negative integer`);
  }
  return value;
}

function schemaError(lineNumber: number, message: string): TranscriptSchemaError {
  return new TranscriptSchemaError(`Unsupported Codex transcript at line ${lineNumber}: ${message}`);
}
