import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  ContentArchive,
  ContextGcRuntime,
  MAX_CHECKPOINT_FRAME_BYTES,
  MAX_CHECKPOINT_MANIFEST_BYTES,
  MAX_LATEST_POINTER_BYTES,
  RuntimeCapacityError,
  isByteExactRef,
  RuntimeIntegrityError,
  TranscriptSchemaError,
  isSupportedCodexCliVersion,
  readCodexTranscriptTelemetry,
  redactText,
  resolveRuntimePaths,
  toCoreTokenUsage,
} from "../src/runtime/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    assert.ok(directory.startsWith(resolve(tmpdir())), "cleanup target must remain in the OS temp directory");
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime paths prefer explicit data, PLUGIN_DATA, CONTEXTGC_HOME, then cwd", () => {
  const cwd = resolve("workspace");
  assert.equal(resolveRuntimePaths({ cwd, env: {} }).root, resolve(cwd, ".contextgc"));
  assert.equal(
    resolveRuntimePaths({ cwd, env: { CONTEXTGC_HOME: "context-home" } }).root,
    resolve("context-home"),
  );
  assert.equal(
    resolveRuntimePaths({ cwd, env: { PLUGIN_DATA: "plugin", CONTEXTGC_HOME: "context" } }).root,
    resolve("plugin"),
  );
  assert.equal(
    resolveRuntimePaths({ cwd, dataDir: "explicit", env: { PLUGIN_DATA: "plugin" } }).root,
    resolve("explicit"),
  );
});

test("checkpoints are reversible, immutable, and discard caller-defined fields", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const firstFrame = {
    schemaVersion: 1,
    checkpointId: "caller-value-must-be-replaced",
    createdAt: "2000-01-01T00:00:00.000Z",
    goal: "Preserve exact constraints",
    constraints: ["never delete raw context"],
    customField: "must-not-cross-the-checkpoint-boundary",
  };
  const secondFrame = {
    schemaVersion: 1,
    checkpointId: "another-caller-value",
    createdAt: "2000-01-02T00:00:00.000Z",
    goal: "Preserve exact constraints",
    constraints: ["never delete raw context", "rehydration is bounded"],
  };

  const first = await runtime.createCheckpoint(firstFrame, { reason: "initial" });
  const second = await runtime.createCheckpoint(secondFrame, { reason: "update" });
  assert.equal(second.manifest.parentCheckpointId, first.manifest.checkpointId);

  const rolledBack = await runtime.rollback<typeof firstFrame>();
  assert.equal(rolledBack.frame.checkpointId, first.manifest.checkpointId);
  assert.equal(rolledBack.frame.createdAt, first.manifest.createdAt);
  assert.notEqual(rolledBack.frame.checkpointId, firstFrame.checkpointId);
  assert.equal("customField" in rolledBack.frame, false);
  assert.deepEqual(rolledBack.frame.decisions, []);
  assert.deepEqual(rolledBack.frame.evidencePointers, []);
  assert.equal((await runtime.status()).latestCheckpointId, first.manifest.checkpointId);

  const restored = await runtime.restoreCheckpoint<typeof secondFrame>(second.manifest.checkpointId);
  assert.equal(restored.frame.checkpointId, second.manifest.checkpointId);
  assert.equal(restored.frame.createdAt, second.manifest.createdAt);
  assert.deepEqual(restored.frame.constraints, secondFrame.constraints);
  assert.deepEqual(JSON.parse(await readFile(runtime.paths.taskFrame, "utf8")), restored.frame);

  const originalStillExists = await runtime.checkpoints.read<typeof firstFrame>(first.manifest.checkpointId);
  assert.deepEqual(originalStillExists.frame, rolledBack.frame);
  assert.equal((await runtime.status()).checkpointCount, 2);
});

