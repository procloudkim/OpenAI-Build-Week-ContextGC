import type { MemoryAction, MemoryAtom } from "./types.js";

const EPSILON = 1e-12;

export interface RetentionOption {
  readonly action: MemoryAction;
  readonly tokenCost: number;
  readonly utility: number;
  /** Additive bounded risk proxy in the range [0, 1]. */
  readonly riskScore: number;
  /** True only when the raw pre-action information remains recoverable. */
  readonly reversible: boolean;
  /** True when exact bytes/values remain available after this action. */
  readonly preservesExactContent: boolean;
  /** Sanitizing an archive makes it non-exact even when it remains useful. */
  readonly redactionCount?: number;
  /** Mirrors the runtime ContentRef trust boundary for archived content. */
  readonly secretScanStatus?: "clean" | "sanitized" | "unscanned";
}

export interface AtomCandidate {
  readonly atom: MemoryAtom;
  readonly options: readonly RetentionOption[];
}

export interface SelectionInput {
  readonly candidates: readonly AtomCandidate[];
  readonly tokenBudget: number;
  readonly maxTotalRisk?: number;
  /** Exact Pareto dynamic programming is used at or below this size. */
  readonly exactDpAtomLimit?: number;
  /** Prevents accidental exponential work despite a small atom count. */
  readonly maxExactCombinations?: number;
}

export type SelectionMethod = "exact-dp" | "heuristic" | "fail-closed";

export interface SelectionDecision {
  readonly atomId: string;
  readonly action: MemoryAction;
  readonly tokenCost: number;
  readonly utility: number;
  readonly riskScore: number;
  readonly reversible: true;
  readonly preservesExactContent: boolean;
  readonly reasonCodes: readonly string[];
}

export interface SelectionResult {
  readonly feasible: boolean;
  readonly method: SelectionMethod;
  readonly decisions: readonly SelectionDecision[];
  readonly totalTokens: number;
  readonly totalUtility: number;
  readonly totalRisk: number;
  readonly tokenBudget: number;
  readonly maxTotalRisk: number;
  readonly protectedAtomIds: readonly string[];
  readonly discardedUnsafeOptions: number;
  readonly violations: readonly string[];
}

interface PreparedCandidate {
  readonly atom: MemoryAtom;
  readonly safeOptions: readonly RetentionOption[];
  readonly keep: RetentionOption;
  readonly archiveTrustBlocked: boolean;
}

interface State {
  readonly options: readonly RetentionOption[];
  readonly tokens: number;
  readonly utility: number;
  readonly risk: number;
}

const DEFAULT_EXACT_DP_ATOM_LIMIT = 18;
const DEFAULT_MAX_EXACT_COMBINATIONS = 1_000_000;
const DEFAULT_MAX_TOTAL_RISK = 1;
const ARCHIVE_REF = /^sha256:[a-f0-9]{64}$/;

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function actionRank(action: MemoryAction): number {
  switch (action) {
    case "KEEP":
      return 0;
    case "EXTERNALIZE":
      return 1;
    case "SUMMARIZE":
      return 2;
  }
}

function validateAtom(atom: MemoryAtom): void {
  if (atom.id.trim().length === 0) {
    throw new RangeError("atom.id must not be empty");
  }
  if (atom.sourceRef.trim().length === 0) {
    throw new RangeError(`atom ${atom.id} sourceRef must not be empty`);
  }
  if (atom.contentHash.trim().length === 0) {
    throw new RangeError(`atom ${atom.id} contentHash must not be empty`);
  }
  if (atom.archiveRef !== undefined && !ARCHIVE_REF.test(atom.archiveRef)) {
    throw new RangeError(`atom ${atom.id} archiveRef must be a sha256 content reference`);
  }
  assertFiniteNonNegative(atom.tokenEstimate, `atom ${atom.id} tokenEstimate`);
  if (!Number.isSafeInteger(atom.tokenEstimate)) {
    throw new RangeError(`atom ${atom.id} tokenEstimate must be a safe integer`);
  }
}

