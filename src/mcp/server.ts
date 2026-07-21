#!/usr/bin/env node
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import { withUsageBoundary } from "../cli/accounting.js";
import { defaultRuntimeFactory } from "../cli/runtime.js";
import type { ContextGcService, RuntimeFactory, RuntimeOptions } from "../cli/types.js";
import { CONTEXT_GC_VERSION } from "../cli/version.js";
import { optimizeContext } from "../core/index.js";
import {
  contextGcStoreId,
  resolveRuntimeDataRoot,
  type RuntimeDataDirSource,
} from "../runtime/paths.js";

export interface ContextGcMcpOptions extends RuntimeOptions {
  runtime?: ContextGcService;
  runtimeFactory?: RuntimeFactory;
}

const relativeActiveFileSchema = z.string().min(1).max(8_192).refine(
  isSafeRelativeFilePath,
  "activeFiles entries must be repository-relative paths without traversal",
);

const evidencePointerSchema = z.string().min(1).max(8_192).refine(
  isSafeEvidencePointer,
  "evidencePointers entries must not be absolute local paths",
);

const taskFrameInputSchema = z.object({
  goal: z.string().min(1).max(4_096),
  constraints: z.array(z.string().max(8_192)).max(64).default([]),
  decisions: z.array(z.string().max(8_192)).max(64).default([]),
  openLoops: z.array(z.string().max(8_192)).max(64).default([]),
  activeFiles: z.array(relativeActiveFileSchema).max(64).default([]),
  testEvidence: z.array(z.string().max(8_192)).max(64).default([]),
  failedAttempts: z.array(z.string().max(8_192)).max(64).default([]),
  evidencePointers: z.array(evidencePointerSchema).max(64).default([]),
}).strict();

const dataDirPathSchema = z.string().min(1).max(32_768);

const dataDirInputSchema = dataDirPathSchema.optional().describe(
  "Optional absolute ContextGC data root. Installed plugins automatically use their private persistent store.",
);

const memoryAtomSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "goal",
    "constraint",
    "decision",
    "evidence",
    "blocker",
    "tool_output",
    "failed_attempt",
    "exact_value",
    "transient",
  ]),
  sourceRef: z.string().min(1),
  contentHash: z.string().min(1),
  protected: z.boolean(),
  exact: z.boolean(),
  tokenEstimate: z.number().int().nonnegative(),
  lifecyclePhase: z.enum([
    "explore",
    "plan",
    "implement",
    "verify",
    "handoff",
    "unknown",
  ]),
  lastUsedAt: z.string().min(1),
  supersedes: z.array(z.string().max(8_192)).max(64).optional(),
  inlineContent: z.string().max(65_536).optional(),
  archiveRef: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
});

const retentionOptionSchema = z.object({
  action: z.enum(["KEEP", "SUMMARIZE", "EXTERNALIZE"]),
  tokenCost: z.number().int().nonnegative(),
  utility: z.number(),
  riskScore: z.number().min(0).max(1),
  reversible: z.boolean(),
  preservesExactContent: z.boolean(),
  redactionCount: z.number().int().nonnegative().optional(),
  secretScanStatus: z.enum(["clean", "sanitized", "unscanned"]).optional(),
});

const selectionInputSchema = z.object({
  candidates: z.array(z.object({
    atom: memoryAtomSchema,
    options: z.array(retentionOptionSchema).min(1).max(3),
  })).max(128),
  tokenBudget: z.number().int().nonnegative(),
  maxTotalRisk: z.number().min(0).max(1).optional(),
  exactDpAtomLimit: z.number().int().nonnegative().optional(),
  maxExactCombinations: z.number().int().positive().optional(),
});

const triggerConfigSchema = z.object({
  softLimitRatio: z.number().min(0).max(1).optional(),
  hardLimitRatio: z.number().min(0).max(1).optional(),
  releaseLimitRatio: z.number().min(0).max(1).optional(),
  minNetBenefitProxy: z.number().nonnegative().optional(),
  benefitHysteresisProxy: z.number().nonnegative().optional(),
  cooldownTurns: z.number().int().nonnegative().optional(),
  maxRiskScore: z.number().min(0).max(1).optional(),
});

