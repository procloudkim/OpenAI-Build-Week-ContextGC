import assert from "node:assert/strict";
import test from "node:test";

import {
  selectMemoryActions,
  type MemoryAtom,
  type RetentionOption,
} from "../src/core/index.js";

function atom(
  id: string,
  overrides: Partial<MemoryAtom> = {},
): MemoryAtom {
  return {
    id,
    kind: "evidence",
    sourceRef: `ledger:${id}`,
    contentHash: `sha256:${id}`,
    archiveRef: `sha256:${"a".repeat(64)}`,
    protected: false,
    exact: false,
    tokenEstimate: 10,
    lifecyclePhase: "implement",
    lastUsedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function keep(tokenCost: number, utility: number): RetentionOption {
  return {
    action: "KEEP",
    tokenCost,
    utility,
    riskScore: 0,
    reversible: true,
    preservesExactContent: true,
  };
}

function externalize(
  tokenCost: number,
  utility: number,
  riskScore = 0.01,
  overrides: Partial<RetentionOption> = {},
): RetentionOption {
  return {
    action: "EXTERNALIZE",
    tokenCost,
    utility,
    riskScore,
    reversible: true,
    preservesExactContent: true,
    ...overrides,
  };
}

function summarize(
  tokenCost: number,
  utility: number,
  riskScore = 0.05,
): RetentionOption {
  return {
    action: "SUMMARIZE",
    tokenCost,
    utility,
    riskScore,
    reversible: true,
    preservesExactContent: false,
  };
}

test("exact Pareto DP finds the best feasible multiple-choice allocation", () => {
  const result = selectMemoryActions({
    tokenBudget: 5,
    maxTotalRisk: 1,
    candidates: [
      {
        atom: atom("a"),
        options: [keep(5, 10), externalize(1, 0)],
      },
      {
        atom: atom("b"),
        options: [keep(4, 9), externalize(1, 0)],
      },
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.method, "exact-dp");
  assert.equal(result.totalTokens, 5);
  assert.equal(result.totalUtility, 9);
  assert.deepEqual(
    result.decisions.map(({ atomId, action }) => ({ atomId, action })),
    [
      { atomId: "a", action: "EXTERNALIZE" },
      { atomId: "b", action: "KEEP" },
    ],
  );
});

test("protected and exact atoms cannot be summarized or non-exactly externalized", () => {
  const result = selectMemoryActions({
    tokenBudget: 3,
    candidates: [
      {
        atom: atom("critical", { protected: true, exact: true }),
        options: [
          keep(10, 10),
          summarize(1, 100),
          externalize(3, 8, 0, {
            preservesExactContent: true,
            redactionCount: 0,
            secretScanStatus: "clean",
          }),
        ],
      },
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.decisions[0]?.action, "EXTERNALIZE");
  assert.deepEqual(result.decisions[0]?.reasonCodes, [
    "EXACT_REVERSIBLE_EXTERNALIZE",
  ]);
  assert.equal(result.discardedUnsafeOptions, 1);
  assert.deepEqual(result.protectedAtomIds, ["critical"]);
});

test("redacted archive cannot satisfy protected exact externalization", () => {
  const result = selectMemoryActions({
    tokenBudget: 10,
    candidates: [
      {
        atom: atom("secret", { protected: true, exact: true }),
        options: [
          keep(10, 5),
          externalize(1, 100, 0, {
            preservesExactContent: true,
            redactionCount: 1,
            secretScanStatus: "sanitized",
          }),
        ],
      },
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.decisions[0]?.action, "KEEP");
  assert.deepEqual(result.decisions[0]?.reasonCodes, [
    "PROTECTED_KEEP",
    "ARCHIVE_TRUST_GATE_KEEP",
  ]);
  assert.equal(result.discardedUnsafeOptions, 1);
});

test("unscanned or unknown archive trust cannot satisfy protected exact externalization", () => {
  for (const secretScanStatus of ["unscanned", undefined] as const) {
    const externalizeOverrides: Partial<RetentionOption> = {
      redactionCount: 0,
      ...(secretScanStatus === undefined ? {} : { secretScanStatus }),
    };
    const result = selectMemoryActions({
      tokenBudget: 10,
      candidates: [
        {
          atom: atom("binary", { protected: true, exact: true }),
          options: [
            keep(10, 5),
            externalize(1, 100, 0, externalizeOverrides),
          ],
        },
      ],
    });

    assert.equal(result.feasible, true);
    assert.equal(result.decisions[0]?.action, "KEEP");
    assert.deepEqual(result.decisions[0]?.reasonCodes, [
      "PROTECTED_KEEP",
      "ARCHIVE_TRUST_GATE_KEEP",
    ]);
    assert.equal(result.discardedUnsafeOptions, 1);
  }
});

test("externalization without a content-addressed archive reference is discarded", () => {
  const missingRefAtom = { ...atom("missing-ref", { protected: true, exact: true }) };
  delete missingRefAtom.archiveRef;
  const result = selectMemoryActions({
    tokenBudget: 10,
    candidates: [{
      atom: missingRefAtom,
      options: [
        keep(10, 5),
        externalize(1, 100, 0, {
          redactionCount: 0,
          secretScanStatus: "clean",
        }),
      ],
    }],
  });

  assert.equal(result.decisions[0]?.action, "KEEP");
  assert.deepEqual(result.decisions[0]?.reasonCodes, [
    "PROTECTED_KEEP",
    "ARCHIVE_TRUST_GATE_KEEP",
  ]);
  assert.equal(result.discardedUnsafeOptions, 1);
});

test("risk budget participates in exact selection", () => {
  const result = selectMemoryActions({
    tokenBudget: 20,
    maxTotalRisk: 0.1,
    candidates: [
      {
        atom: atom("risk"),
        options: [keep(20, 1), summarize(2, 100, 0.5), externalize(3, 8, 0.1)],
      },
    ],
  });

  assert.equal(result.decisions[0]?.action, "EXTERNALIZE");
  assert.equal(result.totalRisk, 0.1);
});

test("infeasible budget fails closed to KEEP without deleting information", () => {
  const result = selectMemoryActions({
    tokenBudget: 1,
    candidates: [
      {
        atom: atom("critical", { protected: true, exact: true }),
        options: [
          keep(10, 10),
          summarize(1, 100),
          externalize(1, 100, 0, { reversible: false }),
        ],
      },
    ],
  });

  assert.equal(result.feasible, false);
  assert.equal(result.method, "fail-closed");
  assert.equal(result.decisions[0]?.action, "KEEP");
  assert.deepEqual(result.decisions[0]?.reasonCodes, ["FAIL_CLOSED_KEEP"]);
  assert.deepEqual(result.violations, ["TOKEN_BUDGET_INFEASIBLE"]);
});

test("large-N heuristic is deterministic and stays inside both budgets", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    atom: atom(`atom-${String(index).padStart(2, "0")}`),
    options: [keep(10, 10), externalize(2, 4, 0.01), summarize(1, 3, 0.02)],
  }));
  const input = {
    candidates,
    tokenBudget: 100,
    maxTotalRisk: 0.4,
    exactDpAtomLimit: 10,
  } as const;
  const first = selectMemoryActions(input);
  const second = selectMemoryActions({
    ...input,
    candidates: [...candidates].reverse(),
  });

  assert.equal(first.method, "heuristic");
  assert.equal(first.feasible, true);
  assert.ok(first.totalTokens <= 100);
  assert.ok(first.totalRisk <= 0.4);
  assert.deepEqual(first.decisions, second.decisions);
});

test("unsupported DROP-like runtime input is rejected", () => {
  assert.throws(
    () =>
      selectMemoryActions({
        tokenBudget: 10,
        candidates: [
          {
            atom: atom("bad"),
            options: [
              keep(10, 1),
              {
                action: "DROP",
                tokenCost: 0,
                utility: 100,
                riskScore: 0,
                reversible: true,
                preservesExactContent: true,
              } as unknown as RetentionOption,
            ],
          },
        ],
      }),
    /unsupported retention action/,
  );
});

test("duplicate atoms and unsafe KEEP contracts are rejected", () => {
  assert.throws(
    () =>
      selectMemoryActions({
        tokenBudget: 20,
        candidates: [
          { atom: atom("same"), options: [keep(5, 1)] },
          { atom: atom("same"), options: [keep(5, 1)] },
        ],
      }),
    /duplicate atom id/,
  );
  assert.throws(
    () =>
      selectMemoryActions({
        tokenBudget: 20,
        candidates: [
          {
            atom: atom("unsafe"),
            options: [
              {
                ...keep(5, 1),
                riskScore: 0.1,
              },
            ],
          },
        ],
      }),
    /requires a reversible, exact-preserving, zero-risk KEEP option/,
  );
});