function validateOption(atomId: string, option: RetentionOption): void {
  if (
    option.action !== "KEEP" &&
    option.action !== "SUMMARIZE" &&
    option.action !== "EXTERNALIZE"
  ) {
    throw new RangeError(`${atomId} contains an unsupported retention action`);
  }
  assertFiniteNonNegative(option.tokenCost, `${atomId}.${option.action}.tokenCost`);
  if (!Number.isSafeInteger(option.tokenCost)) {
    throw new RangeError(`${atomId}.${option.action}.tokenCost must be a safe integer`);
  }
  assertFinite(option.utility, `${atomId}.${option.action}.utility`);
  assertFiniteNonNegative(option.riskScore, `${atomId}.${option.action}.riskScore`);
  if (option.riskScore > 1) {
    throw new RangeError(`${atomId}.${option.action}.riskScore must be <= 1`);
  }
  if (option.redactionCount !== undefined) {
    assertFiniteNonNegative(
      option.redactionCount,
      `${atomId}.${option.action}.redactionCount`,
    );
    if (!Number.isSafeInteger(option.redactionCount)) {
      throw new RangeError(
        `${atomId}.${option.action}.redactionCount must be a safe integer`,
      );
    }
  }
  if (
    option.secretScanStatus !== undefined &&
    option.secretScanStatus !== "clean" &&
    option.secretScanStatus !== "sanitized" &&
    option.secretScanStatus !== "unscanned"
  ) {
    throw new RangeError(
      `${atomId}.${option.action}.secretScanStatus is unsupported`,
    );
  }
}

function isSafeOption(atom: MemoryAtom, option: RetentionOption): boolean {
  if (option.action === "KEEP") {
    return (
      option.reversible &&
      option.preservesExactContent &&
      option.riskScore === 0
    );
  }

  // MVP policy: every automatic transformation must be reversible.
  if (!option.reversible) {
    return false;
  }
  if ((atom.protected || atom.exact) && option.action === "SUMMARIZE") {
    return false;
  }
  if (
    (atom.protected || atom.exact || option.action === "EXTERNALIZE") &&
    !option.preservesExactContent
  ) {
    return false;
  }
  if (option.action === "EXTERNALIZE" && (atom.protected || atom.exact)) {
    // A zero redaction count is not proof that the archive was scanned. Binary
    // refs are deliberately "unscanned" in the runtime and therefore cannot
    // support an exact/protected retention claim.
    if (
      option.secretScanStatus !== "clean" ||
      option.redactionCount !== 0
    ) {
      return false;
    }
  }
  if (option.action === "EXTERNALIZE" && atom.archiveRef === undefined) {
    return false;
  }
  return true;
}

function isArchiveTrustBlocked(
  atom: MemoryAtom,
  option: RetentionOption,
): boolean {
  return (
    option.action === "EXTERNALIZE" &&
    (atom.protected || atom.exact) &&
    option.reversible &&
    option.preservesExactContent &&
    (
      atom.archiveRef === undefined ||
      option.secretScanStatus !== "clean" ||
      option.redactionCount !== 0
    )
  );
}

function prepareCandidates(candidates: readonly AtomCandidate[]): {
  readonly candidates: readonly PreparedCandidate[];
  readonly discardedUnsafeOptions: number;
} {
  const seenIds = new Set<string>();
  let discardedUnsafeOptions = 0;

  const prepared = candidates.map((candidate): PreparedCandidate => {
    validateAtom(candidate.atom);
    if (seenIds.has(candidate.atom.id)) {
      throw new RangeError(`duplicate atom id: ${candidate.atom.id}`);
    }
    seenIds.add(candidate.atom.id);

    if (candidate.options.length === 0) {
      throw new RangeError(`atom ${candidate.atom.id} must have retention options`);
    }
    const seenActions = new Set<MemoryAction>();
    for (const option of candidate.options) {
      validateOption(candidate.atom.id, option);
      if (seenActions.has(option.action)) {
        throw new RangeError(
          `atom ${candidate.atom.id} has duplicate ${option.action} options`,
        );
      }
      seenActions.add(option.action);
    }

    const keep = candidate.options.find((option) => option.action === "KEEP");
    if (keep === undefined || !isSafeOption(candidate.atom, keep)) {
      throw new RangeError(
        `atom ${candidate.atom.id} requires a reversible, exact-preserving, zero-risk KEEP option`,
      );
    }

    const archiveTrustBlocked = candidate.options.some((option) =>
      isArchiveTrustBlocked(candidate.atom, option),
    );
    const safeOptions = candidate.options.filter((option) => {
      const safe = isSafeOption(candidate.atom, option);
      if (!safe) {
        discardedUnsafeOptions += 1;
      }
      return safe;
    });

    return { atom: candidate.atom, safeOptions, keep, archiveTrustBlocked };
  });

  prepared.sort((left, right) => {
    if (left.atom.protected !== right.atom.protected) {
      return left.atom.protected ? -1 : 1;
    }
    return left.atom.id.localeCompare(right.atom.id);
  });
  return { candidates: prepared, discardedUnsafeOptions };
}

