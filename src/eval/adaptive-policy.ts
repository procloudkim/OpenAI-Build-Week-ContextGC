import {
  optimizeContext,
  type AtomCandidate,
  type LifecyclePhase,
  type MemoryAtom,
  type RetentionOption,
} from "../core/index.js";
import { sha256 } from "./canonical.js";
import type { EvalRetentionAction, MemoryCandidate } from "./memory.js";
import type { CompactionDecision, PolicyContext } from "./replay.js";

function lifecyclePhase(phase: PolicyContext["fixture"]["turns"][number]["phase"]): LifecyclePhase {
  return phase === "release" ? "handoff" : phase;
}

function atomFromCandidate(
  candidate: MemoryCandidate,
  context: PolicyContext,
): MemoryAtom {
  const fact = candidate.fact;
  return {
    id: fact.id,
    kind: fact.kind,
    sourceRef: `fixture:${context.fixture.id}:${fact.id}`,
    contentHash: sha256(fact.value),
    archiveRef: `sha256:${sha256(fact.value)}`,
    protected: fact.protected,
    exact: fact.exact,
    tokenEstimate: fact.tokens,
    lifecyclePhase: lifecyclePhase(
      context.fixture.turns[context.turnIndex]?.phase ?? "explore",
    ),
    lastUsedAt: `turn-${String(candidate.lastUsedTurn + 1).padStart(2, "0")}`,
    inlineContent: fact.value,
  };
}

function retentionOptions(candidate: MemoryCandidate): RetentionOption[] {
  const fact = candidate.fact;
  const baseUtility = fact.importance * 10;
  const options: RetentionOption[] = [
    {
      action: "KEEP",
      tokenCost: fact.tokens,
      utility: baseUtility,
      riskScore: 0,
      reversible: true,
      preservesExactContent: true,
    },
    {
      action: "EXTERNALIZE",
      tokenCost: 0,
      utility: baseUtility * (fact.protected ? 0.96 : 0.9),
      riskScore: fact.protected ? 0.01 : 0.02,
      reversible: true,
      preservesExactContent: true,
    },
  ];
  if (!fact.protected && !fact.exact) {
    options.push({
      action: "SUMMARIZE",
      tokenCost: Math.max(12, Math.ceil(fact.tokens * 0.35)),
      utility: baseUtility * 0.94,
      riskScore: 0.025,
      reversible: true,
      preservesExactContent: false,
    });
  }
  return options;
}

function atomCandidates(context: PolicyContext): AtomCandidate[] {
  return context.candidates.map((candidate) => ({
    atom: atomFromCandidate(candidate, context),
    options: retentionOptions(candidate),
  }));
}

export function adaptivePolicyDecision(
  context: PolicyContext,
): CompactionDecision {
  const candidates = atomCandidates(context);
  const totalAtomTokens = candidates.reduce(
    (sum, candidate) => sum + candidate.atom.tokenEstimate,
    0,
  );
  const reclaimableTokens = Math.max(
    0,
    context.activeTokens - Math.floor(context.activeTokens * 0.36),
  );
  const predictedRemainingTurns = Math.max(
    0,
    context.fixture.turns.length - context.turnIndex - 1,
  );
  const turnsSinceLastPreparation =
    context.lastCompactionTurn === null
      ? context.turnIndex + 3
      : context.turnIndex - context.lastCompactionTurn;

  const result = optimizeContext({
    selection: {
      candidates,
      tokenBudget: Math.max(96, Math.floor(totalAtomTokens * 0.55)),
      maxTotalRisk: 0.25,
      exactDpAtomLimit: 18,
      maxExactCombinations: 1_000_000,
    },
    trigger: {
      currentTokens: context.activeTokens,
      contextWindowTokens: context.fixture.contextBudgetTokens,
      reclaimableTokens,
      predictedRemainingTurns,
      usageProxyPerRetainedTokenTurn: 1,
      checkpointCostProxy: 500,
      cacheChurnProxy: Math.floor(context.activeTokens * 0.02),
      rehydrationCostProxy: Math.ceil(totalAtomTokens * 0.1),
      riskCostProxy: 50,
      previousRecommendation: context.previousRecommendation,
      turnsSinceLastPreparation,
      riskScore: Math.min(1, resultRiskUpperBound(candidates)),
      invariantViolations: [],
      config: {
        releaseLimitRatio: 0.48,
        softLimitRatio: 0.58,
        hardLimitRatio: 0.88,
        minNetBenefitProxy: 50,
        benefitHysteresisProxy: 100,
        cooldownTurns: 2,
        maxRiskScore: 0.25,
      },
    },
  });

  const actions = new Map<string, EvalRetentionAction>();
  if (result.trigger.shouldPrepare) {
    for (const decision of result.selection.decisions) {
      actions.set(decision.atomId, decision.action);
    }
  }
  return {
    shouldCompact: result.trigger.shouldPrepare,
    trigger: `adaptive:${result.trigger.reasonCodes.join("+").toLowerCase()}`,
    actions,
    coreOptimizerUsed: true,
    adaptiveRecommendation: result.trigger.recommendation,
  };
}

function resultRiskUpperBound(candidates: readonly AtomCandidate[]): number {
  if (candidates.length === 0) {
    return 0;
  }
  // A conservative pre-selection risk signal. The optimizer independently
  // rejects unsafe options and enforces the aggregate risk budget.
  return candidates.reduce((sum, candidate) => {
    const safest = Math.min(...candidate.options.map((option) => option.riskScore));
    return sum + safest;
  }, 0);
}
