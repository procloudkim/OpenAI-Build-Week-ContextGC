"use client";

import { useEffect, useMemo, useState } from "react";

type PolicyKey = "manual" | "fixed" | "adaptive";
type MemoryState = "archived" | "rehydrated" | "rolled-back";
type PolicyId = "M_MANUAL" | "F_FIXED" | "A_ADAPTIVE";

type PolicyMetrics = {
  policy: PolicyId;
  upvs: number;
  verifiedSuccesses: number;
  fixtureCount: number;
  criticalRetentionRate: number;
  compactions: number;
  manualInterventions: number;
  totalUsageProxy: number;
  rawTokenTotals: {
    uncachedInputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
  };
};

type DemoReceipt = {
  schemaVersion: 1;
  sourceReceiptHash: string;
  benchmarkVersion: string;
  scope: string;
  primaryMetric: "UPVS";
  codexCredits: null;
  liveCodexProof: false;
  apiCallsMade: 0;
  usageProxyDefinition: {
    id: string;
    unit: string;
    weights: {
      uncachedInputWeight: number;
      cachedInputWeight: number;
      cacheWriteInputWeight: number;
      outputWeight: number;
    };
    codexCredits: null;
    estimatedApiEquivalentUsd: null;
    limitation: string;
  };
  policies: PolicyMetrics[];
  caveat: string;
};

type BenchmarkReport = {
  receiptHash: string;
  primaryMetric: "UPVS";
  codexCredits: null;
  liveCodexProof: false;
  apiCallsMade: 0;
  usageProxyDefinition: DemoReceipt["usageProxyDefinition"];
  fixtures: Array<{ id: string }>;
  runs: Array<{
    fixtureId: string;
    policy: PolicyId;
    verifiedSuccess: boolean;
    forbiddenChangeChecksPassed: boolean;
    oracleChecks: Array<{ pass: boolean }>;
    usage: PolicyMetrics["rawTokenTotals"];
  }>;
  aggregates: Array<{
    policy: PolicyId;
    upvs: number;
    verifiedSuccesses: number;
    criticalRetentionRate: number;
    compactions: number;
    manualInterventions: number;
    totalUsageProxy: number;
  }>;
  [key: string]: unknown;
};

type ReceiptVerification = "checking" | "verified" | "failed" | "unavailable";

const policyLabels: Record<
  PolicyKey,
  {
    id: PolicyId;
    name: string;
    eyebrow: string;
    tone: "steady" | "good";
  }
> = {
  manual: {
    id: "M_MANUAL",
    name: "Manual",
    eyebrow: "Frozen manual schedule",
    tone: "steady",
  },
  fixed: {
    id: "F_FIXED",
    name: "Fixed 75%",
    eyebrow: "Static threshold",
    tone: "steady",
  },
  adaptive: {
    id: "A_ADAPTIVE",
    name: "ContextGC",
    eyebrow: "Risk-gated break-even",
    tone: "good",
  },
};

const fallbackReceipt: DemoReceipt = {
  schemaVersion: 1,
  sourceReceiptHash:
    "f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd",
  benchmarkVersion: "contextgc-synthetic-v1",
  scope: "deterministic-synthetic-policy-simulation",
  primaryMetric: "UPVS",
  codexCredits: null,
  liveCodexProof: false,
  apiCallsMade: 0,
  usageProxyDefinition: {
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
  },
  policies: [
    {
      policy: "M_MANUAL",
      upvs: 59884.666667,
      verifiedSuccesses: 3,
      fixtureCount: 3,
      criticalRetentionRate: 1,
      compactions: 6,
      manualInterventions: 6,
      totalUsageProxy: 179654,
      rawTokenTotals: {
        uncachedInputTokens: 82851,
        cachedInputTokens: 86713,
        cacheWriteInputTokens: 0,
        outputTokens: 10090,
      },
    },
    {
      policy: "F_FIXED",
      upvs: 67653.666667,
      verifiedSuccesses: 3,
      fixtureCount: 3,
      criticalRetentionRate: 1,
      compactions: 5,
      manualInterventions: 0,
      totalUsageProxy: 202961,
      rawTokenTotals: {
        uncachedInputTokens: 81926,
        cachedInputTokens: 111125,
        cacheWriteInputTokens: 0,
        outputTokens: 9910,
      },
    },
    {
      policy: "A_ADAPTIVE",
      upvs: 65488.333333,
      verifiedSuccesses: 3,
      fixtureCount: 3,
      criticalRetentionRate: 1,
      compactions: 4,
      manualInterventions: 0,
      totalUsageProxy: 196465,
      rawTokenTotals: {
        uncachedInputTokens: 78771,
        cachedInputTokens: 107964,
        cacheWriteInputTokens: 0,
        outputTokens: 9730,
      },
    },
  ],
  caveat:
    "Deterministic synthetic replay only. These results do not prove native Codex compaction quality, live integration, real credits, or production savings.",
};