test("a minimal MCP-style frame becomes the latest hook-loadable Task Frame", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const checkpoint = await runtime.createCheckpoint({ goal: "Resume the verified migration" });
  const mirror = JSON.parse(await readFile(runtime.paths.taskFrame, "utf8")) as Record<string, unknown>;

  assert.equal(mirror.schemaVersion, 1);
  assert.equal(mirror.checkpointId, checkpoint.manifest.checkpointId);
  assert.equal(mirror.createdAt, checkpoint.manifest.createdAt);
  for (const key of [
    "constraints",
    "decisions",
    "openLoops",
    "activeFiles",
    "testEvidence",
    "failedAttempts",
    "evidencePointers",
  ]) {
    assert.deepEqual(mirror[key], []);
  }

  const hookOutput = await runHook(root, {
    hook_event_name: "SessionStart",
    cwd: root,
    session_id: "runtime-integration-session",
    turn_id: "runtime-integration-turn",
    source: "startup",
  });
  const parsed = JSON.parse(hookOutput) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  assert.match(
    parsed.hookSpecificOutput?.additionalContext ?? "",
    new RegExp(checkpoint.manifest.checkpointId),
  );
});

test("a marked checkpoint can safely supersede a markerless legacy latest", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const legacy = await runtime.createCheckpoint({ goal: "Legacy checkpoint" });
  const legacyManifestPath = resolve(
    runtime.paths.checkpoints,
    legacy.manifest.checkpointId,
    "manifest.json",
  );
  const legacyManifest = JSON.parse(await readFile(legacyManifestPath, "utf8")) as Record<string, unknown>;
  delete legacyManifest.privacyBoundary;
  await writeFile(legacyManifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => runtime.checkpoints.read(legacy.manifest.checkpointId),
    /invalid manifest/,
  );
  const blocked = JSON.parse(await runHook(root, {
    hook_event_name: "PreCompact",
    cwd: root,
    session_id: "legacy-recovery-session",
    turn_id: "legacy-recovery-turn",
    trigger: "auto",
  })) as { continue?: boolean };
  assert.equal(blocked.continue, false);

  const successor = await runtime.createCheckpoint({ goal: "Verified current task only" });
  assert.equal(successor.manifest.parentCheckpointId, null);
  assert.equal(successor.manifest.privacyBoundary, "deterministic-minimization-v1");
  const recoveredOutput = await runHook(root, {
    hook_event_name: "PreCompact",
    cwd: root,
    session_id: "legacy-recovery-session",
    turn_id: "legacy-recovery-turn",
    trigger: "auto",
  }, true);
  const recovered = recoveredOutput.trim() === ""
    ? {}
    : JSON.parse(recoveredOutput) as { continue?: boolean };
  assert.notEqual(recovered.continue, false);
});

test("invalid and corrupt latest targets do not block explicit restore or strict successors", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const known = await runtime.createCheckpoint({ goal: "Known verified checkpoint" });

  await writeFile(runtime.paths.latest, '{not-json\n', "utf8");
  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");
  const restored = await runtime.restoreCheckpoint(known.manifest.checkpointId);
  assert.equal(restored.manifest.checkpointId, known.manifest.checkpointId);
  assert.equal((await runtime.status()).latestCheckpointId, known.manifest.checkpointId);
  assert.deepEqual(JSON.parse(await readFile(runtime.paths.taskFrame, "utf8")), restored.frame);

  const corrupt = await runtime.createCheckpoint({ goal: "Corrupt latest target" });
  const corruptManifestPath = resolve(
    runtime.paths.checkpoints,
    corrupt.manifest.checkpointId,
    "manifest.json",
  );
  await writeFile(corruptManifestPath, '{broken-manifest\n', "utf8");
  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");

  const successor = await runtime.createCheckpoint({ goal: "Verified current task only" });
  assert.equal(successor.manifest.parentCheckpointId, null);
  assert.equal((await runtime.status()).latestCheckpointStatus, "verified");
  assert.equal((await runtime.status()).latestCheckpointId, successor.manifest.checkpointId);
  assert.deepEqual(
    JSON.parse(await readFile(runtime.paths.taskFrame, "utf8")),
    successor.frame,
  );

  const missingId = "00000000-0000-4000-8000-000000000000";
  await writeFile(
    runtime.paths.latest,
    `${JSON.stringify({ schemaVersion: 1, checkpointId: missingId }, null, 2)}\n`,
    "utf8",
  );
  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");
  const missingTargetSuccessor = await runtime.createCheckpoint({ goal: "Missing-target recovery" });
  assert.equal(missingTargetSuccessor.manifest.parentCheckpointId, null);
  assert.equal((await runtime.status()).latestCheckpointStatus, "verified");

  const precompactOutput = await runHook(root, {
    hook_event_name: "PreCompact",
    cwd: root,
    session_id: "invalid-latest-recovery-session",
    turn_id: "invalid-latest-recovery-turn",
    trigger: "auto",
  }, true);
  const precompact = precompactOutput.trim() === ""
    ? {}
    : JSON.parse(precompactOutput) as { continue?: boolean };
  assert.notEqual(precompact.continue, false);
});

