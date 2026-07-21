import assert from "node:assert/strict";
import test from "node:test";

import { loadBenchmarkFixtures } from "../src/eval/fixture-loader.js";

test("fixtures are frozen, bounded, and require early facts late", async () => {
  const loaded = await loadBenchmarkFixtures();
  assert.deepEqual(
    loaded.map((entry) => entry.fixture.id),
    [
      "exact-config-migration",
      "interrupted-refactor",
      "noisy-incident-debug",
    ],
  );

  for (const entry of loaded) {
    const { fixture, oracle } = entry;
    assert.equal(fixture.synthetic, true);
    assert.ok(fixture.turns.length >= 10 && fixture.turns.length <= 12);
    assert.equal(oracle.expectedTurnCount, fixture.turns.length);
    assert.match(entry.fixtureHash, /^[a-f0-9]{64}$/);
    assert.match(entry.oracleHash, /^[a-f0-9]{64}$/);
    assert.equal("oracle" in fixture, false);

    const introduction = new Map<string, number>();
    fixture.turns.forEach((turn, index) => {
      for (const fact of turn.facts) {
        introduction.set(fact.id, index);
      }
    });
    const lateUsesOfEarlyFacts = fixture.turns.flatMap((turn, useIndex) =>
      turn.usesFacts.filter((factId) => {
        const introducedAt = introduction.get(factId);
        return introducedAt !== undefined && useIndex - introducedAt >= 5;
      }),
    );
    assert.ok(
      lateUsesOfEarlyFacts.length > 0,
      `${fixture.id} must use an early fact at least five turns later`,
    );

    const factById = new Map(
      fixture.turns.flatMap((turn) => turn.facts).map((fact) => [fact.id, fact]),
    );
    const protectedOracleFacts = oracle.requiredFacts.filter(
      (required) => factById.get(required.id)?.protected,
    );
    assert.ok(protectedOracleFacts.length > 0);

    const proposedTargets = new Set(
      fixture.turns.flatMap((turn) =>
        turn.proposedChanges.map((change) => change.target),
      ),
    );
    for (const forbidden of oracle.forbiddenChanges) {
      assert.ok(proposedTargets.has(forbidden));
    }

    for (const requiredUse of oracle.requiredUses) {
      const useTurnIndex = fixture.turns.findIndex(
        (turn) => turn.id === requiredUse.turnId,
      );
      const introductionIndex = introduction.get(requiredUse.factId);
      assert.notEqual(introductionIndex, undefined);
      assert.ok(useTurnIndex > (introductionIndex ?? useTurnIndex));
      assert.ok(
        fixture.turns[useTurnIndex]?.usesFacts.includes(requiredUse.factId),
      );
    }
  }
});
