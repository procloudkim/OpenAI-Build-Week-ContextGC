import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadBenchmarkFixtures } from "../src/eval/fixture-loader.js";
import { EvaluationMemory } from "../src/eval/memory.js";
import {
  loadBenchmarkReport,
  runBenchmark,
} from "../src/eval/run-benchmark.js";
import { replayPolicy } from "../src/eval/replay.js";
import {
  corruptProtectedRequiredUse,
  scorePolicyRun,
} from "../src/eval/scorer.js";

test("benchmark replays identical fixtures with independent deterministic scoring", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "contextgc-eval-"));
  t.after(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  const firstOutput = path.join(temporaryRoot, "first");
  const secondOutput = path.join(temporaryRoot, "second");
  const first = await runBenchmark({ outputDir: firstOutput });
  const second = await runBenchmark({ outputDir: secondOutput });

  assert.equal(first.receiptHash, second.receiptHash);
  assert.deepEqual(first, second);
  assert.equal(first.primaryMetric, "UPVS");
  assert.equal(first.codexCredits, null);
  assert.equal(first.apiCallsMade, 0);
  assert.equal(first.liveCodexProof, false);
  assert.equal(first.fixtures.length, 3);
  assert.equal(first.runs.length, 9);
  assert.equal(first.aggregates.length, 3);
  assert.equal(first.oracleNegativeControlPassed, true);
  assert.equal(first.negativeControls.length, 3);
  assert.ok(
    first.negativeControls.every(
      (control) => control.failureDetected && control.failedChecks.length > 0,
    ),
  );

  for (const run of first.runs) {
    assert.equal(
      run.usage.usageProxy,
      run.usage.uncachedInputTokens +
        run.usage.cachedInputTokens +
        run.usage.cacheWriteInputTokens +
        run.usage.outputTokens,
    );
    assert.equal(run.verifiedSuccess, true);
    assert.equal(run.forbiddenChangeChecksPassed, true);
    assert.equal(run.criticalRetentionRate, 1);
    assert.equal(run.exactRetentionRate, 1);
  }

  const adaptiveRuns = first.runs.filter(
    (run) => run.policy === "A_ADAPTIVE",
  );
  assert.ok(adaptiveRuns.some((run) => run.compactions.length > 0));
  for (const run of adaptiveRuns) {
    assert.ok(
      run.compactions.every((event) => event.coreOptimizerUsed),
      `${run.fixtureId} adaptive decisions must come from the core optimizer`,
    );
  }

  const loadedFixtures = await loadBenchmarkFixtures();
  for (const fixture of loadedFixtures) {
    const manualRun = first.runs.find(
      (run) =>
        run.fixtureId === fixture.fixture.id && run.policy === "M_MANUAL",
    );
    assert.deepEqual(
      manualRun?.compactions.map((event) => event.turnId),
      fixture.fixture.manualCheckpointTurns,
    );

    const fixedRun = first.runs.find(
      (run) => run.fixtureId === fixture.fixture.id && run.policy === "F_FIXED",
    );
    assert.ok(
      fixedRun?.compactions.every(
        (event) =>
          event.activeTokensBefore / fixture.fixture.contextBudgetTokens >= 0.75,
      ),
    );
  }

  const loadedReport = await loadBenchmarkReport(
    path.join(firstOutput, "benchmark-report.json"),
  );
  assert.equal(loadedReport.receiptHash, first.receiptHash);

  const demoReceipt = JSON.parse(
    await readFile(path.join(firstOutput, "demo-receipt.json"), "utf8"),
  ) as Record<string, unknown>;
  const serializedDemo = JSON.stringify(demoReceipt);
  assert.equal(demoReceipt["sourceReceiptHash"], first.receiptHash);
  assert.equal(demoReceipt["codexCredits"], null);
  assert.equal(demoReceipt["oracleNegativeControlPassed"], true);
  assert.deepEqual(
    (demoReceipt["usageProxyDefinition"] as { weights: unknown }).weights,
    {
      uncachedInputWeight: 1,
      cachedInputWeight: 1,
      cacheWriteInputWeight: 1,
      outputWeight: 1,
    },
  );
  const demoPolicies = demoReceipt["policies"] as Array<{
    rawTokenTotals: Record<string, number>;
    totalUsageProxy: number;
  }>;
  for (const policy of demoPolicies) {
    assert.equal(
      Object.values(policy.rawTokenTotals).reduce(
        (sum, value) => sum + value,
        0,
      ),
      policy.totalUsageProxy,
    );
  }
  assert.doesNotMatch(serializedDemo, /[A-Z]:\\/);
  assert.doesNotMatch(serializedDemo, /expectedValue|oracleChecks|prompt/i);
});

test("hidden oracle rejects a protected fact corrupted at its required late-use turn", async () => {
  const [loaded] = await loadBenchmarkFixtures();
  assert.ok(loaded);
  const validRun = replayPolicy(loaded.fixture, "A_ADAPTIVE");
  const validScore = scorePolicyRun(validRun, loaded.oracle);
  assert.equal(validScore.verifiedSuccess, true);

  const corrupted = corruptProtectedRequiredUse(validRun, loaded.oracle);
  const corruptedScore = scorePolicyRun(corrupted, loaded.oracle);
  assert.equal(corruptedScore.verifiedSuccess, false);
  assert.ok(corruptedScore.criticalRetentionRate < 1);
  assert.ok(
    corruptedScore.oracleChecks.some(
      (check) => check.protected && !check.pass && check.actual === null,
    ),
  );
});

test("archived facts are not automatically available beyond the bounded retrieval budget", () => {
  const memory = new EvaluationMemory();
  memory.introduce(
    {
      id: "critical_exact",
      kind: "constraint",
      value: "22.13.0",
      tokens: 42,
      importance: 10,
      protected: true,
      exact: true,
    },
    0,
  );
  memory.applyActions(new Map([["critical_exact", "EXTERNALIZE"]]));

  const blocked = memory.use("critical_exact", 5, 0);
  assert.equal(blocked.outcome.available, false);
  assert.equal(
    blocked.outcome.failureReason,
    "REHYDRATION_BUDGET_EXCEEDED",
  );
  assert.equal(blocked.outcome.rehydrated, false);

  const retrieved = memory.use("critical_exact", 5, 42);
  assert.equal(retrieved.outcome.available, true);
  assert.equal(retrieved.outcome.actualValue, "22.13.0");
  assert.equal(retrieved.outcome.rehydrated, true);
});