test("status verifies the Task Frame mirror and init repairs it from canonical bytes", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const checkpoint = await runtime.createCheckpoint({ goal: "Mirror repair" });
  await writeFile(runtime.paths.taskFrame, '{"schemaVersion":1,"goal":"tampered"}\n', "utf8");

  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");
  await runtime.init();
  assert.equal((await runtime.status()).latestCheckpointStatus, "verified");
  assert.deepEqual(JSON.parse(await readFile(runtime.paths.taskFrame, "utf8")), checkpoint.frame);
});

test("an oversized latest pointer is invalid and cannot become successor lineage", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  await runtime.createCheckpoint({ goal: "Bound latest pointer reads" });
  await writeFile(runtime.paths.latest, "x".repeat(MAX_LATEST_POINTER_BYTES + 1), "utf8");

  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");
  const successor = await runtime.createCheckpoint({ goal: "Recover from oversized latest" });
  assert.equal(successor.manifest.parentCheckpointId, null);
  assert.equal((await runtime.status()).latestCheckpointStatus, "verified");
});

test("failed latest publication restores the previous Task Frame mirror", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const first = await runtime.createCheckpoint({ goal: "Published baseline" });
  const previousMirror = await readFile(runtime.paths.taskFrame);

  await rm(runtime.paths.latest);
  await mkdir(runtime.paths.latest);
  await assert.rejects(
    () => runtime.createCheckpoint({ goal: "Must not split latest and mirror" }),
  );
  assert.deepEqual(await readFile(runtime.paths.taskFrame), previousMirror);
  assert.equal((await runtime.status()).latestCheckpointStatus, "invalid");
  assert.deepEqual(
    (await runtime.checkpoints.read(first.manifest.checkpointId)).frame,
    first.frame,
  );
});

test("archive verifies hashes and bounds rehydration", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const first = await runtime.archiveContent("first payload");
  const second = await runtime.archiveContent("second payload is larger");

  const bounded = await runtime.rehydrate([first, second], {
    maxBytes: first.bytes,
    maxItems: 2,
  });
  assert.equal(bounded.items.length, 1);
  assert.equal(Buffer.from(bounded.items[0]!.content).toString("utf8"), "first payload");
  assert.equal(first.secretScanStatus, "clean");
  assert.equal(isByteExactRef(first), true);
  assert.equal(bounded.omitted[0]?.reason, "byte-limit");

  const objectPath = resolve(runtime.paths.archive, first.hash.slice(0, 2), first.hash);
  await writeFile(objectPath, "corrupted payload", "utf8");
  await assert.rejects(() => runtime.archive.get(first), RuntimeIntegrityError);
});

