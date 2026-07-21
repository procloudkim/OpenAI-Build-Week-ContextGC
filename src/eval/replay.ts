import {
  calculateUsageProxy,
  DEFAULT_USAGE_WEIGHTS,
} from "../core/usage.js";
import type { TokenUsage } from "../core/types.js";
import {
  baselineRetentionActions,
  EvaluationMemory,
  type EvalRetentionAction,
  type MemoryCandidate,
} from "./memory.js";
import type {
  BenchmarkFixture,
  CompactionEvent,
  FactUseOutcome,
  PolicyName,
  PolicyRun,
  UsageTotals,
} from "./schema.js";
import { adaptivePolicyDecision } from "./adaptive-policy.js";

interface MutableUsage {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
}

interface CompactionDecision {
  shouldCompact: boolean;
  trigger: string;
  actions: ReadonlyMap<string, EvalRetentionAction>;
  coreOptimizerUsed: boolean;
  adaptiveRecommendation: "PREPARE" | "HOLD" | null;
}

interface PolicyContext {
  fixture: BenchmarkFixture;
  policy: PolicyName;
  turnIndex: number;
  turnId: string;
  activeTokens: number;
  lastCompactionTurn: number | null;
  recentGrowthTokens: number;
  candidates: readonly MemoryCandidate[];
  previousRecommendation: "PREPARE" | "HOLD" | null;
}

const CHECKPOINT_INPUT_TOKENS = 320;
const CHECKPOINT_OUTPUT_TOKENS = 180;
const POST_COMPACTION_CONTEXT_RATIO = 0.36;
const MAX_REHYDRATION_TOKENS_PER_TURN = 256;

function addUsage(target: MutableUsage, addition: TokenUsage): void {
  target.uncachedInputTokens += addition.uncachedInputTokens;
  target.cachedInputTokens += addition.cachedInputTokens;
  target.cacheWriteInputTokens += addition.cacheWriteInputTokens;
  target.outputTokens += addition.outputTokens;
}

function finalizeUsage(usage: MutableUsage): UsageTotals {
  return {
    ...usage,
    usageProxy: calculateUsageProxy(usage, DEFAULT_USAGE_WEIGHTS).total,
  };
}

function baselineDecision(context: PolicyContext): CompactionDecision {
  if (context.policy === "M_MANUAL") {
    const shouldCompact = context.fixture.manualCheckpointTurns.includes(
      context.turnId,
    );
    return {
      shouldCompact,
      trigger: shouldCompact ? "frozen-manual-schedule" : "not-scheduled",
      actions: shouldCompact
        ? baselineRetentionActions(context.candidates)
        : new Map(),
      coreOptimizerUsed: false,
      adaptiveRecommendation: null,
    };
  }

  const ratio = context.activeTokens / context.fixture.contextBudgetTokens;
  const cooldownPassed =
    context.lastCompactionTurn === null ||
    context.turnIndex - context.lastCompactionTurn > 2;
  const shouldCompact = ratio >= 0.75 && cooldownPassed;
  return {
    shouldCompact,
    trigger: shouldCompact
      ? "fixed-75-percent-threshold"
      : ratio >= 0.75
        ? "fixed-cooldown"
        : "fixed-below-threshold",
    actions: shouldCompact
      ? baselineRetentionActions(context.candidates)
      : new Map(),
    coreOptimizerUsed: false,
    adaptiveRecommendation: null,
  };
}

function decide(context: PolicyContext): CompactionDecision {
  if (context.policy !== "A_ADAPTIVE") {
    return baselineDecision(context);
  }
  return adaptivePolicyDecision(context);
}

function countActions(
  actions: ReadonlyMap<string, EvalRetentionAction>,
): Record<EvalRetentionAction, number> {
  const counts: Record<EvalRetentionAction, number> = {
    KEEP: 0,
    SUMMARIZE: 0,
    EXTERNALIZE: 0,
  };
  for (const action of actions.values()) {
    counts[action] += 1;
  }
  return counts;
}

