# ContextGC developer guide

## Reader contract

- **Target reader:** a maintainer changing the ContextGC TypeScript core,
  runtime, Codex plugin, evaluation harness, or demo site.
- **Job to be done:** make a scoped change and produce evidence that the source,
  staged plugin, deterministic receipts, and site still agree.
- **Prerequisites:** Windows PowerShell, Git, Node.js 22.13 or newer, npm, and a
  clone of this repository. Codex CLI is needed only for install/discovery
  checks.
- **Scope boundary:** this guide covers repository development and release
  evidence. It does not document native Codex compaction internals or a
  token-to-Codex-credit conversion.
- **Done when:** the relevant focused tests and the full verification path pass,
  generated artifacts are synchronized, and the resulting diff contains only
  the intended change.
- **Freshness date:** 2026-07-19.

## Set up a development checkout

Purpose: install both dependency trees without running package lifecycle
scripts.

```powershell
git clone https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git
Set-Location context-gc
npm ci --ignore-scripts
npm --prefix site ci --ignore-scripts
```

Expected observable: both commands finish with `found 0 vulnerabilities` for
the lockfile state verified for release `0.1.5`. Treat a later audit result as a
new finding rather than preserving this sentence indefinitely.

Failure boundary: network access is required for the initial public clone and
dependency installation. Node versions below the package engine floor are
unsupported.

Cleanup: dependency folders are ignored by Git. Remove only the exact checkout
or dependency directory you intend to discard.

## Repository map

| Path | Responsibility | Primary verification |
| --- | --- | --- |
| `src/core/` | Pure retention types, selection, trigger, and usage accounting | Core unit tests |
| `src/runtime/` | Archive, checkpoints, rehydration, ledger, redaction, telemetry | Runtime tests |
| `src/mcp/` | Six bounded ContextGC MCP tools | MCP tests and bundle smoke |
| `src/cli/` | Deterministic local CLI and accounting boundary | CLI tests and bundle smoke |
| `hooks/` | Codex lifecycle integration and integrity gates | Child-process hook tests |
| `skills/context-gc/` | Model-facing workflow instructions | Skill validator and prompt-input check |
| `plugins/context-gc/` | Generated installable plugin staging tree | Plugin validator and source/stage parity |
| `fixtures/`, `src/eval/` | Frozen traces, hidden oracles, policy replay | Benchmark tests and receipt hash |
| `site/` | Sanitized judge-facing evidence viewer | Lint, build, rendered-HTML tests |
| `research/` | Claim ledger and decision reports | JSON/link/proofing checks |
| `submission/` | Devpost and judge handoff material | Evidence checklist |

The canonical implementation lives outside `plugins/context-gc/`. Run the
staging command instead of editing generated plugin files directly.

## Verification ladder

Use the smallest command that can falsify the change, then run the full gate
before publishing.

| Command | Use it for | Expected observable |
| --- | --- | --- |
| `npm run build` | TypeScript-only change | TypeScript exits successfully |
| `npm run check` | Core, runtime, CLI, MCP, hooks | All Node tests pass |
| `npm run benchmark` | Evaluator, fixtures, policy, receipts | Receipt hash is printed and site receipts synchronize |
| `npm run stage:plugin` | Skill, hook, MCP, CLI, or manifest change | `plugins/context-gc` is regenerated |
| `npm run smoke:bundles` | No-build CLI/MCP distribution | CLI and MCP bundle report `pass` |
| `npm --prefix site test` | Demo UI or receipt presentation | Site builds and rendered tests pass |
| `npm run verify` | Release or pull request | Every preceding release gate passes |

The release receipt currently expected from unchanged fixtures is:

```text
f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd
```

If an intentional evaluation change alters this hash, inspect the complete
policy diff and negative controls before updating documentation. A new hash is
not evidence of an improvement by itself.

## Change contracts

### Core or optimizer change

1. Add the smallest failing unit test.
2. Preserve the absence of `DROP` from runtime actions.
3. Keep protected/exact information fail-closed.
4. Run `npm run check` and `npm run benchmark`.
5. Explain any receipt change using the defined UPVS components.

### Runtime or storage change

1. Preserve content-hash verification on read, rehydrate, and restore.
2. Keep secret scan status explicit: `clean`, `sanitized`, or `unscanned`.
3. Treat sanitized content as intentionally non-byte-exact.
4. Keep the Task Frame closed to documented fields, require repository-relative
   active files, and reject unsafe local evidence pointers before persistence.