test("opaque binary is integrity-preserved but never marked secret-safe exact", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const opaqueSecret = Buffer.from(["sk", "-", "test", "a".repeat(28)].join(""), "utf8");
  const ref = await runtime.archiveContent(opaqueSecret);

  assert.equal(ref.mediaType, "application/octet-stream");
  assert.equal(ref.secretScanStatus, "unscanned");
  assert.equal(ref.sanitized, false);
  assert.equal(ref.redactions, 0);
  assert.equal(isByteExactRef(ref), false);
  assert.deepEqual(Buffer.from(await runtime.archive.get(ref)), opaqueSecret);

  await assert.rejects(
    () => runtime.archive.get({ ...ref, secretScanStatus: "clean" }),
    RuntimeIntegrityError,
  );
});

test("archive total/object and checkpoint frame caps fail closed", async () => {
  const root = await temporaryRoot();
  const archive = new ContentArchive(resolve(root, "capped-archive"), {
    maxObjectBytes: 12,
    maxTotalBytes: 15,
  });
  await archive.put("abcdefghij");
  await assert.rejects(() => archive.put("sixsix"), RuntimeCapacityError);
  await assert.rejects(() => archive.put("abcdefghijklm"), RuntimeCapacityError);
  const expandingArchive = new ContentArchive(resolve(root, "expanding-archive"), {
    maxObjectBytes: 10,
  });
  await assert.rejects(
    () => expandingArchive.put("+123456789"),
    /Sanitized archive object is .* maximum/,
  );

  const runtime = new ContextGcRuntime({ dataDir: resolve(root, "frame-cap") });
  await assert.rejects(
    () => runtime.createCheckpoint({ goal: "x".repeat(MAX_CHECKPOINT_FRAME_BYTES) }),
    RuntimeCapacityError,
  );
  await assert.rejects(
    () => runtime.createCheckpoint({ goal: "+821012345678,".repeat(17_000) }),
    /Redacted Task frame is .* maximum/,
  );
  await assert.rejects(
    () => runtime.createCheckpoint(
      { goal: "bounded manifest" },
      { reason: "r".repeat(MAX_CHECKPOINT_MANIFEST_BYTES) },
    ),
    /Checkpoint manifest is .* maximum/,
  );
  assert.equal((await runtime.status()).checkpointCount, 0);
});

test("secrets are redacted before archive, checkpoint, and ledger persistence", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const secret = ["sk", "-", "test", "a".repeat(28)].join("");
  const github = ["ghp", "_", "test", "b".repeat(28)].join("");
  const ref = await runtime.archiveContent(`api_key=${secret}\nAuthorization: Bearer ${github}`);
  const restored = await runtime.archive.get(ref);
  assert.doesNotMatch(Buffer.from(restored).toString("utf8"), /sk-|ghp_/);
  assert.ok(ref.redactions >= 2);
  assert.equal(ref.secretScanStatus, "sanitized");
  assert.equal(ref.sanitized, true);
  assert.equal(isByteExactRef(ref), false);
  assert.notEqual(Buffer.from(restored).toString("utf8"), `api_key=${secret}\nAuthorization: Bearer ${github}`);

  const checkpoint = await runtime.createCheckpoint({
    schemaVersion: 1,
    checkpointId: "redacted",
    goal: `use ${secret}`,
    password: "not-for-disk",
  }, { reason: `credential ${secret}` });
  assert.doesNotMatch(JSON.stringify(checkpoint.frame), /sk-|not-for-disk/);
  assert.equal(checkpoint.manifest.frameRef.sanitized, true);
  assert.doesNotMatch(checkpoint.manifest.reason ?? "", /sk-/);

  await runtime.appendEvent("probe", { token: github, nested: `password=${secret}` });
  const persisted = await readFile(runtime.paths.ledger, "utf8");
  assert.doesNotMatch(persisted, /sk-|ghp_|not-for-disk/);
  assert.match(persisted, /REDACTED/);
});