const optimizationTriggerInputSchema = z.object({
  currentTokens: z.number().int().nonnegative(),
  contextWindowTokens: z.number().int().positive(),
  reclaimableTokens: z.number().int().nonnegative(),
  predictedRemainingTurns: z.number().int().nonnegative(),
  usageProxyPerRetainedTokenTurn: z.number().nonnegative(),
  checkpointCostProxy: z.number().nonnegative(),
  cacheChurnProxy: z.number().nonnegative(),
  rehydrationCostProxy: z.number().nonnegative(),
  riskCostProxy: z.number().nonnegative(),
  previousRecommendation: z.enum(["PREPARE", "HOLD"]).nullable(),
  turnsSinceLastPreparation: z.number().int().nonnegative(),
  riskScore: z.number().min(0).max(1),
  invariantViolations: z.array(z.string().max(8_192)).max(64),
  config: triggerConfigSchema.optional(),
});

const OMITTED_DATA_DIR_BOUNDARY =
  "mutations_require_a_configured_or_installed_plugin_store" as const;

const PLAN_BOUNDARY = Object.freeze({
  assurance: "advisory-caller-asserted",
  callerAssertionsNotRuntimeVerified: [
    "atom.archiveRef",
    "atom.protected",
    "atom.exact",
    "option.reversible",
    "option.preservesExactContent",
    "option.redactionCount",
    "option.secretScanStatus",
  ] as const,
  prepareSemantics:
    "PREPARE_MEANS_REVERSIBLE_CHECKPOINT_PREPARATION_NOT_NATIVE_COMPACTION",
  nativeCompactionTriggered: false,
  nativeCompactionAvailableThroughThisTool: false,
  decisionOnly: true,
  allowedActions: ["KEEP", "SUMMARIZE", "EXTERNALIZE"] as const,
  dropSupported: false,
  externalizationExecution: "call_contextgc_archive",
  codexChatgptCredits: null,
  codexChatgptCreditsReason: "public_conversion_unavailable",
  economicsUnit: "usage_proxy_not_credits",
});

