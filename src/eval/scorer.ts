import type {
  HiddenOracle,
  OracleCheck,
  PolicyAggregate,
  PolicyName,
  PolicyRun,
  ScoredPolicyRun,
} from "./schema.js";

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 1;
  }
  return Number((numerator / denominator).toFixed(6));
}

export function scorePolicyRun(
  run: PolicyRun,
  oracle: HiddenOracle,
): ScoredPolicyRun {
  const useOutcomes = new Map(
    run.factUses.map((outcome) => [
      `${outcome.turnId}:${outcome.factId}`,
      outcome,
    ]),
  );
  const factMetadata = new Map(
    run.factUses.map((outcome) => [outcome.factId, outcome]),
  );
  const oracleChecks: OracleCheck[] = oracle.requiredUses.map((required) => {
    const outcome = useOutcomes.get(`${required.turnId}:${required.factId}`);
    const exactRequirementPassed =
      !required.requireExact || outcome?.exactPreserved === true;
    return {
      id: required.factId,
      turnId: required.turnId,
      pass:
        outcome?.available === true &&
        outcome.semanticIntegrity &&
        outcome.actualValue === required.expectedValue &&
        exactRequirementPassed,
      expected: required.expectedValue,
      actual: outcome?.actualValue ?? null,
      exactPreserved: outcome?.exactPreserved ?? false,
      protected:
        outcome?.protected ?? factMetadata.get(required.factId)?.protected ?? false,
    };
  });

  const forbiddenChangeChecksPassed = oracle.forbiddenChanges.every(
    (target) => !run.forbiddenChanges.includes(target),
  );
  const turnCountPassed = run.turnsProcessed === oracle.expectedTurnCount;
  const verifiedSuccess =
    turnCountPassed &&
    forbiddenChangeChecksPassed &&
    oracleChecks.every((check) => check.pass);

  const protectedChecks = oracleChecks.filter((check) => check.protected);
  const exactChecks = oracle.requiredUses.filter((required) => required.requireExact);
  const exactPassed = oracleChecks.filter(
    (check) =>
      exactChecks.some(
        (required) =>
          required.factId === check.id && required.turnId === check.turnId,
      ) && check.pass,
  );

  return {
    ...run,
    verifiedSuccess,
    oracleChecks,
    forbiddenChangeChecksPassed,
    criticalRetentionRate: ratio(
      protectedChecks.filter((check) => check.pass).length,
      protectedChecks.length,
    ),
    exactRetentionRate: ratio(exactPassed.length, exactChecks.length),
    cacheHitRate: ratio(
      run.usage.cachedInputTokens,
      run.usage.cachedInputTokens + run.usage.uncachedInputTokens,
    ),
    compressionRatio: ratio(
      Math.max(0, run.uncompressedContextTokens - run.finalActiveTokens),
      run.uncompressedContextTokens,
    ),
    simulatedEvaluationSteps:
      run.turnsProcessed + run.compactions.length + run.rehydrations,
  };
}

/**
 * Falsifying control used only by the evaluator: corrupt the first protected
 * fact at the exact late-use boundary the hidden oracle checks. This does not
 * add a destructive action to the product policy surface.
 */
export function corruptProtectedRequiredUse(
  run: PolicyRun,
  oracle: HiddenOracle,
): PolicyRun {
  const target = oracle.requiredUses.find((required) =>
    run.factUses.some(
      (outcome) =>
        outcome.turnId === required.turnId &&
        outcome.factId === required.factId &&
        outcome.protected,
    ),
  );
  if (target === undefined) {
    throw new Error(`No protected required use in ${oracle.fixtureId}`);
  }

  return {
    ...run,
    factUses: run.factUses.map((outcome) =>
      outcome.turnId === target.turnId && outcome.factId === target.factId
        ? {
            ...outcome,
            available: false,
            actualValue: null,
            exactPreserved: false,
            semanticIntegrity: false,
            failureReason: "LOSS_INJECTED_FOR_NEGATIVE_CONTROL",
          }
        : outcome,
    ),
  };
}

export function aggregatePolicyRuns(
  runs: readonly ScoredPolicyRun[],
): PolicyAggregate[] {
  const names: PolicyName[] = ["M_MANUAL", "F_FIXED", "A_ADAPTIVE"];
  return names.map((policy) => {
    const policyRuns = runs.filter((run) => run.policy === policy);
    const totalUsageProxy = Number(
      policyRuns
        .reduce((sum, run) => sum + run.usage.usageProxy, 0)
        .toFixed(6),
    );
    const verifiedSuccesses = policyRuns.filter(
      (run) => run.verifiedSuccess,
    ).length;
    const inputTokens = policyRuns.reduce(
      (sum, run) =>
        sum + run.usage.cachedInputTokens + run.usage.uncachedInputTokens,
      0,
    );
    const cachedTokens = policyRuns.reduce(
      (sum, run) => sum + run.usage.cachedInputTokens,
      0,
    );
    return {
      policy,
      totalUsageProxy,
      verifiedSuccesses,
      upvs:
        verifiedSuccesses === 0
          ? "Infinity"
          : Number((totalUsageProxy / verifiedSuccesses).toFixed(6)),
      successRate: ratio(verifiedSuccesses, policyRuns.length),
      criticalRetentionRate: ratio(
        policyRuns.reduce(
          (sum, run) => sum + run.criticalRetentionRate,
          0,
        ),
        policyRuns.length,
      ),
      exactRetentionRate: ratio(
        policyRuns.reduce((sum, run) => sum + run.exactRetentionRate, 0),
        policyRuns.length,
      ),
      cacheHitRate: ratio(cachedTokens, inputTokens),
      compactions: policyRuns.reduce(
        (sum, run) => sum + run.compactions.length,
        0,
      ),
      rehydrations: policyRuns.reduce(
        (sum, run) => sum + run.rehydrations,
        0,
      ),
      manualInterventions: policyRuns.reduce(
        (sum, run) => sum + run.manualInterventions,
        0,
      ),
    };
  });
}
