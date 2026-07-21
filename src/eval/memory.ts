import type { FactUseOutcome, FixtureFact } from "./schema.js";

export type EvalRetentionAction = "KEEP" | "SUMMARIZE" | "EXTERNALIZE";

interface MemoryEntry extends FixtureFact {
  introducedTurn: number;
  lastUsedTurn: number;
  location: "active" | "summary" | "archive";
  exactPreserved: boolean;
  activeTokenCost: number;
}

export interface MemoryCandidate {
  fact: FixtureFact;
  age: number;
  lastUsedTurn: number;
  location: MemoryEntry["location"];
  activeTokenCost: number;
}

export interface MemoryUseResult {
  tokensAdded: number;
  outcome: Omit<FactUseOutcome, "turnId">;
}

export class EvaluationMemory {
  readonly #entries = new Map<string, MemoryEntry>();
  #rehydrations = 0;

  introduce(fact: FixtureFact, turnIndex: number): void {
    if (this.#entries.has(fact.id)) {
      throw new Error(`Duplicate memory fact ${fact.id}`);
    }
    this.#entries.set(fact.id, {
      ...fact,
      introducedTurn: turnIndex,
      lastUsedTurn: turnIndex,
      location: "active",
      exactPreserved: true,
      activeTokenCost: fact.tokens,
    });
  }

  use(
    factId: string,
    turnIndex: number,
    rehydrationBudgetTokens: number,
  ): MemoryUseResult {
    const entry = this.#entries.get(factId);
    if (entry === undefined) {
      throw new Error(`Cannot use unknown fact ${factId}`);
    }
    entry.lastUsedTurn = turnIndex;
    const locationAtRequest = entry.location;
    let tokensAdded = 0;
    let rehydrated = false;
    let rehydrationBudgetExceeded = false;
    if (entry.location === "archive") {
      if (entry.tokens <= rehydrationBudgetTokens) {
        entry.location = "active";
        entry.activeTokenCost = entry.tokens;
        this.#rehydrations += 1;
        tokensAdded = entry.tokens;
        rehydrated = true;
      } else {
        rehydrationBudgetExceeded = true;
      }
    }
    const available =
      !rehydrationBudgetExceeded &&
      (entry.location !== "summary" || !entry.exact || entry.exactPreserved);
    return {
      tokensAdded,
      outcome: {
        factId: entry.id,
        available,
        actualValue: available ? entry.value : null,
        protected: entry.protected,
        exact: entry.exact,
        exactPreserved: entry.exactPreserved,
        semanticIntegrity: available,
        locationAtRequest,
        rehydrated,
        failureReason: rehydrationBudgetExceeded
          ? "REHYDRATION_BUDGET_EXCEEDED"
          : null,
      },
    };
  }

  candidates(turnIndex: number): MemoryCandidate[] {
    return [...this.#entries.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => ({
        fact: {
          id: entry.id,
          kind: entry.kind,
          value: entry.value,
          tokens: entry.tokens,
          importance: entry.importance,
          protected: entry.protected,
          exact: entry.exact,
        },
        age: Math.max(0, turnIndex - entry.introducedTurn),
        lastUsedTurn: entry.lastUsedTurn,
        location: entry.location,
        activeTokenCost: entry.activeTokenCost,
      }));
  }

  applyActions(actions: ReadonlyMap<string, EvalRetentionAction>): void {
    for (const [factId, action] of actions) {
      const entry = this.#entries.get(factId);
      if (entry === undefined) {
        throw new Error(`Action references unknown fact ${factId}`);
      }
      if (entry.protected && action !== "KEEP" && action !== "EXTERNALIZE") {
        throw new Error(`Protected fact ${factId} cannot be lossy-summarized`);
      }
      if (entry.exact && action === "SUMMARIZE") {
        throw new Error(`Exact fact ${factId} cannot be lossy-summarized`);
      }

      if (action === "KEEP") {
        entry.location = "active";
        entry.activeTokenCost = entry.tokens;
        entry.exactPreserved = true;
      } else if (action === "SUMMARIZE") {
        entry.location = "summary";
        entry.activeTokenCost = Math.max(12, Math.ceil(entry.tokens * 0.35));
        entry.exactPreserved = !entry.exact;
      } else {
        entry.location = "archive";
        entry.activeTokenCost = 0;
        entry.exactPreserved = true;
      }
    }
  }

  activeFactTokens(): number {
    return [...this.#entries.values()].reduce(
      (sum, entry) => sum + entry.activeTokenCost,
      0,
    );
  }

  get rehydrations(): number {
    return this.#rehydrations;
  }
}

export function baselineRetentionActions(
  candidates: readonly MemoryCandidate[],
): ReadonlyMap<string, EvalRetentionAction> {
  const actions = new Map<string, EvalRetentionAction>();
  for (const candidate of candidates) {
    const { fact } = candidate;
    if (fact.protected) {
      actions.set(fact.id, "KEEP");
    } else if (fact.exact || fact.importance <= 3) {
      actions.set(fact.id, "EXTERNALIZE");
    } else if (fact.importance >= 7) {
      actions.set(fact.id, "SUMMARIZE");
    } else {
      actions.set(fact.id, "EXTERNALIZE");
    }
  }
  return actions;
}
