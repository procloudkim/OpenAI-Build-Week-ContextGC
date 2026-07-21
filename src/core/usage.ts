import type {
  ApiEquivalentRateCard,
  ApiEquivalentUsdBreakdown,
  TokenUsage,
  UsageProxyBreakdown,
  UsageWeights,
} from "./types.js";

export const DEFAULT_USAGE_WEIGHTS: UsageWeights = Object.freeze({
  id: "neutral-v1",
  uncachedInputWeight: 1,
  cachedInputWeight: 1,
  cacheWriteInputWeight: 1,
  outputWeight: 1,
});

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}
function validateUsage(usage: TokenUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    assertFiniteNonNegative(value, `usage.${name}`);
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`usage.${name} must be a safe integer`);
    }
  }
}

function validateWeights(weights: UsageWeights): void {
  if (weights.id.trim().length === 0) {
    throw new RangeError("weights.id must not be empty");
  }
  assertFiniteNonNegative(weights.uncachedInputWeight, "weights.uncachedInputWeight");
  assertFiniteNonNegative(weights.cachedInputWeight, "weights.cachedInputWeight");
  assertFiniteNonNegative(weights.cacheWriteInputWeight, "weights.cacheWriteInputWeight");
  assertFiniteNonNegative(weights.outputWeight, "weights.outputWeight");
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

/**
 * Produces a transparent normalized usage proxy, not a Codex/ChatGPT credit
 * estimate. The supplied weights are copied into the result for auditability.
 */
export function calculateUsageProxy(
  usage: TokenUsage,
  weights: UsageWeights = DEFAULT_USAGE_WEIGHTS,
): UsageProxyBreakdown {
  validateUsage(usage);
  validateWeights(weights);

  const rawUsage = { ...usage };
  const appliedWeights = { ...weights };
  const uncachedInput = round(
    usage.uncachedInputTokens * weights.uncachedInputWeight,
  );
  const cachedInput = round(usage.cachedInputTokens * weights.cachedInputWeight);
  const cacheWriteInput = round(
    usage.cacheWriteInputTokens * weights.cacheWriteInputWeight,
  );
  const output = round(usage.outputTokens * weights.outputWeight);

  return {
    unit: "weighted-token-units",
    rawUsage,
    weights: appliedWeights,
    uncachedInput,
    cachedInput,
    cacheWriteInput,
    output,
    total: round(uncachedInput + cachedInput + cacheWriteInput + output),
  };
}

/**
 * Optional counterfactual API cost. It is only available when a caller supplies
 * an explicit rate card and must never be labelled as ChatGPT/Codex credits.
 */
export function calculateApiEquivalentUsd(
  usage: TokenUsage,
  rateCard: ApiEquivalentRateCard,
): ApiEquivalentUsdBreakdown {
  validateUsage(usage);
  if (rateCard.id.trim().length === 0) {
    throw new RangeError("rateCard.id must not be empty");
  }
  if (rateCard.currency !== "USD") {
    throw new RangeError("rateCard.currency must be USD");
  }

  assertFiniteNonNegative(
    rateCard.uncachedInputUsdPerMillionTokens,
    "rateCard.uncachedInputUsdPerMillionTokens",
  );
  assertFiniteNonNegative(
    rateCard.cachedInputUsdPerMillionTokens,
    "rateCard.cachedInputUsdPerMillionTokens",
  );
  assertFiniteNonNegative(
    rateCard.cacheWriteInputUsdPerMillionTokens,
    "rateCard.cacheWriteInputUsdPerMillionTokens",
  );
  assertFiniteNonNegative(
    rateCard.outputUsdPerMillionTokens,
    "rateCard.outputUsdPerMillionTokens",
  );

  const perMillion = 1_000_000;
  const uncachedInputUsd = round(
    (usage.uncachedInputTokens * rateCard.uncachedInputUsdPerMillionTokens) /
      perMillion,
  );
  const cachedInputUsd = round(
    (usage.cachedInputTokens * rateCard.cachedInputUsdPerMillionTokens) /
      perMillion,
  );
  const cacheWriteInputUsd = round(
    (usage.cacheWriteInputTokens *
      rateCard.cacheWriteInputUsdPerMillionTokens) /
      perMillion,
  );
  const outputUsd = round(
    (usage.outputTokens * rateCard.outputUsdPerMillionTokens) / perMillion,
  );

  return {
    qualification: "api-equivalent-estimate",
    rateCard: { ...rateCard },
    rawUsage: { ...usage },
    uncachedInputUsd,
    cachedInputUsd,
    cacheWriteInputUsd,
    outputUsd,
    totalUsd: round(
      uncachedInputUsd + cachedInputUsd + cacheWriteInputUsd + outputUsd,
    ),
  };
}
