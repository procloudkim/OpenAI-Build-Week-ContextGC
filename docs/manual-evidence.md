# Documentation evidence ledger

This ledger governs versioned, current, empirical, and interpretive claims in
the ContextGC user and developer documentation. It is not a replacement for the
research claim ledger.

| Claim ID | Claim | Type | Source | Verified | Method | Confidence | Update trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOC-001 | Codex supports repository/local plugin marketplaces through `codex plugin marketplace add` and plugin installation through `codex plugin add`. | versioned | [Build plugins](https://learn.chatgpt.com/docs/build-plugins) and local `--help` output | 2026-07-18 | Fresh Codex manual plus local CLI | High | Codex plugin CLI or marketplace format changes |
| DOC-002 | A repository marketplace may live at `.agents/plugins/marketplace.json`, with plugin paths resolved relative to the marketplace root. | versioned | [Build plugins](https://learn.chatgpt.com/docs/build-plugins#build-your-own-curated-plugin-list) and checked-in marketplace | 2026-07-18 | Fresh Codex manual and file inspection | High | Marketplace specification changes |
| DOC-003 | Installed plugin bytes are loaded from a versioned Codex cache, so changed bytes require reinstall/discovery evidence and should use a new version. | versioned | Fresh Codex manual, local cache parity check, `docs/plugin-install.md` | 2026-07-18 | Manual retrieval and SHA-256 comparison | High | Codex installation lifecycle changes |
| DOC-004 | Plugin-bundled hooks require review/trust and project-local hook behavior depends on the active trusted configuration layer. | versioned | [Codex hooks](https://learn.chatgpt.com/docs/hooks) and fresh Codex manual | 2026-07-18 | Manual retrieval plus local lifecycle tests | High | Hook trust UI or configuration changes |
| DOC-005 | ContextGC `0.1.8` requires Node.js 22.13 or newer and exposes six MCP tools. | versioned | `package.json`, `.codex-plugin/plugin.json`, `src/mcp/server.ts` | 2026-07-21 | Source inspection, skill validator, MCP bundle smoke | High | Runtime floor or tool contract changes |
| DOC-006 | ContextGC does not invoke native compaction and does not provide a deterministic token-to-Codex-credit conversion. | current/interpretive | `src/mcp/server.ts`, `README.md`, [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction) | 2026-07-18 | Source inspection and official documentation review | High | OpenAI publishes a supported actuation or credit API |
| DOC-007 | The frozen benchmark receipt is deterministic for the checked-in fixtures and reports 3/3 verified tasks for each policy. | empirical | `output/benchmark/benchmark-report.json` | 2026-07-18 | Clean-checkout `npm run verify` and negative-control tests | High for fixtures only | Fixtures, scorer, policy, weights, or runtime changes |
| DOC-008 | The current benchmark does not pass the project's 15%-versus-both economics promotion gate. | empirical | `README.md`, `research/contextgc-decision-brief.md`, benchmark receipt | 2026-07-18 | Aggregate comparison | High for fixtures only | Benchmark receipt or promotion rule changes |
| DOC-009 | GitHub Actions `checkout` and `setup-node` major version 7 were current for the workflow at authoring time. | current | Official `actions/checkout` and `actions/setup-node` GitHub release APIs | 2026-07-18 | `gh api repos/actions/.../releases/latest` | High | Action release or Node runner support changes |
| DOC-010 | Normal installed-plugin MCP calls may omit `dataDir`; successful model-visible results use an opaque 16-hex `storeId` and do not return the absolute root. | versioned/security | `src/mcp/server.ts`, `src/runtime/paths.ts`, MCP tests | 2026-07-19 | Source inspection and focused tests | High | Store resolution or result schema changes |
| DOC-011 | Persisted Task Frames use a closed schema, reject unsafe local paths, and apply deterministic credential/email/international-or-grouped-phone/home-path minimization that is not comprehensive PII detection. | versioned/security | `src/runtime/checkpoints.ts`, `src/runtime/redaction.ts`, runtime and MCP tests | 2026-07-19 | Source inspection and negative tests | High | Frame schema or redaction rules change |
| DOC-012 | Empty-store bootstrap defers in Plan mode and automatic PreCompact remains fail-closed until checkpoint, snapshot, and hook-state persistence verify. | versioned/security | `hooks/run-hook.mjs`, hook child-process tests | 2026-07-19 | Source inspection and focused lifecycle tests | High | Hook lifecycle or permission-mode handling changes |
| DOC-013 | Checkpoints without the `deterministic-minimization-v1` marker are not hook-injected or linked as verified successor parents. | versioned/security | `src/runtime/checkpoints.ts`, `hooks/run-hook.mjs`, runtime and hook tests | 2026-07-19 | Source inspection and legacy-upgrade tests | High | Checkpoint privacy marker or migration behavior changes |
| DOC-014 | A malformed pointer, invalid target, or mismatched Task Frame mirror is reported as invalid and does not block an explicitly named verified restore or a new strict checkpoint; mirror rollback prevents split publication. | versioned/security | `src/runtime/checkpoints.ts`, `src/runtime/runtime.ts`, MCP and runtime tests | 2026-07-19 | Real-runtime malformed/corrupt-target and publication-failure tests | High | Latest-pointer, mirror, or restore semantics change |
| DOC-015 | Transcript session IDs are hashed before ledger persistence, and explicit local `file:`/`file%3A` URIs are redacted in full while HTTP(S) route negative controls remain unchanged. | versioned/security | `src/runtime/runtime.ts`, `src/runtime/redaction.ts`, runtime tests | 2026-07-19 | Persistence corpus and normalization-variant redaction tests | High | Telemetry or redaction rules change |
| DOC-016 | EXTERNALIZE without a syntactically content-addressed `archiveRef` is discarded, while plan reference and scan metadata remain caller-asserted until independently matched to a runtime ContentRef. | versioned/security | `src/core/selection.ts`, `src/mcp/server.ts`, selection and MCP tests | 2026-07-19 | Source inspection and missing-reference negative test | High | Plan assurance or runtime-ref verification changes |
| DOC-017 | In ContextGC `0.1.8`, healthy prompt, tool, and Stop hooks are user-silent; Stop never creates a model continuation, freshness alone cannot block automatic compaction, and every user-visible hook notice is limited to three lines and 240 characters. | versioned/UX | `hooks/run-hook.mjs`, `hooks/hooks.json`, `tests/hooks.test.ts` | 2026-07-21 | Focused lifecycle regression tests plus installed-cache parity | High | Hook output contract or CLI rendering changes |

## Runnable example receipts

| Artifact | Purpose | Expected observable | Verification path |
| --- | --- | --- | --- |
| `node scripts/contextgc.bundle.mjs --version` | Confirm bundled CLI version | `0.1.8` | CLI test and bundle smoke |
| `node scripts/contextgc.bundle.mjs simulate` | Replay frozen fixtures without installing the plugin | Receipt hash `f769982...47ddd` | `output/benchmark/benchmark-report.json` |
| `npm run verify` | Exercise release gate | Full Node suite, bundle smoke, site build, and rendered tests pass | Local and clean-checkout logs |
| `codex debug prompt-input "Use ContextGC to inspect context health."` | Check model-visible skill discovery | Output contains `context-gc` and `ContextGC` | Fresh-process local receipt |

## Unresolved or intentionally bounded claims

- Live native-compaction quality and three independent trusted-hook production
  runs are not established. One owner-observed end-to-end lifecycle acceptance
  run is recorded below; it is not a production benchmark.
- ChatGPT/Codex credit savings are not established.
- Generalization beyond the three frozen synthetic traces is not established.
- GitHub visibility and CI are external state. Recheck the repository metadata
  and latest required workflow immediately before merge or public submission.

## Sanitized owner-observed lifecycle acceptance

Evidence date: 2026-07-21 KST. This section records only bounded observables.
Raw session, checkpoint, store, account, and local-path values are intentionally
excluded.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Hook trust | PASS | All six ContextGC lifecycle events were reviewed and active in a fresh Codex thread |
| Focused hook regression | PASS | TypeScript build and 13/13 focused hook tests passed; the first sandbox run hit child-process `EPERM`, and the permitted rerun passed |
| Native lifecycle | PASS | The user observed the real `Context Compacted` completion with trusted PreCompact and PostCompact hooks active |
| Checkpoint integrity | PASS | The installed private-store status reported one latest verified checkpoint |
| Fresh-thread recovery | PASS | A separate new thread received the protected Task Frame through SessionStart and matched the current checkpoint/store correlation |
| Local-path privacy | PASS | The final read-only acceptance report contained no absolute local path |
| Archive rehydration | NOT TESTED MANUALLY | The injected frame had repository-relative evidence pointers but no evidence ContentRef; no synthetic mutation was introduced solely to force this path. Automated archive/rehydration tests remain the evidence |
| Live usage savings | UNAVAILABLE | Installed status reported `usageProxy: null`; the hook surface did not provide a complete authoritative before/after token receipt |

No prohibited operation, repository mutation, deletion, restore, or additional
checkpoint was performed during the final read-only recovery check.