test("PII heuristics preserve numeric evidence and remote URL routes", () => {
  for (const evidence of [
    "1712345678",
    "192.168.100.200",
    "2026-07-19 12",
    "https://example.test/home/project",
    "https://example.test/Users/project",
  ]) {
    assert.deepEqual(redactText(evidence), { value: evidence, count: 0 });
  }

  for (const phone of ["+82 10-1234-5678", "010-1234-5678", "(555) 123-4567"]) {
    const redacted = redactText(phone);
    assert.equal(redacted.value, "[REDACTED:phone]");
    assert.equal(redacted.count, 1);
  }

  for (const localFileUri of [
    "file:///home/private-owner/context.txt",
    "file:///Users/PrivateOwner/context.txt",
    "file://localhost/home/private-owner/context.txt",
    "file://fileserver/Users/PrivateOwner/context.txt",
    "file:////home/private-owner/context.txt",
    "file://localhost//home/private-owner/context.txt",
    "file:///home\\private-owner\\context.txt",
    "file:///%68ome/private-owner/context.txt",
    "file%3A%2F%2F%2Fhome%2Fprivate-owner%2Fcontext.txt",
  ]) {
    const redacted = redactText(localFileUri);
    assert.equal(redacted.value, "[REDACTED:file-uri]");
    assert.equal(redacted.count, 1);
  }
});

test("checkpoint persistence minimizes common PII and hashes source session ids", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const email = "checkpoint.owner@example.test";
  const phone = "+82 10-1234-5678";
  const windowsHome = "C:\\Users\\PrivateOwner\\Documents\\context.txt";
  const macHome = "/Users/PrivateOwner/context.txt";
  const linuxHome = "/home/private-owner/context.txt";
  const localFileUri = "file:///home/file-uri-owner/context.txt";
  const sourceSessionId = "private-session-id-7df2b467";
  const customValue = "caller-extra-must-never-persist-18f76fd0";

  const checkpoint = await runtime.createCheckpoint({
    goal: `Coordinate with ${email}`,
    constraints: [`Call ${phone}`],
    decisions: [`Do not expose ${windowsHome}`],
    openLoops: [`Inspect ${macHome}`],
    activeFiles: ["src/runtime/checkpoints.ts"],
    testEvidence: [`Local trace: ${linuxHome}`],
    failedAttempts: [`Owner ${email} was unavailable`, `Inspect ${localFileUri}`],
    evidencePointers: [`https://example.test/evidence?owner=${email}`],
    customField: customValue,
  }, {
    reason: `Privacy checkpoint for ${email}, ${phone}, and ${windowsHome}`,
    sourceSessionId,
  });

  assert.equal("customField" in checkpoint.frame, false);
  assert.match(checkpoint.frame.goal, /\[REDACTED:email\]/);
  assert.match(checkpoint.frame.constraints[0] ?? "", /\[REDACTED:phone\]/);
  assert.match(checkpoint.frame.decisions[0] ?? "", /C:\\Users\\\[REDACTED:user\]/);
  assert.match(checkpoint.frame.openLoops[0] ?? "", /\/Users\/\[REDACTED:user\]/);
  assert.match(checkpoint.frame.testEvidence[0] ?? "", /\/home\/\[REDACTED:user\]/);
  assert.equal(checkpoint.frame.failedAttempts[1], "Inspect [REDACTED:file-uri]");
  assert.match(checkpoint.manifest.reason ?? "", /\[REDACTED:email\]/);
  assert.match(checkpoint.manifest.reason ?? "", /\[REDACTED:phone\]/);
  assert.match(checkpoint.manifest.sourceSessionId ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.ok(checkpoint.manifest.frameRef.redactions >= 7);
  assert.equal(checkpoint.manifest.frameRef.secretScanStatus, "sanitized");
  assert.deepEqual(
    (await runtime.checkpoints.read(checkpoint.manifest.checkpointId)).frame,
    checkpoint.frame,
  );

  const checkpointDirectory = resolve(runtime.paths.checkpoints, checkpoint.manifest.checkpointId);
  const persistedCorpus = [
    await readFile(resolve(checkpointDirectory, "task-frame.json"), "utf8"),
    await readFile(resolve(checkpointDirectory, "manifest.json"), "utf8"),
    await readFile(runtime.paths.taskFrame, "utf8"),
    Buffer.from(await runtime.archive.get(checkpoint.manifest.frameRef)).toString("utf8"),
    await readFile(runtime.paths.ledger, "utf8"),
  ].join("\n");

  for (const rawValue of [
    email,
    phone,
    "PrivateOwner",
    "private-owner",
    "file-uri-owner",
    sourceSessionId,
    customValue,
    "customField",
  ]) {
    assert.equal(persistedCorpus.includes(rawValue), false, `persisted raw value: ${rawValue}`);
  }
});

