import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRequestListener } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createContextGcMcpServer,
  type ContextGcMcpOptions,
} from "../src/mcp/server.js";
import type { ContextGcService } from "../src/cli/types.js";
import { ContextGcRuntime } from "../src/runtime/index.js";
import { contextGcStoreId } from "../src/runtime/paths.js";

const REF = {
  algorithm: "sha256" as const,
  hash: "a".repeat(64),
  bytes: 5,
  mediaType: "text/plain; charset=utf-8" as const,
  sanitized: false,
  secretScanStatus: "clean" as const,
  redactions: 0,
};

test("patched Hono v2 request listener preserves the MCP SDK adapter contract", async () => {
  const server = createServer(
    getRequestListener(
      async (request) => new Response(new URL(request.url).pathname),
      { overrideGlobalObjects: false },
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/compatibility`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "/compatibility");
  } finally {
    server.close();
    await once(server, "close");
  }
});

function fakeRuntime(overrides: Partial<ContextGcService> = {}): ContextGcService {
  return {
    init: async () => undefined,
    status: async () => ({ root: "test", initialized: true, usageProxy: 11 }),
    appendEvent: async (type, payload) => ({
      schemaVersion: 1,
      id: "ledger-event-1",
      timestamp: "2026-07-18T00:00:00.000Z",
      type,
      payload,
    }),
    archiveContent: async (content) => ({
      algorithm: "sha256",
      hash: "b".repeat(64),
      bytes: Buffer.byteLength(content, "utf8"),
      mediaType: "text/plain; charset=utf-8",
      sanitized: false,
      secretScanStatus: "clean",
      redactions: 0,
    }),
    createCheckpoint: async (frame, options) => ({
      manifest: { checkpointId: "cp-1", reason: options?.reason ?? null },
      frame,
    }),
    restoreCheckpoint: async (id) => ({ manifest: { checkpointId: id ?? "latest" } }),
    rollback: async () => ({}),
    rehydrate: async () => ({
      items: [{ ref: REF, content: new TextEncoder().encode("hello") }],
      omitted: [],
      usedBytes: 5,
      maxBytes: 100,
      maxItems: 1,
    }),
    ...overrides,
  };
}

function planArguments(dataDir = process.cwd()): Record<string, unknown> {
  const value: Record<string, unknown> = {
    dataDir,
    selection: {
      tokenBudget: 5,
      candidates: [
        {
          atom: {
            id: "evidence-1",
            kind: "evidence",
            sourceRef: "ledger:event-1",
            contentHash: "sha256:evidence-1",
            archiveRef: `sha256:${"b".repeat(64)}`,
            protected: true,
            exact: true,
            tokenEstimate: 10,
            lifecyclePhase: "implement",
            lastUsedAt: "2026-07-18T00:00:00.000Z",
          },
          options: [
            {
              action: "KEEP",
              tokenCost: 10,
              utility: 10,
              riskScore: 0,
              reversible: true,
              preservesExactContent: true,
            },
            {
              action: "EXTERNALIZE",
              tokenCost: 2,
              utility: 9,
              riskScore: 0.01,
              reversible: true,
              preservesExactContent: true,
              redactionCount: 0,
              secretScanStatus: "clean",
            },
          ],
        },
      ],
    },
    trigger: {
      currentTokens: 80,
      contextWindowTokens: 100,
      reclaimableTokens: 8,
      predictedRemainingTurns: 10,
      usageProxyPerRetainedTokenTurn: 1,
      checkpointCostProxy: 10,
      cacheChurnProxy: 5,
      rehydrationCostProxy: 2,
      riskCostProxy: 1,
      previousRecommendation: null,
      turnsSinceLastPreparation: 10,
      riskScore: 0.01,
      invariantViolations: [],
    },
  };
  return value;
}

async function withClient(
  callback: (client: Client) => Promise<void>,
  options: ContextGcMcpOptions = { runtime: fakeRuntime() },
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createContextGcMcpServer(options);
  const client = new Client(
    { name: "contextgc-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await callback(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("MCP server exposes the six bounded ContextGC tools", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "contextgc_archive",
        "contextgc_checkpoint",
        "contextgc_plan",
        "contextgc_rehydrate",
        "contextgc_restore",
        "contextgc_status",
      ],
    );
  });
});

test("checkpoint tool schema does not expose sourceSessionId", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const checkpoint = tools.tools.find((tool) => tool.name === "contextgc_checkpoint");
    assert.ok(checkpoint);
    const properties = (
      checkpoint.inputSchema as { properties?: Record<string, unknown> }
    ).properties ?? {};
    assert.equal(Object.hasOwn(properties, "sourceSessionId"), false);
  });
});

test("plan exposes the optimizer with a no-native-compaction boundary and receipt", async () => {
  let appended: { type: string; payload: unknown } | undefined;
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_plan",
      arguments: planArguments(),
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      selection: { decisions: Array<{ action: string; assurance: string }> };
      trigger: { recommendation: string; shouldPrepare: boolean; assurance: string };
      boundary: Record<string, unknown> & { callerAssertionsNotRuntimeVerified?: string[] };
      assuranceWarnings: string[];
      auditReceipt: { receiptHash: string; ledgerEventId: string };
    };
    assert.equal(structured.selection.decisions[0]?.action, "EXTERNALIZE");
    assert.equal(
      structured.selection.decisions[0]?.assurance,
      "advisory-caller-asserted",
    );
    assert.equal(structured.trigger.recommendation, "PREPARE");
    assert.equal(structured.trigger.shouldPrepare, true);
    assert.equal(structured.trigger.assurance, "advisory-caller-asserted");
    assert.deepEqual(structured.assuranceWarnings, [
      "CALLER_ASSERTED_RETENTION_OPTION_METADATA",
      "EXTERNALIZATION_REF_NOT_RUNTIME_VERIFIED_USE_CONTEXTGC_ARCHIVE",
    ]);
    assert.equal(structured.boundary.assurance, "advisory-caller-asserted");
    assert.equal(
      structured.boundary.prepareSemantics,
      "PREPARE_MEANS_REVERSIBLE_CHECKPOINT_PREPARATION_NOT_NATIVE_COMPACTION",
    );
    assert.equal(structured.boundary.nativeCompactionTriggered, false);
    assert.equal(structured.boundary.dropSupported, false);
    assert.equal(structured.boundary.codexChatgptCredits, null);
    assert.ok(structured.boundary.callerAssertionsNotRuntimeVerified?.includes("atom.archiveRef"));
    assert.match(structured.auditReceipt.receiptHash, /^[a-f0-9]{64}$/);
    assert.equal(structured.auditReceipt.ledgerEventId, "ledger-event-1");
    assert.equal(
      (structured as unknown as Record<string, unknown>).storeId,
      contextGcStoreId(process.cwd()),
    );
    assert.equal((structured as unknown as Record<string, unknown>).root, undefined);
    assert.equal(appended?.type, "policy-evaluated");
    assert.equal(
      (appended?.payload as { receiptHash?: unknown }).receiptHash,
      structured.auditReceipt.receiptHash,
    );
  }, {
    runtime: fakeRuntime({
      appendEvent: async (type, payload) => {
        appended = { type, payload };
        return {
          schemaVersion: 1,
          id: "ledger-event-1",
          timestamp: "2026-07-18T00:00:00.000Z",
          type,
          payload,
        };
      },
    }),
  });
});

test("plan discards EXTERNALIZE when the atom has no archiveRef", async () => {
  const argumentsWithoutRef = planArguments();
  const selection = argumentsWithoutRef.selection as {
    candidates: Array<{ atom: Record<string, unknown> }>;
  };
  delete selection.candidates[0]?.atom.archiveRef;

  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_plan",
      arguments: argumentsWithoutRef,
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      selection: {
        feasible: boolean;
        discardedUnsafeOptions: number;
        decisions: Array<{ action: string }>;
      };
      assuranceWarnings: string[];
    };
    assert.equal(structured.selection.feasible, false);
    assert.equal(structured.selection.discardedUnsafeOptions, 1);
    assert.equal(structured.selection.decisions[0]?.action, "KEEP");
    assert.deepEqual(structured.assuranceWarnings, [
      "CALLER_ASSERTED_RETENTION_OPTION_METADATA",
    ]);
  });
});

test("plan input rejects DROP before optimizer execution", async () => {
  const argumentsWithDrop = planArguments() as unknown as {
    selection: { candidates: Array<{ options: Array<{ action: string }> }> };
  };
  argumentsWithDrop.selection.candidates[0]!.options[1]!.action = "DROP";
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_plan",
      arguments: argumentsWithDrop,
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /KEEP|SUMMARIZE|EXTERNALIZE/);
  });
});

test("plan fails closed when protected exact externalization lacks a clean scan receipt", async () => {
  const argumentsWithoutScanReceipt = planArguments() as unknown as {
    selection: {
      candidates: Array<{
        options: Array<{ action: string; secretScanStatus?: string }>;
      }>;
    };
  };
  delete argumentsWithoutScanReceipt.selection.candidates[0]!.options[1]!
    .secretScanStatus;

  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_plan",
      arguments: argumentsWithoutScanReceipt,
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      selection: {
        feasible: boolean;
        discardedUnsafeOptions: number;
        decisions: Array<{ action: string }>;
      };
      trigger: { recommendation: string; failClosed: boolean; reasonCodes: string[] };
    };
    assert.equal(structured.selection.feasible, false);
    assert.equal(structured.selection.discardedUnsafeOptions, 1);
    assert.equal(structured.selection.decisions[0]?.action, "KEEP");
    assert.equal(structured.trigger.recommendation, "HOLD");
    assert.equal(structured.trigger.failClosed, true);
    assert.deepEqual(structured.trigger.reasonCodes, ["SELECTION_INFEASIBLE"]);
  });
});

test("status exposes usage proxy while official Codex credits remain null", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "contextgc_status", arguments: {} });
    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured.usageProxy, 11);
    assert.equal(structured.codexChatgptCredits, null);
    assert.equal(
      structured.codexChatgptCreditsReason,
      "public_conversion_unavailable",
    );
    assert.equal(structured.dataDirSource, "server_default");
    assert.equal(structured.storeId, contextGcStoreId(join(process.cwd(), ".contextgc")));
    assert.equal(structured.root, undefined);
    assert.equal(
      structured.dataDirBoundary,
      "mutations_require_a_configured_or_installed_plugin_store",
    );
  });
});

test("MCP rejects a relative dataDir without touching another store", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_status",
      arguments: { dataDir: ".contextgc" },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /absolute path/);
  }, {});
});

test("mutating MCP tools reject an omitted dataDir only for the plain server fallback", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: { frame: { goal: "must not use plugin cache" } },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /dataDir/);
  });
});

test("installed-plugin inference allows an omitted mutation root and returns an opaque receipt", async () => {
  const cwd = join(
    process.cwd(),
    "plugins",
    "cache",
    "context-gc-local",
    "context-gc",
    "0.1.3",
  );
  const inferredRoot = join(
    process.cwd(),
    "plugins",
    "data",
    "context-gc-context-gc-local",
  );
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: { frame: { goal: "use the installed private store" } },
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured.dataDirSource, "plugin_data_inferred");
    assert.equal(structured.storeId, contextGcStoreId(inferredRoot));
    assert.equal(structured.root, undefined);
  }, { runtime: fakeRuntime(), cwd, env: {} });
});

test("configured and environment defaults allow omitted mutation roots", async () => {
  const configuredRoot = join(process.cwd(), "configured-store");
  const pluginDataRoot = join(process.cwd(), "plugin-data-store");

  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: { frame: { goal: "use configured default" } },
    });
    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(result.isError, undefined);
    assert.equal(structured.dataDirSource, "configured_default");
    assert.equal(structured.storeId, contextGcStoreId(configuredRoot));
  }, { runtime: fakeRuntime(), dataDir: configuredRoot, env: {} });

  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: { frame: { goal: "use PLUGIN_DATA default" } },
    });
    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(result.isError, undefined);
    assert.equal(structured.dataDirSource, "env_plugin_data");
    assert.equal(structured.storeId, contextGcStoreId(pluginDataRoot));
  }, { runtime: fakeRuntime(), env: { PLUGIN_DATA: pluginDataRoot } });
});

test("checkpoint accepts a structured Task Frame", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: { goal: "preserve invariants" },
        reason: "phase-boundary",
        dataDir: process.cwd(),
      },
    });
    assert.equal(result.isError, undefined);
    const structured = result.structuredContent as {
      manifest: { checkpointId: string; reason: string };
      frame: { goal: string };
      boundary: Record<string, unknown>;
      dataDirSource: string;
      storeId: string;
    };
    assert.equal(structured.manifest.checkpointId, "cp-1");
    assert.equal(structured.manifest.reason, "phase-boundary");
    assert.equal(structured.frame.goal, "preserve invariants");
    assert.equal(
      structured.boundary.assurance,
      "schema-bounded-untrusted-task-frame-data",
    );
    assert.equal(structured.boundary.promptInjectionSafetyVerified, false);
    assert.equal(structured.dataDirSource, "tool_argument");
    assert.equal(structured.storeId, contextGcStoreId(process.cwd()));
    assert.equal((structured as unknown as Record<string, unknown>).root, undefined);
  });
});

test("checkpoint remains an explicit recovery path when ordinary runtime init is blocked", async () => {
  let created = false;
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: { goal: "Supersede a privacy-unsafe legacy latest" },
        dataDir: process.cwd(),
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(created, true);
  }, {
    runtime: fakeRuntime({
      init: async () => {
        throw new Error("legacy latest is not privacy-marked");
      },
      createCheckpoint: async (frame) => {
        created = true;
        return { manifest: { checkpointId: "cp-recovery" }, frame };
      },
    }),
  });
});

test("checkpoint rejects unknown Task Frame fields and does not forward source session metadata", async () => {
  let forwardedOptions: { reason?: string; sourceSessionId?: string } | undefined;
  await withClient(async (client) => {
    const unknownFrameField = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: { goal: "strict frame", privateMetadata: "must-not-pass" },
        dataDir: process.cwd(),
      },
    });
    assert.equal(unknownFrameField.isError, true);

    const sourceSessionId = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: { goal: "no source session transport" },
        sourceSessionId: "session-private",
        dataDir: process.cwd(),
      },
    });
    assert.equal(sourceSessionId.isError, undefined);
    assert.equal(forwardedOptions?.sourceSessionId, undefined);
  }, {
    runtime: fakeRuntime({
      createCheckpoint: async (frame, options) => {
        forwardedOptions = options;
        return {
          manifest: { checkpointId: "cp-1", reason: options?.reason ?? null },
          frame,
        };
      },
    }),
  });
});

test("checkpoint path fields allow relative and opaque evidence but reject local disclosure paths", async () => {
  await withClient(async (client) => {
    const accepted = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: {
          goal: "bounded paths",
          activeFiles: ["src/mcp/server.ts"],
          evidencePointers: [
            "https://example.test/evidence",
            "ledger:event-1",
            `sha256:${"a".repeat(64)}`,
          ],
        },
        dataDir: process.cwd(),
      },
    });
    assert.equal(accepted.isError, undefined);

    for (const activeFile of ["../secret.txt", "C:\\Users\\private\\secret.txt", "/home/private/secret.txt"]) {
      const rejected = await client.callTool({
        name: "contextgc_checkpoint",
        arguments: {
          frame: { goal: "reject private path", activeFiles: [activeFile] },
          dataDir: process.cwd(),
        },
      });
      assert.equal(rejected.isError, true, activeFile);
    }

    for (const evidencePointer of ["C:\\Users\\private\\receipt.txt", "/home/private/receipt.txt", "file:///private/receipt.txt"]) {
      const rejected = await client.callTool({
        name: "contextgc_checkpoint",
        arguments: {
          frame: { goal: "reject private evidence path", evidencePointers: [evidencePointer] },
          dataDir: process.cwd(),
        },
      });
      assert.equal(rejected.isError, true, evidencePointer);
    }
  });
});

test("model-visible MCP errors redact absolute local paths", async () => {
  const privatePath = "C:\\Users\\private-person\\contextgc\\latest.json";
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_status",
      arguments: { dataDir: process.cwd() },
    });
    assert.equal(result.isError, true);
    const content = JSON.stringify(result.content);
    assert.doesNotMatch(content, /private-person|C:\\\\Users/);
    assert.match(content, /local path details were withheld/);
  }, {
    runtime: fakeRuntime({
      status: async () => {
        throw new Error(`failed to read ${privatePath}`);
      },
    }),
  });
});

test("checkpoint and rehydrate reject oversized bounded inputs", async () => {
  await withClient(async (client) => {
    const oversizedFrame = await client.callTool({
      name: "contextgc_checkpoint",
      arguments: {
        frame: { goal: "x".repeat(4_097) },
        dataDir: process.cwd(),
      },
    });
    assert.equal(oversizedFrame.isError, true);

    const tooManyRefs = await client.callTool({
      name: "contextgc_rehydrate",
      arguments: {
        refs: Array.from({ length: 101 }, () => REF),
        dataDir: process.cwd(),
      },
    });
    assert.equal(tooManyRefs.isError, true);
  });
});

test("rehydrate returns bounded content with an explicit transport encoding", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "contextgc_rehydrate",
      arguments: {
        refs: [REF],
        maxBytes: 100,
        maxItems: 1,
        dataDir: process.cwd(),
      },
    });
    const structured = result.structuredContent as {
      items: Array<{ content: string; encoding: string }>;
    };
    assert.equal(structured.items[0]?.content, "hello");
    assert.equal(structured.items[0]?.encoding, "utf8");
  });
});

test("rehydrate accepts the real archive ContentRef schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-mcp-runtime-"));
  try {
    const runtime = new ContextGcRuntime({ dataDir: root });
    const ref = await runtime.archiveContent("hello");
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "contextgc_rehydrate",
        arguments: { refs: [ref], maxItems: 1, dataDir: root },
      });
      assert.equal(result.isError, undefined);
      const structured = result.structuredContent as {
        items: Array<{ content: string; encoding: string }>;
      };
      assert.equal(structured.items[0]?.content, "hello");
      assert.equal(structured.items[0]?.encoding, "utf8");
    }, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive returns a runtime-verified redacted ContentRef", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-mcp-archive-"));
  try {
    await withClient(async (client) => {
      const secret = ["sk", "-", "test", "a".repeat(28)].join("");
      const archived = await client.callTool({
        name: "contextgc_archive",
        arguments: { text: `api_key=${secret}`, dataDir: root },
      });
      assert.equal(archived.isError, undefined);
      const structured = archived.structuredContent as {
        ref: typeof REF & { sanitized: boolean };
        boundary: Record<string, unknown>;
        storeId: string;
        dataDirSource: string;
      };
      assert.equal(structured.ref.sanitized, true);
      assert.ok(structured.ref.redactions > 0);
      assert.equal(structured.boundary.assurance, "runtime-verified-content-ref");
      assert.equal(structured.boundary.rawOriginalPersisted, false);
      assert.equal(structured.boundary.rawRollbackAvailable, false);
      assert.equal(structured.storeId, contextGcStoreId(root));
      assert.equal(structured.dataDirSource, "tool_argument");
      assert.equal((structured as unknown as Record<string, unknown>).root, undefined);

      const rehydrated = await client.callTool({
        name: "contextgc_rehydrate",
        arguments: { refs: [structured.ref], dataDir: root },
      });
      const restored = rehydrated.structuredContent as {
        items: Array<{ content: string }>;
      };
      assert.doesNotMatch(restored.items[0]!.content, /sk-/);
      assert.match(restored.items[0]!.content, /REDACTED/);
    }, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan persists its advisory receipt in the selected runtime ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-mcp-plan-ledger-"));
  try {
    let receiptHash = "";
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "contextgc_plan",
        arguments: planArguments(root),
      });
      assert.equal(result.isError, undefined);
      receiptHash = (
        result.structuredContent as { auditReceipt: { receiptHash: string } }
      ).auditReceipt.receiptHash;
    }, {});

    const runtime = new ContextGcRuntime({ dataDir: root });
    const records = await runtime.ledger.readAll();
    const evaluated = records.find((record) => record.type === "policy-evaluated");
    assert.ok(evaluated);
    const payload = evaluated.payload as Record<string, unknown>;
    assert.equal(payload.receiptHash, receiptHash);
    assert.equal(
      (payload.boundary as Record<string, unknown>).assurance,
      "advisory-caller-asserted",
    );
    assert.match(receiptHash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkpoint, status, and restore share an explicit MCP dataDir", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-mcp-shared-"));
  try {
    await withClient(async (client) => {
      const checkpoint = await client.callTool({
        name: "contextgc_checkpoint",
        arguments: { frame: { goal: "one shared store" }, dataDir: root },
      });
      assert.equal(checkpoint.isError, undefined);
      const checkpointId = (
        checkpoint.structuredContent as { manifest: { checkpointId: string } }
      ).manifest.checkpointId;

      const status = await client.callTool({
        name: "contextgc_status",
        arguments: { dataDir: root },
      });
      const statusData = status.structuredContent as Record<string, unknown>;
      assert.equal(statusData.root, undefined);
      assert.equal(statusData.latestCheckpointId, checkpointId);
      assert.equal(statusData.checkpointCount, 1);
      assert.equal(statusData.dataDirSource, "tool_argument");
      assert.equal(statusData.storeId, contextGcStoreId(root));
      assert.equal(statusData.dataDirBoundary, null);

      const restored = await client.callTool({
        name: "contextgc_restore",
        arguments: { checkpointId, dataDir: root },
      });
      assert.equal(restored.isError, undefined);
      assert.equal(
        (restored.structuredContent as { manifest: { checkpointId: string } })
          .manifest.checkpointId,
        checkpointId,
      );
    }, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model-facing tools recover from an invalid latest pointer without loading it", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-mcp-invalid-latest-"));
  try {
    await withClient(async (client) => {
      const first = await client.callTool({
        name: "contextgc_checkpoint",
        arguments: { frame: { goal: "known verified checkpoint" }, dataDir: root },
      });
      const firstId = (
        first.structuredContent as { manifest: { checkpointId: string } }
      ).manifest.checkpointId;

      await writeFile(join(root, "latest.json"), '{"schemaVersion":99}\n', "utf8");
      const invalidStatus = await client.callTool({
        name: "contextgc_status",
        arguments: { dataDir: root },
      });
      assert.equal(invalidStatus.isError, undefined);
      const invalidStatusData = invalidStatus.structuredContent as Record<string, unknown>;
      assert.equal(invalidStatusData.latestCheckpointId, null);
      assert.equal(invalidStatusData.latestCheckpointStatus, "invalid");

      const restored = await client.callTool({
        name: "contextgc_restore",
        arguments: { checkpointId: firstId, dataDir: root },
      });
      assert.equal(restored.isError, undefined);
      assert.equal(
        (restored.structuredContent as { manifest: { checkpointId: string } }).manifest.checkpointId,
        firstId,
      );

      await writeFile(join(root, "latest.json"), '{"schemaVersion":99}\n', "utf8");
      const successor = await client.callTool({
        name: "contextgc_checkpoint",
        arguments: { frame: { goal: "strict successor" }, dataDir: root },
      });
      assert.equal(successor.isError, undefined);
      assert.equal(
        (successor.structuredContent as { manifest: { parentCheckpointId: string | null } })
          .manifest.parentCheckpointId,
        null,
      );

      const recoveredStatus = await client.callTool({
        name: "contextgc_status",
        arguments: { dataDir: root },
      });
      const recoveredStatusData = recoveredStatus.structuredContent as Record<string, unknown>;
      assert.equal(recoveredStatusData.latestCheckpointStatus, "verified");
      assert.equal(
        recoveredStatusData.latestCheckpointId,
        (successor.structuredContent as { manifest: { checkpointId: string } }).manifest.checkpointId,
      );
    }, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