function stateSignature(state: State): string {
  return state.options.map((option) => `${actionRank(option.action)}`).join("");
}

/** Positive means left is preferred. */
function compareStates(left: State, right: State): number {
  if (Math.abs(left.utility - right.utility) > EPSILON) {
    return left.utility > right.utility ? 1 : -1;
  }
  if (Math.abs(left.risk - right.risk) > EPSILON) {
    return left.risk < right.risk ? 1 : -1;
  }
  if (left.tokens !== right.tokens) {
    return left.tokens < right.tokens ? 1 : -1;
  }
  return stateSignature(left).localeCompare(stateSignature(right)) <= 0 ? 1 : -1;
}

function dominates(left: State, right: State): boolean {
  const noMoreTokens = left.tokens <= right.tokens;
  const noMoreRisk = left.risk <= right.risk + EPSILON;
  const noLessUtility = left.utility + EPSILON >= right.utility;
  const strict =
    left.tokens < right.tokens ||
    left.risk + EPSILON < right.risk ||
    left.utility > right.utility + EPSILON;
  return noMoreTokens && noMoreRisk && noLessUtility && strict;
}

function pruneDominated(states: readonly State[]): readonly State[] {
  const sorted = [...states].sort((left, right) =>
    stateSignature(left).localeCompare(stateSignature(right)),
  );
  const frontier: State[] = [];

  for (const candidate of sorted) {
    let rejected = false;
    for (let index = frontier.length - 1; index >= 0; index -= 1) {
      const existing = frontier[index];
      if (existing === undefined) {
        continue;
      }
      if (dominates(existing, candidate)) {
        rejected = true;
        break;
      }
      if (
        existing.tokens === candidate.tokens &&
        Math.abs(existing.risk - candidate.risk) <= EPSILON &&
        Math.abs(existing.utility - candidate.utility) <= EPSILON
      ) {
        rejected = true;
        break;
      }
      if (dominates(candidate, existing)) {
        frontier.splice(index, 1);
      }
    }
    if (!rejected) {
      frontier.push(candidate);
    }
  }
  return frontier;
}

function exactSelect(
  candidates: readonly PreparedCandidate[],
  tokenBudget: number,
  maxTotalRisk: number,
): State | null {
  let frontier: readonly State[] = [
    { options: [], tokens: 0, utility: 0, risk: 0 },
  ];

  for (const candidate of candidates) {
    const expanded: State[] = [];
    for (const state of frontier) {
      for (const option of candidate.safeOptions) {
        const tokens = state.tokens + option.tokenCost;
        const risk = state.risk + option.riskScore;
        if (tokens > tokenBudget || risk > maxTotalRisk + EPSILON) {
          continue;
        }
        expanded.push({
          options: [...state.options, option],
          tokens,
          utility: state.utility + option.utility,
          risk,
        });
      }
    }
    if (expanded.length === 0) {
      return null;
    }
    frontier = pruneDominated(expanded);
  }

  let best = frontier[0] ?? null;
  for (const state of frontier.slice(1)) {
    if (best === null || compareStates(state, best) > 0) {
      best = state;
    }
  }
  return best;
}

function buildState(options: readonly RetentionOption[]): State {
  return options.reduce<State>(
    (state, option) => ({
      options: [...state.options, option],
      tokens: state.tokens + option.tokenCost,
      utility: state.utility + option.utility,
      risk: state.risk + option.riskScore,
    }),
    { options: [], tokens: 0, utility: 0, risk: 0 },
  );
}

