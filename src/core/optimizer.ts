import {
  selectMemoryActions,
  type SelectionInput,
  type SelectionResult,
} from "./selection.js";

export type TriggerRecommendation = "PREPARE" | "HOLD";

export type TriggerReasonCode =
  | "SELECTION_INFEASIBLE"
  | "INVARIANT_GATE_FAILED"
  | "NON_REVERSIBLE_ACTION"
  | "RISK_GATE_FAILED"
  | "COOLDOWN_ACTIVE"
  | "BELOW_TOKEN_THRESHOLD"
  | "ECONOMICALLY_UNFAVORABLE"
  | "BREAK_EVEN_REACHED"
  | "HARD_LIMIT_REACHED";

export interface TriggerPolicyConfig {
  readonly softLimitRatio: number;
  readonly hardLimitRatio: number;
  /** Lower Schmitt-trigger boundary after a PREPARE recommendation. */
  readonly releaseLimitRatio: number;
  readonly minNetBenefitProxy: number;
  readonly benefitHysteresisProxy: number;
  readonly cooldownTurns: number;
  readonly maxRiskScore: number;
}
export const DEFAULT_TRIGGER_POLICY: TriggerPolicyConfig = Object.freeze({
  softLimitRatio: 0.75,
  hardLimitRatio: 0.9,
  releaseLimitRatio: 0.65,
  minNetBenefitProxy: 0,
  benefitHysteresisProxy: 0,
  cooldownTurns: 2,
  maxRiskScore: 0.1,
});

export interface OptimizationTriggerInput {
  readonly currentTokens: number;
  readonly contextWindowTokens: number;
  readonly reclaimableTokens: number;
  readonly predictedRemainingTurns: number;
  /** Explicit usage-proxy units saved per reclaimed token per future turn. */
  readonly usageProxyPerRetainedTokenTurn: number;
  readonly checkpointCostProxy: number;
  readonly cacheChurnProxy: number;
  readonly rehydrationCostProxy: number;
  readonly riskCostProxy: number;
  readonly previousRecommendation: TriggerRecommendation | null;
  readonly turnsSinceLastPreparation: number;
  readonly riskScore: number;
  readonly invariantViolations: readonly string[];
  readonly config?: Partial<TriggerPolicyConfig>;
}

export interface TriggerInput extends OptimizationTriggerInput {
  readonly selectionFeasible: boolean;
  readonly allActionsReversible: boolean;
}

export interface TriggerEvaluation {
  readonly recommendation: TriggerRecommendation;
  readonly shouldPrepare: boolean;
  readonly reasonCodes: readonly TriggerReasonCode[];
  readonly tokenRatio: number;
  readonly expectedSavingsPerTurnProxy: number;
  readonly expectedFutureSavingsProxy: number;
  readonly totalPreparationCostProxy: number;
  readonly netBenefitProxy: number;
  readonly breakEvenTurns: number | null;
  readonly requiredNetBenefitProxy: number;
  readonly hardLimitReached: boolean;
  readonly failClosed: boolean;
  readonly config: TriggerPolicyConfig;
}

export interface OptimizationInput {
  readonly selection: SelectionInput;
  readonly trigger: OptimizationTriggerInput;
}

export interface OptimizationResult {
  readonly selection: SelectionResult;
  readonly trigger: TriggerEvaluation;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertSafeNonNegativeInteger(value: number, name: string): void {
  assertFiniteNonNegative(value, name);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function finiteProduct(left: number, right: number, name: string): number {
  const product = left * right;
  if (!Number.isFinite(product)) {
    throw new RangeError(`${name} exceeds the finite numeric range`);
  }
  return product;
}

function finiteSum(values: readonly number[], name: string): number {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum)) {
    throw new RangeError(`${name} exceeds the finite numeric range`);
  }
  return sum;
}

