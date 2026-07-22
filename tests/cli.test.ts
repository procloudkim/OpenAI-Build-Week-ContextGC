import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HELP_TEXT, parseArgs, UsageError } from "../src/cli/args.js";
import { runCli } from "../src/cli/main.js";
import type { CliIo, ContextGcService } from "../src/cli/types.js";

function fakeRuntime(overrides: Partial<ContextGcService> = {}): ContextGcService {
  return {
    init: async () => undefined,
    status: async () => ({ initialized: false }),
    appendEvent: async (type, payload) => ({ type, payload }),
    archiveContent: async () => ({}),
    createCheckpoint: async (frame) => ({ manifest: { checkpointId: "cp-1" }, frame }),
    restoreCheckpoint: async (id) => ({ manifest: { checkpointId: id } }),
    rollback: async () => ({}),
    rehydrate: async () => ({}),
    ...overrides,
  };
}

function captureIo(cwd: string, env: NodeJS.ProcessEnv = {}): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      readStdin: async () => "",
      stdinIsTTY: true,
      env,
      cwd: () => cwd,
    },
  };
}

test("argument parser rejects restore without exactly one checkpoint id", () => {
  assert.throws(() => parseArgs(["restore"]), UsageError);
  assert.throws(() => parseArgs(["restore", "one", "two"]), UsageError);
  assert.equal(parseArgs(["restore", "one"]).checkpointId, "one");
});

test("runtime selection flags are explicit and accepted by every operational command", () => {
  const commands: readonly (readonly string[])[] = [
    ["status"],
    ["simulate"],
    ["checkpoint"],
    ["restore", "checkpoint-id"],
    ["report"],
  ];
  for (const command of commands) {
    const parsed = parseArgs([...command, "--cwd", "workspace", "--data-dir", "store"]);
    assert.equal(parsed.cwd, "workspace");
    assert.equal(parsed.dataDir, "store");
  }
  assert.match(HELP_TEXT, /Runtime selection options \(all non-help commands\):/u);
  assert.match(HELP_TEXT, /--data-dir PATH/u);
});

test("status reports the public Codex credit-conversion boundary", async () => {
  const capture = captureIo(process.cwd());
  const exitCode = await runCli(["status", "--compact"], capture.io, {
    runtimeFactory: () => fakeRuntime({
      status: async () => ({ initialized: true, usageProxy: 42, estimatedCredits: 999 }),
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(capture.stderr.length, 0);
  const output = JSON.parse(capture.stdout.join("")) as {
    data: Record<string, unknown>;
  };
  assert.equal(output.data.usageProxy, 42);
  assert.equal(output.data.codexChatgptCredits, null);
  assert.equal(output.data.codexChatgptCreditsReason, "public_conversion_unavailable");
  assert.equal("estimatedCredits" in output.data, false);
});

test("checkpoint loads the current Task Frame mirror by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-cli-"));
  try {
    await writeFile(join(root, "task-frame.json"), JSON.stringify({ goal: "ship safely" }));
    let received: Record<string, unknown> | undefined;
    const capture = captureIo(process.cwd(), { CONTEXTGC_HOME: root });
    const exitCode = await runCli(["checkpoint", "--reason", "phase-boundary"], capture.io, {
      runtimeFactory: () => fakeRuntime({
        createCheckpoint: async (frame, options) => {
          received = frame;
          return { manifest: { checkpointId: "cp-1", reason: options?.reason ?? null }, frame };
        },
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(received, { goal: "ship safely" });
    const output = JSON.parse(capture.stdout.join("")) as {
      data: { manifest: { reason: string } };
    };
    assert.equal(output.data.manifest.reason, "phase-boundary");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("simulate forwards resolved fixture and output paths to the lazy benchmark", async () => {
  const capture = captureIo("C:\\workspace");
  let received: unknown;
  const exitCode = await runCli(
    ["simulate", "--fixtures", "fixtures", "--output", "evidence", "--compact"],
    capture.io,
    {
      benchmarkRunner: async (options) => {
        received = options;
        return { policies: 3 };
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(received, {
    fixturesDir: "C:\\workspace\\fixtures",
    outputDir: "C:\\workspace\\evidence",
  });
});

test("simulate defaults receipts to the resolved local data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-simulate-"));
  try {
    const capture = captureIo(process.cwd(), { PLUGIN_DATA: root });
    let received: unknown;
    const exitCode = await runCli(["simulate", "--compact"], capture.io, {
      benchmarkRunner: async (options) => {
        received = options;
        return { policies: 3 };
      },
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(received, { outputDir: join(root, "receipts") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report reads the latest receipt and never promotes API equivalents to credits", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-report-"));
  try {
    await mkdir(join(root, "receipts"), { recursive: true });
    await writeFile(
      join(root, "receipts", "latest.json"),
      JSON.stringify({ usageProxy: 17, estimatedApiEquivalentUsd: 0.002 }),
    );
    const capture = captureIo(process.cwd(), { PLUGIN_DATA: root });
    const exitCode = await runCli(["report", "--compact"], capture.io);
    assert.equal(exitCode, 0);
    const output = JSON.parse(capture.stdout.join("")) as {
      data: Record<string, unknown>;
    };
    assert.equal(output.data.usageProxy, 17);
    assert.equal(output.data.estimatedApiEquivalentUsd, 0.002);
    assert.equal(output.data.codexChatgptCredits, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report exposes per-policy usage proxies from a benchmark receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextgc-report-aggregate-"));
  try {
    await mkdir(join(root, "receipts"), { recursive: true });
    await writeFile(
      join(root, "receipts", "latest.json"),
      JSON.stringify({
        aggregates: [
          { policy: "manual", totalUsageProxy: 100 },
          { policy: "adaptive", totalUsageProxy: 70 },
        ],
      }),
    );
    const capture = captureIo(process.cwd(), { CONTEXTGC_HOME: root });
    const exitCode = await runCli(["report", "--compact"], capture.io);
    assert.equal(exitCode, 0);
    const output = JSON.parse(capture.stdout.join("")) as {
      data: { usageProxy: Record<string, number> };
    };
    assert.deepEqual(output.data.usageProxy, { manual: 100, adaptive: 70 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