function isWithinBudgets(
  state: State,
  tokenBudget: number,
  maxTotalRisk: number,
): boolean {
  return state.tokens <= tokenBudget && state.risk <= maxTotalRisk + EPSILON;
}

function chooseByPressure(
  options: readonly RetentionOption[],
  lambda: number,
  tokenBudget: number,
  maxTotalRisk: number,
): RetentionOption {
  const tokenScale = Math.max(1, tokenBudget);
  const riskScale = Math.max(EPSILON, maxTotalRisk);
  return [...options].sort((left, right) => {
    const leftPressure =
      left.tokenCost / tokenScale + lambda * (left.riskScore / riskScale);
    const rightPressure =
      right.tokenCost / tokenScale + lambda * (right.riskScore / riskScale);
    if (Math.abs(leftPressure - rightPressure) > EPSILON) {
      return leftPressure - rightPressure;
    }
    if (Math.abs(left.utility - right.utility) > EPSILON) {
      return right.utility - left.utility;
    }
    return actionRank(left.action) - actionRank(right.action);
  })[0] as RetentionOption;
}

function heuristicSelect(
  candidates: readonly PreparedCandidate[],
  tokenBudget: number,
  maxTotalRisk: number,
): State | null {
  const lambdas = [0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 64, 256];
  const baselines = lambdas.map((lambda) =>
    buildState(
      candidates.map((candidate) =>
        chooseByPressure(
          candidate.safeOptions,
          lambda,
          tokenBudget,
          maxTotalRisk,
        ),
      ),
    ),
  );
  baselines.push(buildState(candidates.map((candidate) => candidate.keep)));

  const feasibleBySignature = new Map<string, State>();
  for (const baseline of baselines) {
    if (isWithinBudgets(baseline, tokenBudget, maxTotalRisk)) {
      feasibleBySignature.set(stateSignature(baseline), baseline);
    }
  }

  let current: State | null = null;
  for (const baseline of feasibleBySignature.values()) {
    if (current === null || compareStates(baseline, current) > 0) {
      current = baseline;
    }
  }
  if (current === null) {
    return null;
  }
  let currentState: State = current;

  // Deterministic best-improvement local search from the strongest feasible
  // baseline. It never violates either budget.
  const maxIterations = Math.max(
    1,
    candidates.reduce((sum, candidate) => sum + candidate.safeOptions.length, 0) *
      2,
  );
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let next: State = currentState;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (candidate === undefined) {
        continue;
      }
      for (const option of candidate.safeOptions) {
        if (currentState.options[candidateIndex] === option) {
          continue;
        }
        const options = [...currentState.options];
        options[candidateIndex] = option;
        const trial = buildState(options);
        if (
          isWithinBudgets(trial, tokenBudget, maxTotalRisk) &&
          compareStates(trial, next) > 0
        ) {
          next = trial;
        }
      }
    }
    if (next === currentState || compareStates(next, currentState) <= 0) {
      break;
    }
    currentState = next;
  }
  return currentState;
}

function reasonCodes(
  atom: MemoryAtom,
  option: RetentionOption,
  archiveTrustBlocked: boolean,
): readonly string[] {
  if (option.action === "KEEP") {
    const trustGateReason = archiveTrustBlocked
      ? ["ARCHIVE_TRUST_GATE_KEEP"]
      : [];
    if (atom.protected) {
      return ["PROTECTED_KEEP", ...trustGateReason];
    }
    if (atom.exact) {
      return ["EXACT_KEEP", ...trustGateReason];
    }
    return ["SELECTED_KEEP", ...trustGateReason];
  }
  if (option.action === "SUMMARIZE") {
    return ["REVERSIBLE_SUMMARY"];
  }
  if (atom.protected || atom.exact) {
    return ["EXACT_REVERSIBLE_EXTERNALIZE"];
  }
  return ["REVERSIBLE_EXTERNALIZE"];
}