test("checkpoint runtime rejects absolute and traversing local references", async () => {
  const root = await temporaryRoot();
  const runtime = new ContextGcRuntime({ dataDir: root });
  const unsafeFrames = [
    { goal: "reject drive path", activeFiles: ["D:\\private\\source.ts"] },
    { goal: "reject POSIX path", activeFiles: ["/home/private/source.ts"] },
    { goal: "reject traversal", activeFiles: ["src/../../private.txt"] },
    { goal: "reject URL as active file", activeFiles: ["https://example.test/source.ts"] },
    { goal: "reject ambiguous relative path", activeFiles: ["src//source.ts"] },
    { goal: "reject file URI", evidencePointers: ["file:///home/private/evidence.txt"] },
    { goal: "reject encoded file URI", evidencePointers: ["file%3A%2F%2F%2Fhome%2Fprivate%2Fevidence.txt"] },
    { goal: "reject evidence traversal", evidencePointers: ["../private/evidence.txt"] },
  ];

  for (const frame of unsafeFrames) {
    await assert.rejects(
      () => runtime.createCheckpoint(frame),
      /must not contain an absolute or traversing local path/,
    );
  }
  assert.equal((await runtime.status()).checkpointCount, 0);
});

test("Codex telemetry adapter reads the guarded observed schema", async () => {
  const root = await temporaryRoot();
  const transcript = resolve(root, "rollout.jsonl");
  const usage = {
    input_tokens: 120,
    cached_input_tokens: 80,
    cache_write_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 4,
    total_tokens: 130,
  };
  await writeTranscript(transcript, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "session-1", cli_version: "0.144.5" },
    },
    {
      timestamp: "2026-07-18T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: usage,
          last_token_usage: usage,
          model_context_window: 258_400,
        },
      },
    },
    {
      timestamp: "2026-07-18T00:00:02.000Z",
      type: "event_msg",
      payload: { type: "context_compacted" },
    },
  ]);

  const telemetry = await readCodexTranscriptTelemetry(transcript);
  assert.equal(telemetry.cliVersion, "0.144.5");
  assert.equal(telemetry.events.length, 2);
  assert.equal(telemetry.latestTotal?.cachedInputTokens, 80);
  assert.equal(telemetry.compactionCount, 1);
  assert.deepEqual(toCoreTokenUsage(telemetry.latestTotal!), {
    uncachedInputTokens: 40,
    cachedInputTokens: 80,
    cacheWriteInputTokens: 0,
    outputTokens: 10,
  });
});

test("Codex 0.145.0 stable telemetry fixture preserves guarded usage categories", async () => {
  const transcript = resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "codex-0.145.0-transcript.jsonl",
  );

  const telemetry = await readCodexTranscriptTelemetry(transcript);
  assert.equal(telemetry.cliVersion, "0.145.0");
  assert.equal(telemetry.events.length, 2);
  assert.equal(telemetry.latestTotal?.inputTokens, 240);
  assert.equal(telemetry.latestTotal?.cachedInputTokens, 160);
  assert.equal(telemetry.latestTotal?.cacheWriteInputTokens, 20);
  assert.equal(telemetry.compactionCount, 1);
  assert.deepEqual(toCoreTokenUsage(telemetry.latestTotal!), {
    uncachedInputTokens: 80,
    cachedInputTokens: 160,
    cacheWriteInputTokens: 20,
    outputTokens: 12,
  });
});