const MAX_ARCHIVE_UTF8_BYTES = 1_048_576;
const MAX_TASK_FRAME_JSON_BYTES = 262_144;
const MAX_PLAN_JSON_BYTES = 1_048_576;

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("receipt contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) =>
      `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  throw new TypeError(`receipt contains unsupported ${typeof value}`);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function assertJsonByteLimit(value: unknown, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maxBytes) {
    throw new RangeError(`${label} exceeds the ${maxBytes}-byte JSON input limit`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

type McpDataDirSource = RuntimeDataDirSource | "tool_argument";

interface McpDataStore {
  readonly root: string;
  readonly dataDirSource: McpDataDirSource;
  readonly mutationDefaultAllowed: boolean;
}

function dataDirDetails(store: McpDataStore): {
  storeId: string;
  dataDirSource: McpDataDirSource;
  dataDirBoundary: typeof OMITTED_DATA_DIR_BOUNDARY | null;
} {
  return {
    storeId: contextGcStoreId(store.root),
    dataDirSource: store.dataDirSource,
    dataDirBoundary: store.mutationDefaultAllowed ? null : OMITTED_DATA_DIR_BOUNDARY,
  };
}

function withoutRoot(value: unknown): Record<string, unknown> {
  const safe = { ...asRecord(value) };
  delete safe.root;
  return safe;
}

function transportRehydration(value: unknown): unknown {
  if (value === null || typeof value !== "object" || !("items" in value)) return value;
  const source = value as { items?: unknown; omitted?: unknown; usedBytes?: unknown; maxBytes?: unknown; maxItems?: unknown };
  if (!Array.isArray(source.items)) return value;
  return {
    items: source.items.map((item) => {
      if (item === null || typeof item !== "object" || !("content" in item)) return item;
      const typed = item as { ref?: unknown; content?: unknown };
      if (!(typed.content instanceof Uint8Array)) return item;
      const ref = typed.ref !== null && typeof typed.ref === "object"
        ? typed.ref as Record<string, unknown>
        : undefined;
      const isText = ref?.mediaType === "text/plain; charset=utf-8";
      return {
        ref: typed.ref,
        content: Buffer.from(typed.content).toString(isText ? "utf8" : "base64"),
        encoding: isText ? "utf8" : "base64",
      };
    }),
    omitted: source.omitted,
    usedBytes: source.usedBytes,
    maxBytes: source.maxBytes,
    maxItems: source.maxItems,
  };
}

function successResult(value: unknown): CallToolResult {
  const safe = jsonSafe(value);
  const structuredContent = safe !== null && !Array.isArray(safe) && typeof safe === "object"
    ? safe as Record<string, unknown>
    : { result: safe };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = sanitizeModelVisibleError(
    error instanceof Error ? error.message : String(error),
  );
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function sanitizeModelVisibleError(message: string): string {
  if (
    /[A-Za-z]:[\\/]/.test(message) ||
    /\\\\[^\\]/.test(message) ||
    /(^|[\s("'=:])\/(?!\/)/.test(message)
  ) {
    return "ContextGC operation failed; local path details were withheld";
  }
  return message;
}

function isSafeRelativeFilePath(value: string): boolean {
  if (isLocalAbsolutePath(value) || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.length > 0 && segments.every(
    (segment) => segment !== "" && segment !== "." && segment !== "..",
  );
}

function isSafeEvidencePointer(value: string): boolean {
  if (/^file:/i.test(value)) return false;
  if (isLocalAbsolutePath(value) || /^[A-Za-z]:/.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return true;
  return true;
}

function isLocalAbsolutePath(value: string): boolean {
  return isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^[\\/]/.test(value);
}

async function callTool(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return successResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

function createRuntime(options: ContextGcMcpOptions, dataDir?: string): ContextGcService {
  if (options.runtime !== undefined) return options.runtime;
  const factory = options.runtimeFactory ?? defaultRuntimeFactory;
  const runtimeOptions: RuntimeOptions = {
    cwd: resolve(options.cwd ?? process.cwd()),
    env: options.env ?? process.env,
  };
  const selectedDataDir = dataDir ?? options.dataDir;
  if (selectedDataDir !== undefined) runtimeOptions.dataDir = selectedDataDir;
  return factory(runtimeOptions);
}

export function createContextGcMcpServer(options: ContextGcMcpOptions = {}): McpServer {
  const resolvedDefault = resolveRuntimeDataRoot(options);
  const defaultStore: McpDataStore = {
    root: resolvedDefault.root,
    dataDirSource: resolvedDefault.source,
    mutationDefaultAllowed: resolvedDefault.mutationDefaultAllowed,
  };
  const defaultRuntime = createRuntime(options, defaultStore.root);
  const selectedStore = (
    dataDir: string | undefined,
    mutation: boolean,
  ): { readonly runtime: ContextGcService; readonly store: McpDataStore } => {
    if (dataDir === undefined) {
      if (mutation && !defaultStore.mutationDefaultAllowed) {
        throw new TypeError(
          "dataDir is required unless ContextGC has a configured or installed-plugin data store",
        );
      }
      return { runtime: defaultRuntime, store: defaultStore };
    }
    if (!isAbsolute(dataDir)) {
      throw new TypeError("dataDir must be an absolute path");
    }
    const root = resolve(dataDir);
    return {
      runtime: createRuntime(options, root),
      store: {
        root,
        dataDirSource: "tool_argument",
        mutationDefaultAllowed: true,
      },
    };
  };
  const server = new McpServer({ name: "context-gc", version: CONTEXT_GC_VERSION });

  server.registerTool(
    "contextgc_status",
    {
      title: "ContextGC status",
      description: "Inspect the local ContextGC store and latest reversible checkpoint.",
      inputSchema: { dataDir: dataDirInputSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dataDir }) => callTool(async () => {
      const { runtime, store } = selectedStore(dataDir, false);
      return {
        ...withUsageBoundary(withoutRoot(await runtime.status())),
        ...dataDirDetails(store),
      };
    }),
  );

  server.registerTool(
    "contextgc_plan",
    {
      title: "Plan a reversible ContextGC preparation",
      description:
        "Run the deterministic retention optimizer and append an auditable policy receipt. PREPARE means create a reversible checkpoint plan; this tool never invokes Codex native compaction.",
      inputSchema: {
        selection: selectionInputSchema,
        trigger: optimizationTriggerInputSchema,
        dataDir: dataDirInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ selection, trigger, dataDir }) => callTool(async () => {
      assertJsonByteLimit({ selection, trigger }, MAX_PLAN_JSON_BYTES, "plan");
      const { runtime, store } = selectedStore(dataDir, true);
      await runtime.init();
      const input = {
        selection,
        trigger,
      } as Parameters<typeof optimizeContext>[0];
      const optimized = optimizeContext(input);
      const assuranceWarnings = [
        "CALLER_ASSERTED_RETENTION_OPTION_METADATA",
        ...(optimized.selection.decisions.some(
          (decision) => decision.action === "EXTERNALIZE",
        )
          ? ["EXTERNALIZATION_REF_NOT_RUNTIME_VERIFIED_USE_CONTEXTGC_ARCHIVE"]
          : []),
      ];
      const advisoryResult = {
        selection: {
          ...optimized.selection,
          decisions: optimized.selection.decisions.map((decision) => ({
            ...decision,
            assurance: "advisory-caller-asserted" as const,
          })),
        },
        trigger: {
          ...optimized.trigger,
          assurance: "advisory-caller-asserted" as const,
        },
        assuranceWarnings,
      };
      const inputHash = hashJson(input);
      const receiptBody = {
        schemaVersion: 1,
        kind: "contextgc-policy-evaluation",
        inputHash,
        result: advisoryResult,
        boundary: PLAN_BOUNDARY,
      } as const;
      const receiptHash = hashJson(receiptBody);
      const ledger = asRecord(await runtime.appendEvent("policy-evaluated", {
        ...receiptBody,
        receiptHash,
      }));
      return {
        ...advisoryResult,
        boundary: PLAN_BOUNDARY,
        ...dataDirDetails(store),
        auditReceipt: {
          schemaVersion: 1,
          receiptHash,
          inputHash,
          ledgerEventId: typeof ledger.id === "string" ? ledger.id : null,
          recordedAt: typeof ledger.timestamp === "string" ? ledger.timestamp : null,
          ...dataDirDetails(store),
        },
      };
    }),
  );

  server.registerTool(
    "contextgc_archive",
    {
      title: "Archive UTF-8 context evidence",
      description:
        "Persist UTF-8 text in the local content-addressed archive and return its ContentRef. Detected secrets are redacted before persistence, so sanitized refs are not byte-exact raw rollback copies.",
      inputSchema: {
        text: z.string().min(1).max(MAX_ARCHIVE_UTF8_BYTES),
        dataDir: dataDirInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text, dataDir }) => callTool(async () => {
      const utf8Bytes = Buffer.byteLength(text, "utf8");
      if (utf8Bytes > MAX_ARCHIVE_UTF8_BYTES) {
        throw new RangeError(
          `text exceeds the ${MAX_ARCHIVE_UTF8_BYTES}-byte UTF-8 archive limit`,
        );
      }
      const { runtime, store } = selectedStore(dataDir, true);
      await runtime.init();
      const ref = asRecord(await runtime.archiveContent(text));
      const sanitized = ref.sanitized === true;
      const secretScanStatus =
        ref.secretScanStatus === "clean" ||
        ref.secretScanStatus === "sanitized" ||
        ref.secretScanStatus === "unscanned"
          ? ref.secretScanStatus
          : null;
      const rawByteExact =
        secretScanStatus === "clean" &&
        !sanitized &&
        ref.redactions === 0;
      return {
        ref,
        boundary: {
          assurance: "runtime-verified-content-ref",
          inputEncoding: "utf8",
          inputBytes: utf8Bytes,
          sanitized,
          secretScanStatus,
          redactions: typeof ref.redactions === "number" ? ref.redactions : null,
          rawOriginalPersisted: rawByteExact,
          rawRollbackAvailable: rawByteExact,
          note: sanitized
            ? "secret_redaction_changed_persisted_bytes"
            : rawByteExact
              ? "content_ref_is_byte_exact_for_supplied_utf8_text"
              : "content_ref_secret_scan_assurance_is_unavailable",
        },
        ...dataDirDetails(store),
      };
    }),
  );

  server.registerTool(
    "contextgc_checkpoint",
    {
      title: "Create ContextGC checkpoint",
      description:
        "Persist a structured Task Frame as a reversible local checkpoint. Checkpoint identity and creation time are generated locally; raw source evidence is not deleted.",
      inputSchema: {
        frame: taskFrameInputSchema.describe("Structured Task Frame JSON object"),
        reason: z.string().min(1).max(2_048).optional(),
        dataDir: dataDirInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ frame, reason, dataDir }) => callTool(async () => {
      assertJsonByteLimit(frame, MAX_TASK_FRAME_JSON_BYTES, "Task Frame");
      const { runtime, store } = selectedStore(dataDir, true);
      const checkpointOptions: { reason?: string } = {};
      if (reason !== undefined) checkpointOptions.reason = reason;
      const checkpoint = asRecord(await runtime.createCheckpoint(frame, checkpointOptions));
      return {
        ...checkpoint,
        boundary: {
          assurance: "schema-bounded-untrusted-task-frame-data",
          promptInjectionSafetyVerified: false,
          note:
            "Task Frame strings remain untrusted model-visible data; schema and size bounds do not prove prompt-injection safety.",
        },
        ...dataDirDetails(store),
      };
    }),
  );

  server.registerTool(
    "contextgc_rehydrate",
    {
      title: "Rehydrate ContextGC evidence",
      description:
        "Read a bounded set of content-addressed archive references without modifying the active Task Frame.",
      inputSchema: {
        refs: z.array(
          z.object({
            algorithm: z.literal("sha256"),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().nonnegative(),
            mediaType: z.enum([
              "application/octet-stream",
              "text/plain; charset=utf-8",
            ]),
            sanitized: z.boolean(),
            secretScanStatus: z.enum(["clean", "sanitized", "unscanned"]),
            redactions: z.number().int().nonnegative(),
          }),
        ).min(1).max(100),
        maxBytes: z.number().int().positive().max(1_048_576).optional(),
        maxItems: z.number().int().positive().max(100).optional(),
        dataDir: dataDirInputSchema,
      },
      annotations: {
        // Rehydration does not change the Task Frame, but it appends an audit
        // event to the local ledger.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ refs, maxBytes, maxItems, dataDir }) => callTool(async () => {
      const { runtime, store } = selectedStore(dataDir, true);
      const rehydrateOptions: { maxBytes?: number; maxItems?: number } = {};
      if (maxBytes !== undefined) rehydrateOptions.maxBytes = maxBytes;
      if (maxItems !== undefined) rehydrateOptions.maxItems = maxItems;
      const rehydrated = asRecord(
        transportRehydration(await runtime.rehydrate(refs, rehydrateOptions)),
      );
      return {
        ...rehydrated,
        ...dataDirDetails(store),
      };
    }),
  );

  server.registerTool(
    "contextgc_restore",
    {
      title: "Restore ContextGC checkpoint",
      description:
        "Restore a validated checkpoint into the current Task Frame mirror. The append-only ledger remains intact.",
      inputSchema: {
        checkpointId: z.string().min(1).max(128).optional(),
        dataDir: dataDirInputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ checkpointId, dataDir }) => callTool(async () => {
      const { runtime, store } = selectedStore(dataDir, true);
      const restored = asRecord(await runtime.restoreCheckpoint(checkpointId));
      return {
        ...restored,
        boundary: {
          assurance: "runtime-verified-checkpoint-integrity",
          promptInjectionSafetyVerified: false,
        },
        ...dataDirDetails(store),
      };
    }),
  );

  return server;
}

export async function runMcpServer(options: ContextGcMcpOptions = {}): Promise<void> {
  const server = createContextGcMcpServer(options);
  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(entryPath)) {
  try {
    await runMcpServer();
  } catch (error) {
    // stdout belongs exclusively to JSON-RPC framing.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
