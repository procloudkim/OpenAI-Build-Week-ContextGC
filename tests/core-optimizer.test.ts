import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCompactionTrigger,
  optimizeContext,
  type MemoryAtom,
  type TriggerInput,
} from "../src/core/index.js";

function trigger(overrides: Partial<TriggerInput> = {}): TriggerInput {
  return {
    currentTokens: 80,
    contextWindowTokens: 100,
    reclaimableTokens: 20,
    predictedRemainingTurns: 10,
    usageProxyPerRetainedTokenTurn: 1,
    checkpointCostProxy: 20,
    cacheChurnProxy: 10,
    rehydrationCostProxy: 5,
    riskCostProxy: 5,
    previousRecommendation: null,
    turnsSinceLastPreparation: 10,
    riskScore: 0.01,
    invariantViolations: [],
    selectionFeasible: true,
    allActionsReversible: true,
    config: {
      minNetBenefitProxy: 10,
      benefitHysteresisProxy: 5,
    },
    ...overrides,
  };
}

test("break-even controller recommends reversible preparation above the soft limit", () => {
  const result = evaluateCompactionTrigger(trigger());

  assert.equal(result.recommendation, "PREPARE");
  assert.equal(result.shouldPrepare, true);
  assert.deepEqual(result.reasonCodes, ["BREAK_EVEN_REACHED"]);
  assert.equal(result.expectedSavingsPerTurnProxy, 20);
  assert.equal(result.expectedFutureSavingsProxy, 200);
  assert.equal(result.totalPreparationCostProxy, 40);
  assert.equal(result.netBenefitProxy, 160);
  assert.equal(result.breakEvenTurns, 2);
  assert.equal(result.requiredNetBenefitProxy, 15);
});
test("token and cooldown gates prevent noisy repeated preparation", () => {
  const below = evaluateCompactionTrigger(
    trigger({ currentTokens: 70, contextWindowTokens: 100 }),
  );
  const cooldown = evaluateCompactionTrigger(
    trigger({ turnsSinceLastPreparation: 1 }),
  );

  assert.deepEqual(below.reasonCodes, ["BELOW_TOKEN_THRESHOLD"]);
  assert.deepEqual(cooldown.reasonCodes, ["COOLDOWN_ACTIVE"]);
  assert.equal(below.shouldPrepare, false);
  assert.equal(cooldown.shouldPrepare, false);
});

test("hard limit bypasses economics and cooldown but not safety gates", () => {
  const urgent = evaluateCompactionTrigger(
    trigger({
      currentTokens: 95,
      reclaimableTokens: 0,
      predictedRemainingTurns: 0,
      turnsSinceLastPreparation: 0,
    }),
  );
  const unsafe = evaluateCompactionTrigger(
    trigger({
      currentTokens: 95,
      riskScore: 0.9,
      invariantViolations: ["missing exact constraint"],
    }),
  );

  assert.equal(urgent.shouldPrepare, true);
  assert.deepEqual(urgent.reasonCodes, ["HARD_LIMIT_REACHED"]);
  assert.equal(unsafe.shouldPrepare, false);
  assert.equal(unsafe.failClosed, true);
  assert.deepEqual(unsafe.reasonCodes, [
    "INVARIANT_GATE_FAILED",
    "RISK_GATE_FAILED",
  ]);
});

test("all fail-closed gates are reported deterministically", () => {
  const result = evaluateCompactionTrigger(
    trigger({
      selectionFeasible: false,
      invariantViolations: ["goal missing"],
      allActionsReversible: false,
      riskScore: 0.5,
    }),
  );

  assert.equal(result.shouldPrepare, false);
  assert.equal(result.failClosed, true);
  assert.deepEqual(result.reasonCodes, [
    "SELECTION_INFEASIBLE",
    "INVARIANT_GATE_FAILED",
    "NON_REVERSIBLE_ACTION",
    "RISK_GATE_FAILED",
  ]);
});

test("Schmitt hysteresis keeps a previous PREPARE recommendation stable", () => {
  const previousPrepare = evaluateCompactionTrigger(
    trigger({
      currentTokens: 70,
      previousRecommendation: "PREPARE",
      reclaimableTokens: 5,
      predictedRemainingTurns: 3,
      checkpointCostProxy: 0,
      cacheChurnProxy: 0,
      rehydrationCostProxy: 0,
      riskCostProxy: 0,
    }),
  );
  const previousHold = evaluateCompactionTrigger(
    trigger({
      previousRecommendation: "HOLD",
      reclaimableTokens: 1,
      predictedRemainingTurns: 20,
      checkpointCostProxy: 0,
      cacheChurnProxy: 0,
      rehydrationCostProxy: 0,
      riskCostProxy: 0,
    }),
  );

  assert.equal(previousPrepare.shouldPrepare, true);
  assert.equal(previousPrepare.requiredNetBenefitProxy, 5);
  assert.equal(previousHold.requiredNetBenefitProxy, 15);
  assert.equal(previousHold.shouldPrepare, true);
});

test("zero possible savings has a null break-even and holds economically", () => {
  const result = evaluateCompactionTrigger(
    trigger({
      reclaimableTokens: 0,
      checkpointCostProxy: 1,
      cacheChurnProxy: 0,
      rehydrationCostProxy: 0,
      riskCostProxy: 0,
    }),
  );

  assert.equal(result.breakEvenTurns, null);
  assert.equal(result.shouldPrepare, false);
  assert.deepEqual(result.reasonCodes, ["ECONOMICALLY_UNFAVORABLE"]);
});

test("combined optimizer propagates an infeasible selection into fail-closed HOLD", () => {
  const exactAtom: MemoryAtom = {
    id: "exact",
    kind: "constraint",
    sourceRef: "ledger:exact",
    contentHash: "sha256:exact",
    protected: true,
    exact: true,
    tokenEstimate: 10,
    lifecyclePhase: "verify",
    lastUsedAt: "2026-07-18T00:00:00.000Z",
  };
  const baseTrigger = trigger();
  const {
    selectionFeasible: _selectionFeasible,
    allActionsReversible: _allActionsReversible,
    ...optimizationTrigger
  } = baseTrigger;
  const result = optimizeContext({
    selection: {
      tokenBudget: 1,
      candidates: [
        {
          atom: exactAtom,
          options: [
            {
              action: "KEEP",
              tokenCost: 10,
              utility: 10,
              riskScore: 0,
              reversible: true,
              preservesExactContent: true,
            },
          ],
        },
      ],
    },
    trigger: optimizationTrigger,
  });

  assert.equal(result.selection.feasible, false);
  assert.equal(result.selection.decisions[0]?.action, "KEEP");
  assert.equal(result.trigger.failClosed, true);
  assert.deepEqual(result.trigger.reasonCodes, ["SELECTION_INFEASIBLE"]);
});

test("invalid threshold ordering and non-finite inputs are rejected", () => {
  assert.throws(
    () =>
      evaluateCompactionTrigger(
        trigger({ config: { releaseLimitRatio: 0.8, softLimitRatio: 0.7 } }),
      ),
    /release < soft < hard/,
  );
  assert.throws(
    () =>
      evaluateCompactionTrigger(
        trigger({ usageProxyPerRetainedTokenTurn: Number.POSITIVE_INFINITY }),
      ),
    /finite non-negative/,
  );
});