test("Codex telemetry version allowlist accepts only verified stable and prerelease schemas", () => {
  assert.equal(isSupportedCodexCliVersion("0.144.6"), true);
  assert.equal(isSupportedCodexCliVersion("0.145.0-alpha.30"), true);
  assert.equal(isSupportedCodexCliVersion("0.145.0"), true);

  assert.equal(isSupportedCodexCliVersion("0.145.1"), false);
  assert.equal(isSupportedCodexCliVersion("0.145.0-beta.1"), false);
  assert.equal(isSupportedCodexCliVersion("0.146.0"), false);
});

test("telemetry persistence hashes the source session identifier", async () => {
  const root = await temporaryRoot();
  const transcript = resolve(root, "persisted-telemetry.jsonl");
  const sourceSessionId = "private-telemetry-session-7df2b467";
  await writeTranscript(transcript, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: sourceSessionId, cli_version: "0.144.5" },
    },
  ]);

  const runtime = new ContextGcRuntime({ dataDir: resolve(root, "store") });
  await runtime.readTranscriptTelemetry(transcript);
  const ledger = await readFile(runtime.paths.ledger, "utf8");
  assert.equal(ledger.includes(sourceSessionId), false);
  assert.match(ledger, /"sessionIdHash":"sha256:[a-f0-9]{64}"/);
  assert.equal(ledger.includes('"sessionId"'), false);
});

test("Codex telemetry marks an omitted cache-write category as unknown, not zero", async () => {
  const root = await temporaryRoot();
  const transcript = resolve(root, "omitted-cache-write.jsonl");
  const usage = {
    input_tokens: 120,
    cached_input_tokens: 80,
    output_tokens: 10,
    reasoning_output_tokens: 4,
    total_tokens: 130,
  };
  await writeTranscript(transcript, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "session-1", cli_version: "0.145.0-alpha.18" },
    },
    {
      timestamp: "2026-07-18T00:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: usage, last_token_usage: usage, model_context_window: 258_400 },
      },
    },
  ]);
  const telemetry = await readCodexTranscriptTelemetry(transcript);
  assert.equal(telemetry.latestTotal?.cacheWriteInputTokens, null);
  assert.equal(toCoreTokenUsage(telemetry.latestTotal!), null);
});

test("Codex telemetry adapter fails closed for unknown versions and changed token schema", async () => {
  const root = await temporaryRoot();
  const unknownVersion = resolve(root, "unknown-version.jsonl");
  await writeTranscript(unknownVersion, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "session-1", cli_version: "9.9.9" },
    },
  ]);
  await assert.rejects(() => readCodexTranscriptTelemetry(unknownVersion), TranscriptSchemaError);

  const changedSchema = resolve(root, "changed-schema.jsonl");
  await writeTranscript(changedSchema, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "session-1", cli_version: "0.145.0-alpha.18" },
    },
    {
      timestamp: "2026-07-18T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "token_count", info: { tokens: 42 } },
    },
  ]);
  await assert.rejects(() => readCodexTranscriptTelemetry(changedSchema), TranscriptSchemaError);

  const unknownEnvelope = resolve(root, "unknown-envelope.jsonl");
  await writeTranscript(unknownEnvelope, [
    {
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "session_meta",
      payload: { session_id: "session-1", cli_version: "0.144.5" },
    },
    {
      timestamp: "2026-07-18T00:00:01.000Z",
      type: "future_format",
      payload: {},
    },
  ]);
  await assert.rejects(() => readCodexTranscriptTelemetry(unknownEnvelope), TranscriptSchemaError);
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "contextgc-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeTranscript(path: string, records: readonly object[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function runHook(root: string, input: object, allowEmpty = false): Promise<string> {
  const child = spawn(process.execPath, [resolve(process.cwd(), "hooks", "run-hook.mjs")], {
    env: { ...process.env, PLUGIN_DATA: root, CONTEXTGC_HOME: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const [code] = await once(child, "close") as [number | null];
  assert.equal(code, 0, stderr);
  if (!allowEmpty) assert.notEqual(stdout.trim(), "", stderr);
  return stdout;
}