function resolveConfig(
  partial: Partial<TriggerPolicyConfig> | undefined,
): TriggerPolicyConfig {
  const config: TriggerPolicyConfig = {
    softLimitRatio:
      partial?.softLimitRatio ?? DEFAULT_TRIGGER_POLICY.softLimitRatio,
    hardLimitRatio:
      partial?.hardLimitRatio ?? DEFAULT_TRIGGER_POLICY.hardLimitRatio,
    releaseLimitRatio:
      partial?.releaseLimitRatio ?? DEFAULT_TRIGGER_POLICY.releaseLimitRatio,
    minNetBenefitProxy:
      partial?.minNetBenefitProxy ?? DEFAULT_TRIGGER_POLICY.minNetBenefitProxy,
    benefitHysteresisProxy:
      partial?.benefitHysteresisProxy ??
      DEFAULT_TRIGGER_POLICY.benefitHysteresisProxy,
    cooldownTurns: partial?.cooldownTurns ?? DEFAULT_TRIGGER_POLICY.cooldownTurns,
    maxRiskScore: partial?.maxRiskScore ?? DEFAULT_TRIGGER_POLICY.maxRiskScore,
  };

  assertFiniteNonNegative(config.releaseLimitRatio, "config.releaseLimitRatio");
  assertFiniteNonNegative(config.softLimitRatio, "config.softLimitRatio");
  assertFiniteNonNegative(config.hardLimitRatio, "config.hardLimitRatio");
  if (
    config.releaseLimitRatio >= config.softLimitRatio ||
    config.softLimitRatio >= config.hardLimitRatio ||
    config.hardLimitRatio > 1
  ) {
    throw new RangeError(
      "token ratios must satisfy 0 <= release < soft < hard <= 1",
    );
  }
  assertFiniteNonNegative(
    config.minNetBenefitProxy,
    "config.minNetBenefitProxy",
  );
  assertFiniteNonNegative(
    config.benefitHysteresisProxy,
    "config.benefitHysteresisProxy",
  );
  assertSafeNonNegativeInteger(config.cooldownTurns, "config.cooldownTurns");
  assertFiniteNonNegative(config.maxRiskScore, "config.maxRiskScore");
  if (config.maxRiskScore > 1) {
    throw new RangeError("config.maxRiskScore must be <= 1");
  }
  return config;
}

function validateInput(input: TriggerInput): void {
  assertSafeNonNegativeInteger(input.currentTokens, "currentTokens");
  assertSafeNonNegativeInteger(input.contextWindowTokens, "contextWindowTokens");
  if (input.contextWindowTokens === 0) {
    throw new RangeError("contextWindowTokens must be greater than zero");
  }
  assertSafeNonNegativeInteger(input.reclaimableTokens, "reclaimableTokens");
  assertSafeNonNegativeInteger(
    input.predictedRemainingTurns,
    "predictedRemainingTurns",
  );
  assertFiniteNonNegative(
    input.usageProxyPerRetainedTokenTurn,
    "usageProxyPerRetainedTokenTurn",
  );
  assertFiniteNonNegative(input.checkpointCostProxy, "checkpointCostProxy");
  assertFiniteNonNegative(input.cacheChurnProxy, "cacheChurnProxy");
  assertFiniteNonNegative(input.rehydrationCostProxy, "rehydrationCostProxy");
  assertFiniteNonNegative(input.riskCostProxy, "riskCostProxy");
  assertSafeNonNegativeInteger(
    input.turnsSinceLastPreparation,
    "turnsSinceLastPreparation",
  );
  assertFiniteNonNegative(input.riskScore, "riskScore");
  if (input.riskScore > 1) {
    throw new RangeError("riskScore must be <= 1");
  }
}

function buildEvaluation(
  recommendation: TriggerRecommendation,
  reasonCodes: readonly TriggerReasonCode[],
  values: Omit<
    TriggerEvaluation,
    "recommendation" | "shouldPrepare" | "reasonCodes"
  >,
): TriggerEvaluation {
  return {
    recommendation,
    shouldPrepare: recommendation === "PREPARE",
    reasonCodes,
    ...values,
  };
}

/**
 * Decides whether ContextGC should prepare a reversible checkpoint. PREPARE is
 * not a request to invoke Codex's native compaction.
 */
