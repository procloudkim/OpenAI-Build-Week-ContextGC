/**
 * Stable, JSON-friendly domain contracts for ContextGC.
 *
 * The core deliberately models preparation and reversible retention. It does
 * not model a destructive DROP action and it does not claim to actuate Codex's
 * native compaction.
 */

export type MemoryAction = "KEEP" | "SUMMARIZE" | "EXTERNALIZE";

export type MemoryAtomKind =
  | "goal"
  | "constraint"
  | "decision"
  | "evidence"
  | "blocker"
  | "tool_output"
  | "failed_attempt"
  | "exact_value"
  | "transient";

export type LifecyclePhase =
  | "explore"
  | "plan"
  | "implement"
  | "verify"
  | "handoff"
  | "unknown";

export interface MemoryAtom {
  readonly id: string;
  readonly kind: MemoryAtomKind;
  /** Opaque pointer back to the append-only evidence ledger. */
  readonly sourceRef: string;
  readonly contentHash: string;
  readonly protected: boolean;
  readonly exact: boolean;
  readonly tokenEstimate: number;
  readonly lifecyclePhase: LifecyclePhase;
  readonly lastUsedAt: string;
  readonly supersedes?: readonly string[];
  readonly inlineContent?: string;
  /** Content-addressed pointer to preserved raw content. */
  readonly archiveRef?: string;
}
export interface TaskFrame {
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
 * The categories are non-overlapping. In particular, outputTokens must already
 * include any reasoning tokens charged as output; do not add them a second
 * time.
 */
export interface TokenUsage {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
}

export interface UsageWeights {
  readonly id: string;
  readonly uncachedInputWeight: number;
  readonly cachedInputWeight: number;
  readonly cacheWriteInputWeight: number;
  readonly outputWeight: number;
}

export interface UsageProxyBreakdown {
  readonly unit: "weighted-token-units";
  readonly rawUsage: TokenUsage;
  readonly weights: UsageWeights;
  readonly uncachedInput: number;
  readonly cachedInput: number;
  readonly cacheWriteInput: number;
  readonly output: number;
  readonly total: number;
}

/** Explicit API-equivalent rate card. ContextGC never supplies a model price. */
export interface ApiEquivalentRateCard {
  readonly id: string;
  readonly currency: "USD";
  readonly uncachedInputUsdPerMillionTokens: number;
  readonly cachedInputUsdPerMillionTokens: number;
  readonly cacheWriteInputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}

export interface ApiEquivalentUsdBreakdown {
  readonly qualification: "api-equivalent-estimate";
  readonly rateCard: ApiEquivalentRateCard;
  readonly rawUsage: TokenUsage;
  readonly uncachedInputUsd: number;
  readonly cachedInputUsd: number;
  readonly cacheWriteInputUsd: number;
  readonly outputUsd: number;
  readonly totalUsd: number;
}

export interface PolicyDecision {
  readonly atomId: string;
  readonly action: MemoryAction;
  readonly reasonCodes: readonly string[];
  readonly usageProxyBefore: number;
  readonly usageProxyAfter: number;
  readonly cachePenaltyProxy: number;
  readonly riskScore: number;
  readonly breakEvenTurns: number | null;
  readonly checkpointId: string | null;
  /** No public deterministic Codex-token to ChatGPT-credit mapping exists. */
  readonly estimatedCreditsBefore: null;
  readonly estimatedCreditsAfter: null;
}

export interface ReceiptPolicyConfig {
  readonly usageWeights: UsageWeights;
  readonly softLimitRatio: number;
  readonly hardLimitRatio: number;
  readonly releaseLimitRatio: number;
  readonly minNetBenefitProxy: number;
  readonly benefitHysteresisProxy: number;
  readonly cooldownTurns: number;
  readonly maxRiskScore: number;
}

export interface ReceiptTelemetry {
  readonly usage: TokenUsage;
  readonly contextWindowTokens: number;
  readonly compactionCount: number;
}

export interface InvariantAudit {
  readonly passed: boolean;
  readonly violations: readonly string[];
  readonly protectedAtomIds: readonly string[];
}

export interface Receipt {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly createdAt: string;
  readonly codexVersion: string;
  readonly eventHashes: readonly string[];
  readonly policyConfig: ReceiptPolicyConfig;
  readonly telemetry: ReceiptTelemetry;
  readonly usageProxy: UsageProxyBreakdown;
  readonly estimatedApiEquivalentUsd: ApiEquivalentUsdBreakdown | null;
  /** Always null: ChatGPT/Codex credits are not derivable from token telemetry. */
  readonly estimatedCredits: null;
  readonly creditEstimateStatus: "UNAVAILABLE_NO_PUBLIC_MAPPING";
  readonly decisions: readonly PolicyDecision[];
  readonly invariantAudit: InvariantAudit;
  readonly rollbackPointer: string;
}
