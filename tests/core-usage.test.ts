import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USAGE_WEIGHTS,
  calculateApiEquivalentUsd,
  calculateUsageProxy,
} from "../src/core/index.js";
import * as core from "../src/core/index.js";

const usage = {
  uncachedInputTokens: 1_000_000,
  cachedInputTokens: 2_000_000,
  cacheWriteInputTokens: 500_000,
  outputTokens: 250_000,
} as const;

test("neutral usage proxy is an auditable sum of non-overlapping categories", () => {
  const result = calculateUsageProxy(usage);

  assert.deepEqual(result.rawUsage, usage);
  assert.deepEqual(result.weights, DEFAULT_USAGE_WEIGHTS);
  assert.equal(result.unit, "weighted-token-units");
  assert.equal(result.uncachedInput, 1_000_000);
  assert.equal(result.cachedInput, 2_000_000);
  assert.equal(result.cacheWriteInput, 500_000);
  assert.equal(result.output, 250_000);
  assert.equal(result.total, 3_750_000);
});
test("usage weights are explicit, configurable, and serialized in the result", () => {
  const weights = {
    id: "experiment-a",
    uncachedInputWeight: 1,
    cachedInputWeight: 0.25,
    cacheWriteInputWeight: 1.5,
    outputWeight: 2,
  } as const;
  const result = calculateUsageProxy(usage, weights);

  assert.deepEqual(result.weights, weights);
  assert.equal(result.total, 2_750_000);
});

test("API-equivalent dollars require an explicit rate card and remain qualified", () => {
  const result = calculateApiEquivalentUsd(usage, {
    id: "caller-supplied-test-card",
    currency: "USD",
    uncachedInputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: 0.5,
    cacheWriteInputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 8,
  });

  assert.equal(result.qualification, "api-equivalent-estimate");
  assert.equal(result.uncachedInputUsd, 2);
  assert.equal(result.cachedInputUsd, 1);
  assert.equal(result.cacheWriteInputUsd, 0.5);
  assert.equal(result.outputUsd, 2);
  assert.equal(result.totalUsd, 5.5);
});

test("usage calculator rejects overlapping/invalid numeric inputs defensively", () => {
  assert.throws(
    () =>
      calculateUsageProxy({
        ...usage,
        uncachedInputTokens: -1,
      }),
    /finite non-negative/,
  );
  assert.throws(
    () =>
      calculateUsageProxy({
        ...usage,
        outputTokens: 1.5,
      }),
    /safe integer/,
  );
  assert.throws(
    () =>
      calculateUsageProxy(usage, {
        ...DEFAULT_USAGE_WEIGHTS,
        outputWeight: Number.NaN,
      }),
    /finite non-negative/,
  );
});

test("core exposes no token-to-ChatGPT-credit estimation function", () => {
  assert.equal(
    Object.hasOwn(core as Record<string, unknown>, "calculateEstimatedCredits"),
    false,
  );
});