export function evaluateCompactionTrigger(input: TriggerInput): TriggerEvaluation {
  validateInput(input);
  const config = resolveConfig(input.config);
  const tokenRatio = input.currentTokens / input.contextWindowTokens;
  const expectedSavingsPerTurnProxy = finiteProduct(
    input.reclaimableTokens,
    input.usageProxyPerRetainedTokenTurn,
    "expectedSavingsPerTurnProxy",
  );
  const expectedFutureSavingsProxy = finiteProduct(
    expectedSavingsPerTurnProxy,
    input.predictedRemainingTurns,
    "expectedFutureSavingsProxy",
  );
  const totalPreparationCostProxy = finiteSum(
    [
      input.checkpointCostProxy,
      input.cacheChurnProxy,
      input.rehydrationCostProxy,
      input.riskCostProxy,
    ],
    "totalPreparationCostProxy",
  );
  const netBenefitProxy =
    expectedFutureSavingsProxy - totalPreparationCostProxy;
  const breakEvenTurns =
    expectedSavingsPerTurnProxy === 0
      ? null
      : totalPreparationCostProxy / expectedSavingsPerTurnProxy;
  const requiredNetBenefitProxy = Math.max(
    0,
    config.minNetBenefitProxy +
      (input.previousRecommendation === "PREPARE"
        ? -config.benefitHysteresisProxy
        : config.benefitHysteresisProxy),
  );
  const hardLimitReached = tokenRatio >= config.hardLimitRatio;
  const common = {
    tokenRatio,
    expectedSavingsPerTurnProxy,
    expectedFutureSavingsProxy,
    totalPreparationCostProxy,
    netBenefitProxy,
    breakEvenTurns,
    requiredNetBenefitProxy,
    hardLimitReached,
    config,
  };

  const safetyReasons: TriggerReasonCode[] = [];
  if (!input.selectionFeasible) {
    safetyReasons.push("SELECTION_INFEASIBLE");
  }
  if (input.invariantViolations.length > 0) {
    safetyReasons.push("INVARIANT_GATE_FAILED");
  }
  if (!input.allActionsReversible) {
    safetyReasons.push("NON_REVERSIBLE_ACTION");
  }
  if (input.riskScore > config.maxRiskScore) {
    safetyReasons.push("RISK_GATE_FAILED");
  }
  if (safetyReasons.length > 0) {
    return buildEvaluation("HOLD", safetyReasons, {
      ...common,
      failClosed: true,
    });
  }

  // The hard safety cap bypasses economic and cooldown gates, but never the
  // fail-closed invariant/reversibility/risk gates above.
  if (hardLimitReached) {
    return buildEvaluation("PREPARE", ["HARD_LIMIT_REACHED"], {
      ...common,
      failClosed: false,
    });
  }

  if (input.turnsSinceLastPreparation < config.cooldownTurns) {
    return buildEvaluation("HOLD", ["COOLDOWN_ACTIVE"], {
      ...common,
      failClosed: false,
    });
  }

  const tokenActivationRatio =
    input.previousRecommendation === "PREPARE"
      ? config.releaseLimitRatio
      : config.softLimitRatio;
  if (tokenRatio < tokenActivationRatio) {
    return buildEvaluation("HOLD", ["BELOW_TOKEN_THRESHOLD"], {
      ...common,
      failClosed: false,
    });
  }

  if (netBenefitProxy < requiredNetBenefitProxy) {
    return buildEvaluation("HOLD", ["ECONOMICALLY_UNFAVORABLE"], {
      ...common,
      failClosed: false,
    });
  }

  return buildEvaluation("PREPARE", ["BREAK_EVEN_REACHED"], {
    ...common,
    failClosed: false,
  });
}

export function optimizeContext(input: OptimizationInput): OptimizationResult {
  const selection = selectMemoryActions(input.selection);
  const trigger = evaluateCompactionTrigger({
    ...input.trigger,
    selectionFeasible: selection.feasible,
    allActionsReversible: selection.decisions.every(
      (decision) => decision.reversible,
    ),
  });
  return { selection, trigger };
}