const benchmarkFixtures = [
  { name: "Exact Config Migration", turns: 10 },
  { name: "Interrupted Refactor", turns: 11 },
  { name: "Noisy Incident Debug", turns: 12 },
] as const;

const repositoryUrl = "https://github.com/procloudkim/OpenAI-Build-Week-ContextGC";

const installCommands = [
  `git clone ${repositoryUrl}.git`,
  "Set-Location context-gc",
  "node scripts/contextgc.bundle.mjs simulate",
];

function formatProxy(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function policyMap(receipt: DemoReceipt): Record<PolicyKey, PolicyMetrics> {
  const findPolicy = (id: PolicyId) =>
    receipt.policies.find((entry) => entry.policy === id) ??
    fallbackReceipt.policies.find((entry) => entry.policy === id)!;

  return {
    manual: findPolicy("M_MANUAL"),
    fixed: findPolicy("F_FIXED"),
    adaptive: findPolicy("A_ADAPTIVE"),
  };
}

function normalizeCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeCanonical(entry)]),
    );
  }
  return value;
}

async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(normalizeCanonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function receiptMatchesReport(receipt: DemoReceipt, report: BenchmarkReport): boolean {
  if (
    receipt.sourceReceiptHash !== report.receiptHash ||
    receipt.primaryMetric !== report.primaryMetric ||
    receipt.codexCredits !== report.codexCredits ||
    receipt.liveCodexProof !== report.liveCodexProof ||
    receipt.apiCallsMade !== report.apiCallsMade ||
    JSON.stringify(normalizeCanonical(receipt.usageProxyDefinition)) !==
      JSON.stringify(normalizeCanonical(report.usageProxyDefinition))
  ) {
    return false;
  }

  return receipt.policies.every((policy) => {
    const aggregate = report.aggregates.find((entry) => entry.policy === policy.policy);
    const runs = report.runs.filter((entry) => entry.policy === policy.policy);
    const rawTokenTotals = runs.reduce<PolicyMetrics["rawTokenTotals"]>(
      (totals, run) => ({
        uncachedInputTokens: totals.uncachedInputTokens + run.usage.uncachedInputTokens,
        cachedInputTokens: totals.cachedInputTokens + run.usage.cachedInputTokens,
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
    );
    return (
      aggregate !== undefined &&
      policy.upvs === aggregate.upvs &&
      policy.verifiedSuccesses === aggregate.verifiedSuccesses &&
      policy.fixtureCount === report.fixtures.length &&
      policy.criticalRetentionRate === aggregate.criticalRetentionRate &&
      policy.compactions === aggregate.compactions &&
      policy.manualInterventions === aggregate.manualInterventions &&
      policy.totalUsageProxy === aggregate.totalUsageProxy &&
      JSON.stringify(policy.rawTokenTotals) === JSON.stringify(rawTokenTotals)
    );
  });
}

export default function Home() {
  const [policy, setPolicy] = useState<PolicyKey>("adaptive");
  const [probeRan, setProbeRan] = useState(false);
  const [recordedProbePass, setRecordedProbePass] = useState<boolean | null>(null);
  const [receiptVerification, setReceiptVerification] =
    useState<ReceiptVerification>("checking");
  const [memoryState, setMemoryState] = useState<MemoryState>("archived");
  const [copied, setCopied] = useState<number | null>(null);
  const [demoReceipt, setDemoReceipt] = useState<DemoReceipt>(fallbackReceipt);
  const policyMetrics = useMemo(() => policyMap(demoReceipt), [demoReceipt]);
  const activePolicy = { ...policyLabels[policy], ...policyMetrics[policy] };

  useEffect(() => {
    const controller = new AbortController();

    async function loadReceipt() {
      try {
        const [receiptResponse, reportResponse] = await Promise.all([
          fetch("/demo-receipt.json", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/benchmark-report.json", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (!receiptResponse.ok || !reportResponse.ok) {
          setReceiptVerification("unavailable");
          return;
        }
        const candidate = (await receiptResponse.json()) as Partial<DemoReceipt>;
        const report = (await reportResponse.json()) as Partial<BenchmarkReport>;
        if (
          candidate.schemaVersion === 1 &&
          typeof candidate.sourceReceiptHash === "string" &&
          /^[a-f0-9]{64}$/.test(candidate.sourceReceiptHash) &&
          candidate.codexCredits === null &&
          candidate.liveCodexProof === false &&
          candidate.apiCallsMade === 0 &&
          candidate.primaryMetric === "UPVS" &&
          candidate.policies?.length === 3 &&
          candidate.policies.some((entry) => entry.policy === "M_MANUAL") &&
          candidate.policies.some((entry) => entry.policy === "F_FIXED") &&
          candidate.policies.some((entry) => entry.policy === "A_ADAPTIVE") &&
          typeof candidate.caveat === "string" &&
          typeof report.receiptHash === "string" &&
          /^[a-f0-9]{64}$/.test(report.receiptHash) &&
          report.primaryMetric === "UPVS" &&
          report.codexCredits === null &&
          report.liveCodexProof === false &&
          report.apiCallsMade === 0 &&
          Array.isArray(report.fixtures) &&
          Array.isArray(report.runs) &&
          Array.isArray(report.aggregates) &&
          report.usageProxyDefinition !== undefined
        ) {
          const { receiptHash, ...withoutHash } = report as BenchmarkReport;
          const computedHash = await sha256Canonical(withoutHash);
          const typedReceipt = candidate as DemoReceipt;
          const typedReport = report as BenchmarkReport;
          if (
            computedHash === receiptHash &&
            receiptMatchesReport(typedReceipt, typedReport)
          ) {
            setDemoReceipt(typedReceipt);
            setReceiptVerification("verified");
            const recordedRun = typedReport.runs.find(
              (run) =>
                run.policy === "A_ADAPTIVE" &&
                run.fixtureId === "exact-config-migration",
            );
            setRecordedProbePass(
              recordedRun !== undefined &&
                recordedRun.verifiedSuccess &&
                recordedRun.forbiddenChangeChecksPassed &&
                recordedRun.oracleChecks.every((check) => check.pass),
            );
            return;
          }
        }
        setReceiptVerification("failed");
      } catch {
        if (!controller.signal.aborted) setReceiptVerification("unavailable");
      }
    }

    void loadReceipt();
    return () => controller.abort();
  }, []);

  const fixedDelta = useMemo(
    () =>
      (((policyMetrics.fixed.upvs - policyMetrics.adaptive.upvs) /
        policyMetrics.fixed.upvs) *
        100).toFixed(2),
    [policyMetrics],
  );

  const manualOverhead = useMemo(
    () =>
      (((policyMetrics.adaptive.upvs - policyMetrics.manual.upvs) /
        policyMetrics.manual.upvs) *
        100).toFixed(2),
    [policyMetrics],
  );

  const adaptiveVsFixedRatio = useMemo(
    () => (policyMetrics.adaptive.upvs / policyMetrics.fixed.upvs) * 100,
    [policyMetrics],
  );

  const fixedUsageDelta =
    policyMetrics.fixed.totalUsageProxy - policyMetrics.adaptive.totalUsageProxy;

  const receiptPreview = useMemo(
    () =>
      JSON.stringify(
        {
          schemaVersion: demoReceipt.schemaVersion,
          sourceReceiptHash: demoReceipt.sourceReceiptHash,
          benchmarkVersion: demoReceipt.benchmarkVersion,
          scope: demoReceipt.scope,
          primaryMetric: demoReceipt.primaryMetric,
          codexCredits: demoReceipt.codexCredits,
          liveCodexProof: demoReceipt.liveCodexProof,
          apiCallsMade: demoReceipt.apiCallsMade,
          usageProxyDefinition: demoReceipt.usageProxyDefinition,
          policies: demoReceipt.policies.map((entry) => ({
            policy: entry.policy,
            upvs: entry.upvs,
            totalUsageProxy: entry.totalUsageProxy,
            verifiedSuccesses: entry.verifiedSuccesses,
            fixtureCount: entry.fixtureCount,
            criticalRetentionRate: entry.criticalRetentionRate,
            compactions: entry.compactions,
            manualInterventions: entry.manualInterventions,
          })),
          caveat: demoReceipt.caveat,
        },
        null,
        2,
      ),
    [demoReceipt],
  );

  async function copyCommand(command: string, index: number) {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <main>
      <nav className="nav-shell" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="ContextGC home">
          <span className="brand-mark" aria-hidden="true">
            CG
          </span>
          <span>ContextGC</span>
        </a>
        <div className="nav-links">
          <a href="#proof">Proof</a>
          <a href="#receipt">Receipt</a>
          <a href="#install">Install</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <span className="status-chip">
          <span className="status-dot" aria-hidden="true" /> Local · reversible
        </span>
      </nav>

      <section className="hero section-shell" id="top">
        <div className="hero-copy">
          <p className="kicker">CONTEXT CONTROL FOR CODEX</p>
          <h1>
            Keep the truth.
            <br />
            <span>Compress the noise.</span>
          </h1>
          <p className="hero-lede">
            ContextGC protects goals, constraints, decisions, and test evidence
            around Codex compaction—then shows exactly what moved, why, and how
            to get it back.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#proof">
              Inspect verified evidence
            </a>
            <a
              className="button button-secondary"
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open GitHub
            </a>
            <a className="text-link" href="#boundary">
              Read the boundary <span aria-hidden="true">↘</span>
            </a>
          </div>
          <dl className="headline-metrics">
            <div>
              <dt>3 / 3</dt>
              <dd>deterministic fixtures passed</dd>
            </div>
            <div>
              <dt>100%</dt>
              <dd>required critical facts retained</dd>
            </div>
            <div>
              <dt>0</dt>
              <dd>adaptive manual interventions</dd>
            </div>
          </dl>
          <p className="data-note">
            Synthetic replay only · adaptive UPVS is {fixedDelta}% below fixed and {manualOverhead}%
            above the six-intervention manual schedule · liveCodexProof=false
          </p>
        </div>

        <aside className="control-panel" aria-label="ContextGC synthetic benchmark result">
          <div className="panel-topline">
            <span>SYNTHETIC RESULT</span>
            <span className="mono dim">receipt {demoReceipt.sourceReceiptHash.slice(0, 8)}</span>
          </div>
          <div
            className="context-gauge"
            aria-label={`Adaptive UPVS is ${adaptiveVsFixedRatio.toFixed(2)} percent of fixed UPVS`}
          >
            <div className="gauge-labels">
              <span>Adaptive UPVS / fixed UPVS</span>
              <strong>{adaptiveVsFixedRatio.toFixed(2)}%</strong>
            </div>
            <div className="gauge-track" aria-hidden="true">
              <span style={{ width: `${adaptiveVsFixedRatio}%` }} />
            </div>
            <div className="gauge-zones" aria-hidden="true">
              <span>lower</span>
              <span>adaptive</span>
              <span>fixed</span>
            </div>
          </div>

          <div className="decision-block">
            <p className="micro-label">RISK-GATED AUTOMATED POLICY</p>
            <div className="decision-title">
              <span className="decision-index">A</span>
              <div>
                <strong>A_ADAPTIVE</strong>
                <p>3 / 3 verified · 0 manual interventions</p>
              </div>
            </div>
          </div>

          <div className="decision-math">
            <div>
              <span>Total usage proxy</span>
              <strong>{policyMetrics.adaptive.totalUsageProxy.toLocaleString("en-US")} units</strong>
            </div>
            <span className="math-sign">−</span>
            <div>
              <span>Difference vs. fixed</span>
              <strong>−{fixedUsageDelta.toLocaleString("en-US")} units</strong>
            </div>
          </div>

          <div className="guardrail">
            <span className="guard-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>
                {receiptVerification === "verified"
                  ? "Receipt integrity verified in this browser"
                  : "Receipt integrity not established"}
              </strong>
              <p>
                {receiptVerification === "verified"
                  ? `${policyMetrics.adaptive.compactions} simulated events · ${demoReceipt.apiCallsMade} replay API calls`
                  : "Showing bundled fallback values"}
              </p>
            </div>
          </div>

          <div className="panel-footer mono">
            <span>
              source hash: {receiptVerification === "verified" ? "verified" : receiptVerification}
            </span>
            <span>live proof: false</span>
          </div>
        </aside>
      </section>

      <section className="comparison section-shell" id="proof">
        <div className="section-heading">
          <div>
            <p className="kicker">01 · POLICY LAB</p>
            <h2>Three traces. Three policies. No vibes.</h2>
          </div>
          <p>
            Switch policies to inspect a frozen replay across three software
            engineering fixtures. Success is scored by deterministic tests—not
            by an LLM judge.
          </p>
        </div>

        <div className="policy-tabs" role="tablist" aria-label="Compaction policies">
          {(Object.keys(policyLabels) as PolicyKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={policy === key}
              aria-controls="policy-result"
              className={policy === key ? "active" : ""}
              onClick={() => setPolicy(key)}
            >
              <span>{policyLabels[key].name}</span>
              <small>{policyLabels[key].eyebrow}</small>
            </button>
          ))}
        </div>

        <div className="policy-result" id="policy-result" role="tabpanel">
          <div className="policy-summary">
            <div className={`outcome-marker ${activePolicy.tone}`}>
              <span>OUTCOME</span>
              <strong>
                Verified synthetic replay · {activePolicy.compactions} simulated events
              </strong>
            </div>
            <dl className="policy-stats">
              <div>
                <dt>Total usage proxy</dt>
                <dd>{activePolicy.totalUsageProxy.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt>UPVS</dt>
                <dd>{formatProxy(activePolicy.upvs)}</dd>
              </div>
              <div>
                <dt>Verified success</dt>
                <dd>
                  {activePolicy.verifiedSuccesses} / {activePolicy.fixtureCount}
                </dd>
              </div>
              <div>
                <dt>Critical retention</dt>
                <dd>{Math.round(activePolicy.criticalRetentionRate * 100)}%</dd>
              </div>
            </dl>
          </div>

          <div className="policy-visual" aria-label="Relative usage proxy per verified success">
            {(Object.keys(policyLabels) as PolicyKey[]).map((key) => {
              const item = policyMetrics[key];
              const maxUpvs = Math.max(...Object.values(policyMetrics).map((entry) => entry.upvs));
              const width = Math.max(18, (item.upvs / maxUpvs) * 100);
              return (
                <div className="bar-row" key={key}>
                  <div className="bar-meta">
                    <span>{policyLabels[key].name}</span>
                    <span className="mono">{formatProxy(item.upvs)} UPVS</span>
                  </div>
                  <div className="bar-track">
                    <span
                      className={
                        item.upvs ===
                        Math.min(...Object.values(policyMetrics).map((entry) => entry.upvs))
                          ? "best"
                          : ""
                      }
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="axis-note">
              Lower UPVS is better. Manual is lowest here but requires 6 frozen-schedule
              interventions; adaptive is 3.20% below fixed with none. All policies passed 3 / 3.
            </p>
          </div>
        </div>
      </section>

      <section className="probe section-shell" aria-labelledby="probe-title">
        <div className="probe-copy">
          <p className="kicker">02 · INVARIANT PROBE</p>
          <h2 id="probe-title">Protected facts get a fail-closed gate.</h2>
          <p>
            This control reveals a result already recorded by the deterministic
            synthetic evaluator. It does not run Codex or a new benchmark in
            the visitor&apos;s browser.
          </p>
          <button
            className="button button-primary probe-button"
            type="button"
            onClick={() => setProbeRan(true)}
            disabled={receiptVerification !== "verified" || recordedProbePass === null}
          >
            {receiptVerification !== "verified"
              ? "Verified receipt required"
              : probeRan
                ? "Recorded result revealed"
                : "Reveal recorded invariant result"}
          </button>
        </div>

        <div
          className={`invariant-console ${probeRan && recordedProbePass ? "verified" : ""}`}
        >
          <div className="console-header mono">
            <span>fixture/exact-config-migration</span>
            <span>
              {probeRan ? (recordedProbePass ? "RECORDED: PASS" : "RECORDED: FAIL") : "GATE: READY"}
            </span>
          </div>
          <ul>
            <li>
              <span className="atom-kind">CONSTRAINT</span>
              <code>node runtime must remain &quot;22.13.0&quot;</code>
              <strong>{probeRan ? "KEEP · exact" : "protected"}</strong>
            </li>
            <li>
              <span className="atom-kind">CONSTRAINT</span>
              <code>package manager must remain &quot;npm@10.9.2&quot;</code>
              <strong>{probeRan ? "KEEP · exact" : "protected"}</strong>
            </li>
            <li>
              <span className="atom-kind">CHANGE GUARD</span>
              <code>Do not modify .github/workflows/release.yml</code>
              <strong>{probeRan ? "VETO · preserved" : "protected"}</strong>
            </li>
            <li className="transient">
              <span className="atom-kind">TRANSIENT</span>
              <code>Optional peer warnings from unrelated packages</code>
              <strong>{probeRan ? "SUMMARIZE" : "eligible"}</strong>
            </li>
          </ul>
          <div className="console-result mono" aria-live="polite">
            {probeRan
              ? recordedProbePass
                ? "✓ hashed receipt · recorded oracle pass · forbidden change rejected"
                : "✕ hashed receipt · recorded oracle failure"
              : "awaiting recorded-result reveal…"}
          </div>
        </div>
      </section>

      <section className="memory section-shell" aria-labelledby="memory-title">
        <div className="section-heading compact">
          <div>
            <p className="kicker">03 · RECOVERY</p>
            <h2 id="memory-title">Important non-secret evidence stays recoverable.</h2>
          </div>
          <p>
            Externalized means moved with a content hash—not deleted. Rehydrate
            only what the next turn needs, or restore the last valid frame. This
            interaction is a capability walkthrough, not benchmark evidence.
          </p>
        </div>

        <div className="memory-stage">
          <div className="timeline" aria-label="Checkpoint recovery timeline">
            <div className="timeline-node complete">
              <span>hashed archive</span>
              <small>evidence indexed</small>
            </div>
            <div className="timeline-line" />
            <div className={`timeline-node ${memoryState !== "archived" ? "complete" : "active"}`}>
              <span>valid frame</span>
              <small>reversible checkpoint</small>
            </div>
            <div className="timeline-line" />
            <div className={`timeline-node ${memoryState === "rehydrated" ? "active" : ""}`}>
              <span>next turn</span>
              <small>{memoryState === "rehydrated" ? "evidence rehydrated" : "ready"}</small>
            </div>
          </div>

          <div className="archive-card">
            <div>
              <span className="micro-label">CAPABILITY WALKTHROUGH · NON-BENCHMARK</span>
              <strong className="mono">content-addressed local archive</strong>
            </div>
            <div className="archive-meta mono">
              <span>non-secret bytes preserved</span>
              <span>bounded retrieval</span>
              <span>local only</span>
            </div>
            <p className="archive-state" aria-live="polite">
              {memoryState === "archived" &&
                "Sanitized non-secret evidence is archived and addressable."}
              {memoryState === "rehydrated" &&
                "Protected evidence rehydrated into the bounded Task Frame."}
              {memoryState === "rolled-back" &&
                "Last valid Task Frame mirror restored from the verified checkpoint."}
            </p>
            <p className="archive-boundary">
              Detected secret bytes are redacted before persistence and are not
              recoverable from ContextGC.
            </p>
            <div className="archive-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => setMemoryState("rehydrated")}
                disabled={memoryState === "rehydrated"}
              >
                Rehydrate protected evidence
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setMemoryState("rolled-back")}
              >
                Restore valid frame
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="receipt section-shell" id="receipt" aria-labelledby="receipt-title">
        <div className="receipt-intro">
          <p className="kicker">04 · RECEIPT</p>
          <h2 id="receipt-title">A claim you can inspect.</h2>
          <p>
            The sanitized receipt preserves the source hash, metric definition,
            policy results, replay-only <code>apiCallsMade: 0</code> field, and
            the exact proof caveat.
          </p>
          <div className="fixture-list">
            {benchmarkFixtures.map((fixture) => (
              <div key={fixture.name}>
                <span className="pass-mark">PASS</span>
                <span>{fixture.name}</span>
                <span className="mono">{fixture.turns} turns</span>
              </div>
            ))}
          </div>
        </div>

        <div className="receipt-code" aria-label="Deterministic ContextGC receipt">
          <div className="code-topline">
            <span className="mono">demo-receipt.json</span>
            <span className="receipt-seal">SYNTHETIC</span>
          </div>
          <pre>{receiptPreview}</pre>
          <p>
            {demoReceipt.caveat} Codex credits are unknown—not publicly derivable.
          </p>
        </div>
      </section>

      <section className="boundary section-shell" id="boundary">
        <span className="boundary-number">05</span>
        <div>
          <p className="kicker">HONEST INTEGRATION BOUNDARY</p>
          <h2>ContextGC prepares, protects, and restores.</h2>
          <p>
            The plugin does not claim to replace Codex&apos;s opaque native
            compaction state or force <code>/compact</code> inside an arbitrary
            existing thread. Native compaction remains Codex-owned; ContextGC
            is the auditable safety and control plane around it.
          </p>
        </div>
      </section>

      <section className="install section-shell" id="install" aria-labelledby="install-title">
        <div className="install-copy">
          <p className="kicker">INSTALL · VERIFY · INSPECT</p>
          <h2 id="install-title">No build. Three commands.</h2>
          <p>
            Clone, enter the repository, and reproduce the checked-in receipt.
            Node.js 22.13 or newer is required; dependencies, an API key, and a
            rebuild are not.
          </p>
        </div>
        <div className="command-list">
          {installCommands.map((command, index) => (
            <button
              type="button"
              key={command}
              onClick={() => copyCommand(command, index)}
              aria-label={`Copy command: ${command}`}
            >
              <span className="command-index">0{index + 1}</span>
              <code>{command}</code>
              <span>{copied === index ? "COPIED" : "COPY"}</span>
            </button>
          ))}
          <p className="sr-only" aria-live="polite">
            {copied === null ? "" : `Command ${copied + 1} copied.`}
          </p>
        </div>
      </section>

      <footer className="footer section-shell">
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true">
            CG
          </span>
          <span>ContextGC</span>
        </div>
        <p>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            Auditable context control for long-running Codex work.
          </a>
        </p>
        <span className="mono">LOCAL / REVERSIBLE / EVIDENCE-FIRST</span>
      </footer>
    </main>
  );
}