function decisionsFromState(
  candidates: readonly PreparedCandidate[],
  state: State,
  failClosed: boolean,
): readonly SelectionDecision[] {
  return candidates.map((candidate, index) => {
    const option = state.options[index];
    if (option === undefined) {
      throw new Error("internal selection state is incomplete");
    }
    return {
      atomId: candidate.atom.id,
      action: option.action,
      tokenCost: option.tokenCost,
      utility: option.utility,
      riskScore: option.riskScore,
      reversible: true,
      preservesExactContent: option.preservesExactContent,
      reasonCodes: failClosed
        ? [
            "FAIL_CLOSED_KEEP",
            ...(candidate.archiveTrustBlocked
              ? ["ARCHIVE_TRUST_GATE_KEEP"]
              : []),
          ]
        : reasonCodes(
            candidate.atom,
            option,
            candidate.archiveTrustBlocked,
          ),
    };
  });
}

export function selectMemoryActions(input: SelectionInput): SelectionResult {
  assertFiniteNonNegative(input.tokenBudget, "tokenBudget");
  if (!Number.isSafeInteger(input.tokenBudget)) {
    throw new RangeError("tokenBudget must be a safe integer");
  }
  const maxTotalRisk = input.maxTotalRisk ?? DEFAULT_MAX_TOTAL_RISK;
  assertFiniteNonNegative(maxTotalRisk, "maxTotalRisk");
  const exactDpAtomLimit =
    input.exactDpAtomLimit ?? DEFAULT_EXACT_DP_ATOM_LIMIT;
  const maxExactCombinations =
    input.maxExactCombinations ?? DEFAULT_MAX_EXACT_COMBINATIONS;
  if (!Number.isSafeInteger(exactDpAtomLimit) || exactDpAtomLimit < 0) {
    throw new RangeError("exactDpAtomLimit must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxExactCombinations) || maxExactCombinations < 1) {
    throw new RangeError("maxExactCombinations must be a positive safe integer");
  }

  const prepared = prepareCandidates(input.candidates);
  let combinationCount = 1;
  for (const candidate of prepared.candidates) {
    combinationCount *= candidate.safeOptions.length;
    if (combinationCount > maxExactCombinations) {
      break;
    }
  }
  const useExact =
    prepared.candidates.length <= exactDpAtomLimit &&
    combinationCount <= maxExactCombinations;
  const selected = useExact
    ? exactSelect(prepared.candidates, input.tokenBudget, maxTotalRisk)
    : heuristicSelect(prepared.candidates, input.tokenBudget, maxTotalRisk);

  if (selected !== null) {
    return {
      feasible: true,
      method: useExact ? "exact-dp" : "heuristic",
      decisions: decisionsFromState(prepared.candidates, selected, false),
      totalTokens: selected.tokens,
      totalUtility: selected.utility,
      totalRisk: selected.risk,
      tokenBudget: input.tokenBudget,
      maxTotalRisk,
      protectedAtomIds: prepared.candidates
        .filter((candidate) => candidate.atom.protected)
        .map((candidate) => candidate.atom.id),
      discardedUnsafeOptions: prepared.discardedUnsafeOptions,
      violations: [],
    };
  }

  // There is no safe selection under the declared budgets. Preserve every raw
  // atom rather than silently taking a lossy action.
  const fallback = buildState(
    prepared.candidates.map((candidate) => candidate.keep),
  );
  const violations: string[] = [];
  if (fallback.tokens > input.tokenBudget) {
    violations.push("TOKEN_BUDGET_INFEASIBLE");
  }
  if (fallback.risk > maxTotalRisk + EPSILON) {
    violations.push("RISK_BUDGET_INFEASIBLE");
  }
  if (violations.length === 0) {
    violations.push("NO_SAFE_SELECTION");
  }
  return {
    feasible: false,
    method: "fail-closed",
    decisions: decisionsFromState(prepared.candidates, fallback, true),
    totalTokens: fallback.tokens,
    totalUtility: fallback.utility,
    totalRisk: fallback.risk,
    tokenBudget: input.tokenBudget,
    maxTotalRisk,
    protectedAtomIds: prepared.candidates
      .filter((candidate) => candidate.atom.protected)
      .map((candidate) => candidate.atom.id),
    discardedUnsafeOptions: prepared.discardedUnsafeOptions,
    violations,
  };
}