export function replayPolicy(
  fixture: BenchmarkFixture,
  policy: PolicyName,
): PolicyRun {
  const memory = new EvaluationMemory();
  const usage: MutableUsage = {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
  };
  const compactions: CompactionEvent[] = [];
  const factUses: FactUseOutcome[] = [];
  const forbiddenChanges: string[] = [];
  let activeTokens = 0;
  let uncompressedContextTokens = 0;
  let priorPrefixTokens = 0;
  let cacheWarmth = 1;
  let lastCompactionTurn: number | null = null;
  let previousActiveTokens = 0;
  let previousAdaptiveRecommendation: "PREPARE" | "HOLD" | null = null;

  fixture.turns.forEach((turn, turnIndex) => {
    const turnUses = new Map<string, FactUseOutcome>();
    let rehydrationBudgetRemaining = MAX_REHYDRATION_TOKENS_PER_TURN;
    for (const factId of turn.usesFacts) {
      const use = memory.use(
        factId,
        turnIndex,
        rehydrationBudgetRemaining,
      );
      activeTokens += use.tokensAdded;
      rehydrationBudgetRemaining -= use.tokensAdded;
      const outcome: FactUseOutcome = { turnId: turn.id, ...use.outcome };
      factUses.push(outcome);
      turnUses.set(factId, outcome);
    }

    const prefixBeforeNewContext = activeTokens;
    activeTokens += turn.newContextTokens;
    uncompressedContextTokens += turn.newContextTokens + turn.outputTokens;

    const cachedInputTokens = Math.min(
      activeTokens,
      Math.floor(
        Math.min(priorPrefixTokens, prefixBeforeNewContext) *
          turn.cacheShare *
          cacheWarmth,
      ),
    );
    const uncachedInputTokens = activeTokens - cachedInputTokens;
    addUsage(usage, {
      uncachedInputTokens,
      cachedInputTokens,
      cacheWriteInputTokens: 0,
      outputTokens: turn.outputTokens,
    });

    activeTokens += turn.outputTokens;
    for (const fact of turn.facts) {
      memory.introduce(fact, turnIndex);
    }

    for (const proposedChange of turn.proposedChanges) {
      if (turnUses.get(proposedChange.guardFactId)?.available !== true) {
        forbiddenChanges.push(proposedChange.target);
      }
    }

    const recentGrowthTokens = Math.max(0, activeTokens - previousActiveTokens);
    const decision = decide({
      fixture,
      policy,
      turnIndex,
      turnId: turn.id,
      activeTokens,
      lastCompactionTurn,
      recentGrowthTokens,
      candidates: memory.candidates(turnIndex),
      previousRecommendation: previousAdaptiveRecommendation,
    });
    if (decision.adaptiveRecommendation !== null) {
      previousAdaptiveRecommendation = decision.adaptiveRecommendation;
    }

    if (decision.shouldCompact) {
      const activeTokensBefore = activeTokens;
      addUsage(usage, {
        uncachedInputTokens: CHECKPOINT_INPUT_TOKENS,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: CHECKPOINT_OUTPUT_TOKENS,
      });
      memory.applyActions(decision.actions);
      activeTokens = Math.max(
        memory.activeFactTokens(),
        Math.floor(activeTokensBefore * POST_COMPACTION_CONTEXT_RATIO),
      );
      compactions.push({
        turnId: turn.id,
        trigger: decision.trigger,
        activeTokensBefore,
        activeTokensAfter: activeTokens,
        actions: countActions(decision.actions),
        coreOptimizerUsed: decision.coreOptimizerUsed,
      });
      lastCompactionTurn = turnIndex;
      cacheWarmth = 0.25;
    } else {
      cacheWarmth = Math.min(1, cacheWarmth + 0.35);
    }

    priorPrefixTokens = activeTokens;
    previousActiveTokens = activeTokens;
  });

  return {
    fixtureId: fixture.id,
    policy,
    turnsProcessed: fixture.turns.length,
    usage: finalizeUsage(usage),
    compactions,
    rehydrations: memory.rehydrations,
    rollbackAvailable: true,
    manualInterventions:
      policy === "M_MANUAL" ? compactions.length : 0,
    forbiddenChanges: [...new Set(forbiddenChanges)].sort(),
    factUses,
    uncompressedContextTokens,
    finalActiveTokens: activeTokens,
  };
}

export type { PolicyContext, CompactionDecision };
