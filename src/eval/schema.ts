import { z } from "zod";

export const policyNames = ["M_MANUAL", "F_FIXED", "A_ADAPTIVE"] as const;
export type PolicyName = (typeof policyNames)[number];

const factKindSchema = z.enum([
  "goal",
  "constraint",
  "decision",
  "evidence",
  "blocker",
  "tool_output",
  "transient",
]);

export const fixtureFactSchema = z.object({
  id: z.string().min(1),
  kind: factKindSchema,
  value: z.string(),
  tokens: z.number().int().positive(),
  importance: z.number().int().min(1).max(10),
  protected: z.boolean(),
  exact: z.boolean(),
});

export type FixtureFact = z.infer<typeof fixtureFactSchema>;

export const traceTurnSchema = z.object({
  id: z.string().regex(/^t\d{2}$/),
  phase: z.enum(["explore", "plan", "implement", "verify", "release"]),
  newContextTokens: z.number().int().positive(),
  outputTokens: z.number().int().nonnegative(),
  cacheShare: z.number().min(0).max(1),
  facts: z.array(fixtureFactSchema).default([]),
  usesFacts: z.array(z.string().min(1)).default([]),
  proposedChanges: z
    .array(
      z.object({
        target: z.string().min(1),
        guardFactId: z.string().min(1),
      }),
    )
    .default([]),
});

export type TraceTurn = z.infer<typeof traceTurnSchema>;

export const benchmarkFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  synthetic: z.literal(true),
  contextBudgetTokens: z.number().int().positive(),
  manualCheckpointTurns: z.array(z.string().regex(/^t\d{2}$/)),
  turns: z.array(traceTurnSchema).min(10).max(12),
});

export type BenchmarkFixture = z.infer<typeof benchmarkFixtureSchema>;

export const hiddenOracleSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureId: z.string().min(1),
  expectedTurnCount: z.number().int().positive(),
  requiredFacts: z.array(
    z.object({
      id: z.string().min(1),
      expectedValue: z.string(),
    }),
  ),
  requiredUses: z.array(
    z.object({
      turnId: z.string().regex(/^t\d{2}$/),
      factId: z.string().min(1),
      expectedValue: z.string(),
      requireExact: z.boolean(),
    }),
  ),
  forbiddenChanges: z.array(z.string().min(1)),
});

export type HiddenOracle = z.infer<typeof hiddenOracleSchema>;

export interface LoadedFixture {
  fixture: BenchmarkFixture;
  fixtureHash: string;
  oracle: HiddenOracle;
  oracleHash: string;
}

export interface UsageTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  usageProxy: number;
}

export interface UsageProxyDefinition {
  id: "neutral-v1";
  unit: "weighted-token-units";
  weights: {
    uncachedInputWeight: 1;
    cachedInputWeight: 1;
    cacheWriteInputWeight: 1;
    outputWeight: 1;
  };
  codexCredits: null;
  estimatedApiEquivalentUsd: null;
  limitation: string;
}

export interface FactUseOutcome {
  turnId: string;
  factId: string;
  available: boolean;
  actualValue: string | null;
  protected: boolean;
  exact: boolean;
  exactPreserved: boolean;
  semanticIntegrity: boolean;
  locationAtRequest: "active" | "summary" | "archive";
  rehydrated: boolean;
  failureReason:
    | "REHYDRATION_BUDGET_EXCEEDED"
    | "LOSS_INJECTED_FOR_NEGATIVE_CONTROL"
    | null;
}

export interface CompactionEvent {
  turnId: string;
  trigger: string;
  activeTokensBefore: number;
  activeTokensAfter: number;
  actions: Record<"KEEP" | "SUMMARIZE" | "EXTERNALIZE", number>;
  coreOptimizerUsed: boolean;
}

export interface PolicyRun {
  fixtureId: string;
  policy: PolicyName;
  turnsProcessed: number;
  usage: UsageTotals;
  compactions: CompactionEvent[];
  rehydrations: number;
  rollbackAvailable: boolean;
  manualInterventions: number;
  forbiddenChanges: string[];
  factUses: FactUseOutcome[];
  uncompressedContextTokens: number;
  finalActiveTokens: number;
}

export interface OracleCheck {
  id: string;
  turnId: string;
  pass: boolean;
  expected: string;
  actual: string | null;
  exactPreserved: boolean;
  protected: boolean;
}

export interface ScoredPolicyRun extends PolicyRun {
  verifiedSuccess: boolean;
  oracleChecks: OracleCheck[];
  forbiddenChangeChecksPassed: boolean;
  criticalRetentionRate: number;
  exactRetentionRate: number;
  cacheHitRate: number;
  compressionRatio: number;
  simulatedEvaluationSteps: number;
}

export interface PolicyAggregate {
  policy: PolicyName;
  totalUsageProxy: number;
  verifiedSuccesses: number;
  upvs: number | "Infinity";
  successRate: number;
  criticalRetentionRate: number;
  exactRetentionRate: number;
  cacheHitRate: number;
  compactions: number;
  rehydrations: number;
  manualInterventions: number;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  benchmarkVersion: "contextgc-synthetic-v1";
  scope: "deterministic-synthetic-policy-simulation";
  primaryMetric: "UPVS";
  usageProxyDefinition: UsageProxyDefinition;
  codexCredits: null;
  liveCodexProof: false;
  apiCallsMade: 0;
  leakageControls: string[];
  limitations: string[];
  fixtures: Array<{
    id: string;
    title: string;
    turnCount: number;
    fixtureHash: string;
    oracleHash: string;
  }>;
  runs: ScoredPolicyRun[];
  negativeControls: Array<{
    fixtureId: string;
    control: "CORRUPT_PROTECTED_REQUIRED_USE";
    sourcePolicy: "A_ADAPTIVE";
    expectedFailure: true;
    failureDetected: boolean;
    failedChecks: string[];
  }>;
  oracleNegativeControlPassed: boolean;
  aggregates: PolicyAggregate[];
  receiptHash: string;
}

export interface DemoReceipt {
  schemaVersion: 1;
  sourceReceiptHash: string;
  benchmarkVersion: string;
  scope: BenchmarkReport["scope"];
  primaryMetric: "UPVS";
  codexCredits: null;
  liveCodexProof: false;
  apiCallsMade: 0;
  oracleNegativeControlPassed: boolean;
  usageProxyDefinition: UsageProxyDefinition;
  policies: Array<{
    policy: PolicyName;
    upvs: number | "Infinity";
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
  }>;
  caveat: string;
}
