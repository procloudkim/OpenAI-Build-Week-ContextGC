import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "./canonical.js";
import { loadBenchmarkFixtures } from "./fixture-loader.js";
import { replayPolicy } from "./replay.js";
import {
  aggregatePolicyRuns,
  corruptProtectedRequiredUse,
  scorePolicyRun,
} from "./scorer.js";
import {
  policyNames,
  type BenchmarkReport,
  type DemoReceipt,
} from "./schema.js";

export interface RunBenchmarkOptions {
  fixturesDir?: string;
  outputDir?: string;
}

const usageProxyDefinition: BenchmarkReport["usageProxyDefinition"] = {
  id: "neutral-v1",
  unit: "weighted-token-units",
  weights: {
    uncachedInputWeight: 1,
    cachedInputWeight: 1,
    cacheWriteInputWeight: 1,
    outputWeight: 1,
  },
  codexCredits: null,
  estimatedApiEquivalentUsd: null,
  limitation:
    "The proxy sums non-overlapping token categories with neutral weights. It is not a ChatGPT/Codex bill, credit estimate, or model-quality measurement.",
};

function makeDemoReceipt(report: BenchmarkReport): DemoReceipt {
  return {
    schemaVersion: 1,
    sourceReceiptHash: report.receiptHash,
    benchmarkVersion: report.benchmarkVersion,
    scope: report.scope,
    primaryMetric: "UPVS",
    codexCredits: null,
    liveCodexProof: false,
    apiCallsMade: 0,
    oracleNegativeControlPassed: report.oracleNegativeControlPassed,
    usageProxyDefinition: report.usageProxyDefinition,
    policies: report.aggregates.map((aggregate) => ({
      policy: aggregate.policy,
      upvs: aggregate.upvs,
      verifiedSuccesses: aggregate.verifiedSuccesses,
      fixtureCount: report.fixtures.length,
      criticalRetentionRate: aggregate.criticalRetentionRate,
      compactions: aggregate.compactions,
      manualInterventions: aggregate.manualInterventions,
      totalUsageProxy: aggregate.totalUsageProxy,
      rawTokenTotals: report.runs
        .filter((run) => run.policy === aggregate.policy)
        .reduce(
          (totals, run) => ({
            uncachedInputTokens:
              totals.uncachedInputTokens + run.usage.uncachedInputTokens,
            cachedInputTokens:
              totals.cachedInputTokens + run.usage.cachedInputTokens,
            cacheWriteInputTokens:
              totals.cacheWriteInputTokens + run.usage.cacheWriteInputTokens,
            outputTokens: totals.outputTokens + run.usage.outputTokens,
          }),
          {
            uncachedInputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 0,
          },
        ),
    })),
    caveat:
      "Deterministic synthetic replay only. These results do not prove native Codex compaction quality, live integration, real credits, or production savings.",
  };
}

export async function runBenchmark(
  options: RunBenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const fixturesDir = path.resolve(options.fixturesDir ?? "fixtures");
  const outputDir = path.resolve(options.outputDir ?? "output/benchmark");
  const loadedFixtures = await loadBenchmarkFixtures(fixturesDir);
  const runs = loadedFixtures.flatMap((loaded) =>
    policyNames.map((policy) =>
      scorePolicyRun(replayPolicy(loaded.fixture, policy), loaded.oracle),
    ),
  );
  const aggregates = aggregatePolicyRuns(runs);
  const negativeControls = loadedFixtures.map((loaded) => {
    const corrupted = corruptProtectedRequiredUse(
      replayPolicy(loaded.fixture, "A_ADAPTIVE"),
      loaded.oracle,
    );
    const scored = scorePolicyRun(corrupted, loaded.oracle);
    return {
      fixtureId: loaded.fixture.id,
      control: "CORRUPT_PROTECTED_REQUIRED_USE" as const,
      sourcePolicy: "A_ADAPTIVE" as const,
      expectedFailure: true as const,
      failureDetected: !scored.verifiedSuccess,
      failedChecks: scored.oracleChecks
        .filter((check) => !check.pass)
        .map((check) => `${check.id}@${check.turnId}`),
    };
  });
  const oracleNegativeControlPassed = negativeControls.every(
    (control) => control.failureDetected && control.failedChecks.length > 0,
  );

  const reportWithoutHash: Omit<BenchmarkReport, "receiptHash"> = {
    schemaVersion: 1,
    benchmarkVersion: "contextgc-synthetic-v1",
    scope: "deterministic-synthetic-policy-simulation",
    primaryMetric: "UPVS",
    usageProxyDefinition,
    codexCredits: null,
    liveCodexProof: false,
    apiCallsMade: 0,
    leakageControls: [
      "Hidden oracle files are held outside every policy input and passed only to the deterministic scorer after replay.",
      "Policy decisions receive fixture traces but never oracle expectations or scorer output.",
      "The scorer is deterministic and does not use an LLM or model self-judge.",
      "Fixture and oracle hashes freeze the evaluated collection recipe.",
      "A protected-fact corruption control must be rejected for every fixture.",
      "Synthetic results are explicitly barred from claims about live Codex behavior.",
    ],
    limitations: [
      "All fixtures are synthetic and authored with their deterministic oracles.",
      "UPVS is a neutral token-volume proxy; cached input is separated from uncached input but carries the same default weight.",
      "Compaction and checkpoint overheads are fixed simulator assumptions, not observed Codex telemetry.",
      "Archived facts require a bounded per-turn retrieval; the negative control proves a missing critical fact fails at its required use boundary.",
      "The three configured policies are all reversible and pass these authored mechanics; broader task quality is not modeled.",
      "No API calls, live Codex sessions, human quality judges, or billing data are used.",
      "The benchmark supports deterministic policy regression testing, not statistical generalization.",
    ],
    fixtures: loadedFixtures.map((loaded) => ({
      id: loaded.fixture.id,
      title: loaded.fixture.title,
      turnCount: loaded.fixture.turns.length,
      fixtureHash: loaded.fixtureHash,
      oracleHash: loaded.oracleHash,
    })),
    runs,
    negativeControls,
    oracleNegativeControlPassed,
    aggregates,
  };
  const report: BenchmarkReport = {
    ...reportWithoutHash,
    receiptHash: sha256(reportWithoutHash),
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "benchmark-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "demo-receipt.json"),
    `${JSON.stringify(makeDemoReceipt(report), null, 2)}\n`,
    "utf8",
  );
  return report;
}

export async function loadBenchmarkReport(
  reportPath = path.resolve("output/benchmark/benchmark-report.json"),
): Promise<BenchmarkReport> {
  const value = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (value as { primaryMetric?: unknown }).primaryMetric !== "UPVS"
  ) {
    throw new Error(`Invalid benchmark report: ${reportPath}`);
  }
  const report = value as BenchmarkReport;
  const { receiptHash, ...withoutHash } = report;
  if (receiptHash !== sha256(withoutHash)) {
    throw new Error(`Benchmark receipt hash mismatch: ${reportPath}`);
  }
  return report;
}

async function main(): Promise<void> {
  const report = await runBenchmark();
  process.stdout.write(
    `${canonicalJson({
      receiptHash: report.receiptHash,
      primaryMetric: report.primaryMetric,
      aggregates: report.aggregates,
      codexCredits: report.codexCredits,
    })}\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.basename(fileURLToPath(import.meta.url)) === "run-benchmark.js" &&
  path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