5. Test credential, email, international/grouped-phone, and home-path
   heuristics without describing them as comprehensive PII detection.
6. Exercise corruption, bounds, recovery, and no-partial-write tests.
7. Recheck [security and privacy](security-and-privacy.md).

### Hook change

1. Update only canonical files under `hooks/`.
2. Test success, tampering, and storage-failure paths as child processes.
3. Confirm automatic `PreCompact` remains fail-closed.
4. Confirm empty-store bootstrap is once per writable turn, Plan mode defers
   without mutation, and model-visible output contains `storeId` but no path.
5. Run `npm run stage:plugin` and compare source/staged hook hashes.
6. Reinstall using a new plugin version before claiming fresh-session behavior.

### MCP or skill change

1. Keep `dataDir` optional for normal installed-store inference, deny mutation
   on an unconfigured working-directory fallback, and expose only `storeId`.
2. Keep absolute `dataDir` as an advanced explicit override and redact paths
   from errors and model-visible results.
3. Keep `contextgc_plan` advisory; `PREPARE` means checkpoint preparation, not
   native compaction.
4. Regenerate and smoke-test both bundles.
5. Run the plugin and skill validators.
6. Use a fresh `codex debug prompt-input` process for model-visibility evidence.

### Site or public-evidence change

1. Use synthetic, sanitized data only.
2. Regenerate receipts rather than hand-editing copied JSON.
3. Confirm the browser recomputes the canonical receipt hash.
4. Run the site tests and inspect the rendered page when layout changed.
5. Keep access state separate from data-sanitization claims: a private site is
   not yet a judge-accessible public demo.

## Release procedure

1. Update the root package version, lockfile, plugin manifest, CLI version, and
   bundle-smoke client version together.
2. Run `npm run verify`.
3. Run the plugin validator against both the repository root and
   `plugins/context-gc`, then validate both skill copies.
4. Commit the exact source.
5. Create a detached temporary worktree from that commit, install both
   dependency trees with `npm ci --ignore-scripts`, and run `npm run verify`.
6. Install the new plugin version. Codex caches installed plugins by marketplace,
   plugin name, and version, so do not reuse a version for changed bytes.
7. Compare the source and installed hashes for the hook, skill, manifest, and
   both bundles.
8. Run `codex plugin list`, `codex mcp list`, and a fresh
   `codex debug prompt-input` discovery check.
9. Push the reviewed commit and wait for GitHub Actions.
10. Update the submission checklist only after anonymous access succeeds; never
    turn a local path, Session ID, or authenticated-only URL into public
    evidence.

### Privacy-safe public snapshot

The private development repository may contain author metadata that does not
belong in a public release even when the source tree is clean. Do not rewrite or
force-push the private history solely to solve that publication boundary.

For a new public repository:

1. freeze and verify the intended release commit on the private branch;
2. create a new root commit whose tree is byte-identical to that commit;
3. use the generic `ContextGC Contributors` release identity;
4. verify that only one commit is reachable from the public release branch;
5. push only that branch to the public repository's `main`; and
6. never push `--all`, `--mirror`, private tags, notes, or other local refs.

The prepared branch name for this release is `public-release-v0.1.5`. Compare
its tree hash with `main` before every push. Repository visibility, anonymous
clone, CI, and Devpost access remain external checks.

## Pull request evidence

Every pull request should state:

- the user or maintainer problem;
- the exact files and behavior changed;
- the checks run and their results;
- whether benchmark or generated artifacts changed;
- security, privacy, compatibility, and native-compaction boundaries;
- any manual step still required.

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow and
[manual evidence](manual-evidence.md) for volatile documentation claims.

## Avoid these failure modes

- Do not edit staged bundles or `plugins/context-gc` as the source of truth.
- Do not infer Codex credits from tokens or API-equivalent dollars.
- Do not describe a `PREPARE` receipt as proof that native compaction ran.
- Do not treat schema and hash validation as semantic prompt-injection proof.
- Do not report a local test, Sites build, or GitHub push as final
  Devpost submission evidence.
- Do not update a receipt hash without checking why the evaluated decisions
  changed.

## Next references

- [English user manual](user-manual.md)
- [한국어 사용자 매뉴얼](user-manual.ko.md)
- [Troubleshooting](troubleshooting.md)
- [Architecture](architecture.md)
- [Security and privacy](security-and-privacy.md)
- [Evaluation decision brief](../research/contextgc-decision-brief.md)
- [Final submission runbook](../submission/final-submission-runbook.md)
