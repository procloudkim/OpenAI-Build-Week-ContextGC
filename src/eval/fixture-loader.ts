import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./canonical.js";
import {
  benchmarkFixtureSchema,
  hiddenOracleSchema,
  type BenchmarkFixture,
  type HiddenOracle,
  type LoadedFixture,
} from "./schema.js";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function assertFixtureIntegrity(
  fixture: BenchmarkFixture,
  oracle: HiddenOracle,
): void {
  if (oracle.fixtureId !== fixture.id) {
    throw new Error(
      `Oracle fixtureId ${oracle.fixtureId} does not match ${fixture.id}`,
    );
  }
  if (oracle.expectedTurnCount !== fixture.turns.length) {
    throw new Error(`Oracle turn count does not match ${fixture.id}`);
  }

  const turnIds = new Set(fixture.turns.map((turn) => turn.id));
  if (turnIds.size !== fixture.turns.length) {
    throw new Error(`Fixture ${fixture.id} contains duplicate turn IDs`);
  }
  for (const manualTurn of fixture.manualCheckpointTurns) {
    if (!turnIds.has(manualTurn)) {
      throw new Error(`Unknown manual checkpoint turn ${manualTurn}`);
    }
  }

  const introduced = new Map<string, number>();
  const facts = new Map<string, BenchmarkFixture["turns"][number]["facts"][number]>();
  fixture.turns.forEach((turn, turnIndex) => {
    for (const fact of turn.facts) {
      if (introduced.has(fact.id)) {
        throw new Error(`Fixture ${fixture.id} repeats fact ${fact.id}`);
      }
      introduced.set(fact.id, turnIndex);
      facts.set(fact.id, fact);
    }
    for (const used of turn.usesFacts) {
      const introductionIndex = introduced.get(used);
      if (introductionIndex === undefined || introductionIndex >= turnIndex) {
        throw new Error(`Fixture ${fixture.id} uses ${used} before introduction`);
      }
    }
    for (const proposed of turn.proposedChanges) {
      if (!introduced.has(proposed.guardFactId)) {
        throw new Error(
          `Fixture ${fixture.id} change guard ${proposed.guardFactId} is unknown`,
        );
      }
    }
  });

  for (const required of oracle.requiredFacts) {
    if (!introduced.has(required.id)) {
      throw new Error(`Oracle requires unknown fact ${required.id}`);
    }
  }
  for (const requiredUse of oracle.requiredUses) {
    const turn = fixture.turns.find((candidate) => candidate.id === requiredUse.turnId);
    const fact = facts.get(requiredUse.factId);
    if (turn === undefined || !turn.usesFacts.includes(requiredUse.factId)) {
      throw new Error(
        `Oracle requires ${requiredUse.factId} at unobserved turn ${requiredUse.turnId}`,
      );
    }
    if (fact === undefined || fact.value !== requiredUse.expectedValue) {
      throw new Error(`Oracle use value does not match fact ${requiredUse.factId}`);
    }
    if (requiredUse.requireExact && !fact.exact) {
      throw new Error(`Oracle marks non-exact fact ${requiredUse.factId} as exact`);
    }
  }
}

export async function loadBenchmarkFixtures(
  fixturesDir = path.resolve("fixtures"),
): Promise<LoadedFixture[]> {
  const fixtureFiles = (await readdir(fixturesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  if (fixtureFiles.length === 0) {
    throw new Error(`No benchmark fixtures found in ${fixturesDir}`);
  }

  const loaded: LoadedFixture[] = [];
  for (const fixtureFile of fixtureFiles) {
    const fixtureValue = await readJson(path.join(fixturesDir, fixtureFile));
    const fixture = benchmarkFixtureSchema.parse(fixtureValue);
    const oracleValue = await readJson(
      path.join(fixturesDir, "oracles", `${fixture.id}.oracle.json`),
    );
    const oracle = hiddenOracleSchema.parse(oracleValue);
    assertFixtureIntegrity(fixture, oracle);
    loaded.push({
      fixture,
      fixtureHash: sha256(fixture),
      oracle,
      oracleHash: sha256(oracle),
    });
  }

  return loaded;
}
