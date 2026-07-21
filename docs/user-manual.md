# ContextGC User Manual

## Manual metadata

| Field | Value |
| --- | --- |
| Product | ContextGC 0.1.7 |
| Manual type | Windows installation and operations tutorial |
| Target reader | A Windows Codex user installing ContextGC from its public repository |
| Reader job | Install ContextGC, trust it deliberately, create and recover a task-context checkpoint, and manage the installation without confusing context recovery with source-code recovery |
| Prerequisites | Git, Node.js 22.13.0 or newer, and Codex CLI with plugin support |
| Scope boundary | Local ContextGC checkpoints, evidence references, and plugin operations; not Codex native compaction control, Git rollback, or ChatGPT/Codex credit accounting |
| Done when | A new Codex thread can see ContextGC, the six MCP tools are available, one checkpoint ID is returned, and hook/tool output agrees on one opaque `storeId` without exposing its path |
| Freshness date | 2026-07-19 |

## Reader promise

By the end of this manual, you can:

- clone or reuse the public ContextGC repository;
- install the repository marketplace and ContextGC plugin;
- review and trust the bundled hooks instead of trusting them blindly;
- create your first reversible task-context checkpoint with a natural-language prompt;
- distinguish checkpoint restore, evidence rehydration, and source-control recovery;
- run a deterministic, no-install CLI smoke test with known observables;
- update or uninstall the plugin while making an explicit decision about retained data.

This manual assumes that you can already start Codex in a local Git repository.
It does not teach GitHub account administration, Codex account setup, or native
`/compact` behavior.

## The mental model

ContextGC is a reversible control layer around a Codex task. It compiles a
small **Task Frame** from verified goals, constraints, decisions, open loops,
active files, and test evidence. It can store selected UTF-8 evidence by
SHA-256 hash and point back to that evidence when a later task needs it.

```text
current repository and tool evidence
                 |
                 v
        bounded Task Frame
                 |
        reversible checkpoint
          /              \
         v                v
  current frame      hashed archive refs
         |                |
         +---- restore / bounded rehydrate
```

Keep three state domains separate:

| State domain | ContextGC can do | ContextGC cannot do |
| --- | --- | --- |
| Codex task context | Preserve a structured Task Frame, archive selected evidence, and rehydrate a bounded subset | Read or reconstruct Codex's encrypted native compaction payload, invoke `/compact`, or change native automatic thresholds |
| ContextGC local store | Create hash-checked checkpoints, update the latest pointer, and append audit events | Guarantee semantic truth merely because stored bytes pass a hash check |
| Repository and external systems | Record file names and test evidence as context metadata | Revert Git commits, working-tree edits, shell commands, deployments, tickets, or other side effects |

`KEEP`, `SUMMARIZE`, and `EXTERNALIZE` are retention recommendations. This
release has no `DROP` action. A `PREPARE` recommendation means "prepare a
reversible checkpoint"; it never means "run native compaction."

## 1. Preflight the machine

Open PowerShell and run:

```powershell
git --version
node --version
codex --version
codex plugin --help
```

Expected observables:

- Git prints a version instead of a command-not-found error.
- Node prints `v22.13.0` or a newer version.
- Codex prints its version.
- `codex plugin --help` lists `add`, `list`, `marketplace`, and `remove`.

If the Node version is older than 22.13.0, update Node before continuing. If
the `plugin` subcommand is absent, update the Codex CLI using the current
official Codex installation guidance. Do not work around either prerequisite
by editing the plugin bundle.

## 2. Obtain the public repository

### Path A: first clone

Clone over HTTPS; no repository credential belongs in the checkout or prompt:

```powershell
Set-Location C:\path\to\your\projects
git clone https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location .\context-gc
git rev-parse --show-toplevel
git status --short
```

Purpose: create a local clone and establish the repository root from which the
marketplace command must run.

Expected observables:

- `git rev-parse --show-toplevel` ends in `context-gc`.
- `git status --short` prints nothing for a fresh, clean clone.
- `.agents\plugins\marketplace.json` and
  `plugins\context-gc\.codex-plugin\plugin.json` exist.

If Git reports that the repository does not exist, confirm the public URL and
network access. Do not paste access tokens into this repository or into Codex
prompts.

### Path B: an existing clone

Preserve local work before updating:

```powershell
Set-Location C:\path\to\context-gc
git status --short
git branch --show-current
```

If `git status --short` shows changes, stop and commit, move, or otherwise
resolve them intentionally. Do not hide unknown work with an automatic reset.
When the clone is clean, update without creating a merge commit:

```powershell
git pull --ff-only
```

Expected observable: Git reports an up-to-date branch or a fast-forward update.
If `--ff-only` fails, resolve the branch divergence before installing from that
clone.

## 3. Install ContextGC from the repository

Run these commands from the repository root:

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
codex plugin list
```

The first command registers the repo marketplace at
`.agents\plugins\marketplace.json`. The second installs the `context-gc`
entry from the `context-gc-local` marketplace. The checked-in plugin is
prebuilt, so a normal user install does not require `npm install`, a TypeScript
build, or a separate API key.

Expected observable: `codex plugin list` contains a row for
`context-gc@context-gc-local` with an installed and enabled status. This proves
installation, but it does **not** yet prove that a running model can see the
skill, that the MCP server started, or that hooks are trusted.

If the marketplace is already registered, inspect it first:

```powershell
codex plugin marketplace list
```

The `context-gc-local` entry should resolve to this clone. If it points to an
old clone, remove that marketplace entry deliberately and add the intended
repository root; do not maintain two sources with the same marketplace name.

## 4. Review and trust the hooks

Installing or enabling a plugin does not automatically trust its bundled
hooks. This is a Codex safety boundary, not an installation error.

1. Start Codex in the repository and open a new thread.
2. Enter `/hooks`.
3. Select the ContextGC hook definition and inspect every command.
4. Compare it with `plugins\context-gc\hooks\hooks.json` in the clone.
5. Trust it only when the event list and commands match.
6. After trusting it, start one more new thread by entering `/new` or by exiting
   and starting Codex again.

The reviewed definition should contain these six lifecycle events:

| Event | Intended ContextGC role |
| --- | --- |
| `SessionStart` | Load a bounded, integrity-checked Task Frame when one exists |
| `UserPromptSubmit` | Supply bounded checkpoint context for the current prompt |
| `PostToolUse` | Record cheap factual metadata and recognize a matching checkpoint result |
| `PreCompact` | Verify the latest checkpoint and write a reversible snapshot at the lifecycle boundary |
| `PostCompact` | Record the completed boundary and show one bounded result notice |
| `Stop` | Record metadata only; never force a model continuation |

Freshness and integrity are separate. An older but verified Task Frame is
snapshotted as a recovery fallback and does not block automatic compaction.
`PostCompact` then states that recent work relies on Codex's opaque native
summary. Missing, invalid, or unwritable checkpoint protection remains
fail-closed.

All commands should run the checked-in `hooks\run-hook.mjs` through Node and
derive the script location from `PLUGIN_ROOT`. Do not trust the definition if
it invokes an unexpected downloader, executable, network endpoint, or script
outside the installed plugin.

Why the second new thread matters: bundled skills become available to a new
chat or CLI session after installation, and a trusted `SessionStart` hook needs
a fresh lifecycle boundary to load an existing frame.

The first verified startup for a newly trusted version shows one three-line
onboarding notice. Later fresh startups show a two-line lifecycle wireframe;
resume is silent. Healthy prompt, tool, and Stop hooks emit no user notice. A
protected compaction uses one line, and recovery or integrity failures use at
most three lines and 240 characters. Full explanations stay in this manual or
an explicit status request.

## 5. Verify discovery in the new thread

Inside Codex, run:

```text
/mcp
```

Expected observable: the `context-gc` MCP server and its tools are available.
If your Codex surface supports verbose MCP inspection, use it to examine the
server command rather than guessing.

From a separate PowerShell process, you can also perform a stronger
model-input diagnostic:

```powershell
codex debug prompt-input "Use ContextGC to inspect context health."
```

Expected observable: the JSON includes the `context-gc` skill metadata. The
`debug prompt-input` command is experimental; use it as a discovery diagnostic,
not as a stable automation interface or proof that a checkpoint operation has
run.

Use this evidence ladder when troubleshooting:

1. `codex plugin list` proves installed/enabled state.
2. A new thread plus `debug prompt-input` proves model-visible skill metadata.
3. `/mcp` proves the MCP server and tools are available to that thread.
4. `/hooks` proves the current hook definition is reviewed and trusted.
5. A returned checkpoint ID plus `contextgc_status` proves runtime behavior.

Do not collapse these into one "installed means working" claim.

## 6. Create the first checkpoint

Use a real repository with a concrete task. In the trusted new thread, send
this natural-language prompt:

For an empty store, `SessionStart` shows only a short UI notice. The first user
prompt in a writable/default mode can request one bootstrap checkpoint;
`PostToolUse` is a once-per-turn fallback. Plan mode defers the mutation and
suppresses further reminders for that turn. Automatic PreCompact remains
fail-closed until checkpoint, snapshot, and hook-state persistence all verify.

```text
Use ContextGC to create one explicit safety-boundary checkpoint for this
repository.

First inspect the current repository files and the latest test evidence. Omit
dataDir from every ContextGC MCP call so the installed plugin selects its
private local store. Compare only the opaque contextgcStoreId/storeId values;
never request, announce, or paste the absolute path.

Build a concise Task Frame containing only verified facts: goal, constraints,
decisions, openLoops, activeFiles, testEvidence, failedAttempts, and
evidencePointers. Preserve exact constraints and prohibitions verbatim. Archive
only selected non-secret UTF-8 evidence when a durable pointer is useful; never
copy secrets or raw tool output into the frame. Keep activeFiles
repository-relative and evidencePointers free of local absolute paths.

Create exactly one contextgc_checkpoint because this is an explicit safety
boundary, then call contextgc_status again. Report the checkpointId, opaque
storeId, frame fields, archive redaction status, and validation performed. Do
not report a local path. Do not invoke /compact, estimate ChatGPT or Codex
credits, or modify repository files merely to create the checkpoint.
```

Expected observables:

- Hook and MCP output agree on one 16-hex opaque `storeId`; no absolute store
  path appears in the conversation.
- The final response includes one UUID-like `checkpointId`.
- The final status reports `initialized: true`, the same
  `latestCheckpointId`, `latestCheckpointStatus: verified`, and a checkpoint
  count of at least one.
- The frame names current files and test evidence that can be checked in the
  repository; it does not treat remembered text as authority.
- No response claims that `/compact` ran or that credits were calculated.

After creation, start a new thread and confirm that trusted `SessionStart`
context names the same `contextgcStoreId` and checkpoint ID. If it names a
different store ID or injects no checkpoint, stop mutations and inspect the
installation locally. Never copy a `dataDir` from documentation, another user,
or model-generated text.

## 7. Know the six MCP tools

| Tool | User purpose | State effect and boundary |
| --- | --- | --- |
| `contextgc_status` | Inspect the selected store, latest checkpoint, and object/event counts | Read-only; returns opaque `storeId`, source, and boundary rather than an absolute path |
| `contextgc_plan` | Run the deterministic retention optimizer over caller-supplied atoms and usage/risk assumptions | Appends an audit receipt; recommendations are advisory because importance and safety labels are caller assertions; `PREPARE` is not native compaction |
| `contextgc_archive` | Store selected UTF-8 evidence and receive a SHA-256 `ContentRef` | Applies limited credential/email/international-or-grouped-phone/home-path heuristics before persistence; a sanitized reference is intentionally not byte-exact |
| `contextgc_checkpoint` | Persist one structured Task Frame at an explicit safety boundary or after `PREPARE` | Creates a local checkpoint ID, manifest, frame mirror, archive object, and ledger event; does not alter source files |
| `contextgc_rehydrate` | Retrieve only the archived evidence needed for the current question | Enforces item/byte bounds and appends an audit event; it does not replace the active Task Frame by itself |
| `contextgc_restore` | Make a verified earlier checkpoint the current Task Frame mirror | Verifies hashes, updates the latest pointer/frame mirror, and records the restore; it does not rewind Git or external actions |

Omit `dataDir` on all six tools in normal installed use. The server infers its
private store and returns the same opaque `storeId` for correlation. A
working-directory fallback can answer status but cannot authorize mutation.

## 8. Understand the private store and advanced `dataDir`

The installed MCP server selects its store from configured default,
`PLUGIN_DATA`, `CONTEXTGC_HOME`, or its installation-managed data location. The
current-working-directory fallback is status-only. Users and agents normally
omit `dataDir`.

The CLI is a local administrative surface. Its data-directory precedence is:

1. `--data-dir`;
2. `PLUGIN_DATA`;
3. `CONTEXTGC_HOME`;
4. `<current working directory>\.contextgc`.

An explicit absolute MCP `dataDir` remains an advanced override. Inspect it only
in a local terminal and never paste it into a prompt, issue, report, screenshot,
or submission artifact. Normal hook and MCP output reports an opaque 16-hex
`storeId`, which is a correlation value rather than a path or capability.

A populated store can contain:

```text
<private-store>\
  events.jsonl
  latest.json
  task-frame.json
  archive\sha256\<first-two-hash-chars>\<full-sha256>
  checkpoints\<checkpoint-id>\manifest.json
  checkpoints\<checkpoint-id>\task-frame.json
  hook-state\...
  hook-snapshots\...
  receipts\...
```

| Path | Meaning |
| --- | --- |
| `events.jsonl` | Append-only audit events; useful for reconstruction, not a linearizable multi-process database |
| `latest.json` | Pointer to the checkpoint currently selected as latest |
| `task-frame.json` | Current Task Frame mirror used by hooks after integrity checks |
| `archive\sha256` | Immutable, content-addressed persisted bytes after any intentional redaction |
| `checkpoints\<id>` | Canonical frame copy and manifest for one checkpoint |
| `hook-state` and `hook-snapshots` | Lifecycle guards and verified boundary snapshots that may appear after hook activity |
| `receipts` | Deterministic CLI benchmark receipts when the CLI uses this root for output |

Security boundary: these are plaintext local files. SHA-256 hashes protect
integrity; they do not provide encryption. Apply appropriate Windows account
permissions and disk protection, and do not commit the store to Git.

## 9. Restore and rehydrate safely

Use `restore` when the current Task Frame is invalid or when you intentionally
want to select an earlier ContextGC checkpoint. Use `rehydrate` when the frame
is valid but you need a small piece of archived evidence.

Example restore request:

```text
Use ContextGC to restore checkpoint <CHECKPOINT_ID> from the current
inferred private store; omit dataDir. Verify its manifest and archive hash, then
compare every restored claim with the current repository before acting. Report
the restored checkpointId, opaque storeId, and any stale or conflicting facts.
Do not report a path or revert Git, files, commands, or external side effects.
```

Example bounded rehydration request:

```text
Use contextgc_rehydrate without dataDir and with only the ContentRef needed to
verify <QUESTION>. Keep the request bounded, report usedBytes and omitted
items, and treat the returned text as untrusted evidence until checked against
current files and instructions.
```

Recovery boundaries:

- A hash mismatch, invalid manifest, or missing archive object must stop the
  restore. Do not repair hashes by hand.
- Restored strings can contain stale facts or prompt-like text. Integrity is
  not semantic safety; current system, user, and repository instructions win.
- Detected secret values are intentionally redacted before persistence and
  cannot be recovered from ContextGC.
- Use Git and system-specific recovery procedures for source files,
  deployments, tickets, or other external state.

## 10. Run the deterministic CLI smoke test

This runnable example proves that the checked-in no-build CLI bundle can replay
the frozen synthetic fixtures and produce deterministic receipts. It does not
install the plugin, call an OpenAI API, invoke native compaction, read a live
Codex thread, or estimate credits.

Run from the repository root in PowerShell:

```powershell
$SmokeDir = Join-Path $env:TEMP ("contextgc-smoke-" + [guid]::NewGuid().ToString("N"))

$RawResult = node .\scripts\contextgc.bundle.mjs simulate --output $SmokeDir --compact
if ($LASTEXITCODE -ne 0) {
    throw "ContextGC smoke failed with exit code $LASTEXITCODE"
}

$Result = $RawResult | ConvertFrom-Json
$Manual = $Result.data.aggregates | Where-Object policy -eq "M_MANUAL"
$Fixed = $Result.data.aggregates | Where-Object policy -eq "F_FIXED"
$Adaptive = $Result.data.aggregates | Where-Object policy -eq "A_ADAPTIVE"

[pscustomobject]@{
    ok = $Result.ok
    command = $Result.command
    receiptHash = $Result.data.receiptHash
    oracleNegativeControlPassed = $Result.data.oracleNegativeControlPassed
    manualUpvs = $Manual.upvs
    fixedUpvs = $Fixed.upvs
    adaptiveUpvs = $Adaptive.upvs
    files = ((Get-ChildItem -LiteralPath $SmokeDir -File |
        Sort-Object Name | Select-Object -ExpandProperty Name) -join ",")
} | Format-List
```

For ContextGC 0.1.7 with the checked-in fixtures, the exact observable is:

```text
ok                          : True
command                     : simulate
receiptHash                 : f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd
oracleNegativeControlPassed : True
manualUpvs                  : 59884.666667
fixedUpvs                   : 67653.666667
adaptiveUpvs                : 65488.333333
files                       : benchmark-report.json,demo-receipt.json
```

UPVS means usage-proxy units per verified successful synthetic task. It is not
a ChatGPT or Codex credit value. A different receipt hash or metric means the
bundle, fixture set, evaluator, or output changed; investigate the diff rather
than relabeling the new result as equivalent.

Cleanup is intentionally non-recursive. It refuses to remove the directory if
the smoke produced anything other than the two expected files:

```powershell
$ExpectedFiles = @("benchmark-report.json", "demo-receipt.json")
$ActualFiles = @(Get-ChildItem -LiteralPath $SmokeDir -File |
    Select-Object -ExpandProperty Name | Sort-Object)
$UnexpectedDirectories = @(Get-ChildItem -LiteralPath $SmokeDir -Directory)

if ((Compare-Object $ExpectedFiles $ActualFiles) -or $UnexpectedDirectories.Count -ne 0) {
    throw "Refusing cleanup: smoke directory contains unexpected entries: $SmokeDir"
}

foreach ($Name in $ExpectedFiles) {
    Remove-Item -LiteralPath (Join-Path $SmokeDir $Name) -Force
}
Remove-Item -LiteralPath $SmokeDir
Test-Path -LiteralPath $SmokeDir
```

Expected cleanup observable: `False`.

## 11. Update ContextGC

### Update from a clean public clone

```powershell
Set-Location C:\path\to\context-gc
git status --short
git pull --ff-only
codex plugin add context-gc@context-gc-local
codex plugin list
```

Expected observable: the installed ContextGC row shows the version declared by
the updated `plugins\context-gc\.codex-plugin\plugin.json`.

Start a new thread after reinstalling. If the hook definition changed, Codex
requires you to inspect and trust the new definition again; repeat the `/hooks`
procedure rather than bypassing hook trust.

### Update while developing ContextGC

Only maintainers who changed TypeScript, hooks, skills, or plugin packaging need
to rebuild and restage:

```powershell
npm ci --ignore-scripts
npm run stage:plugin
codex plugin add context-gc@context-gc-local
```

Expected observable: `npm run stage:plugin` completes successfully and the
staged plugin under `plugins\context-gc` contains the rebuilt bundles. Start a
new thread and repeat discovery and hook verification. See the developer guide
for full verification before distributing a change.

## 12. Uninstall and decide what to retain

Before uninstalling, ask ContextGC for status and record the opaque `storeId`
and any checkpoint IDs you intend to keep. Do not put an absolute path in the
record. Then remove the plugin:

```powershell
codex plugin remove context-gc@context-gc-local
codex plugin list
```

Expected observable: the ContextGC entry is no longer installed. Close active
threads that loaded the plugin and start a new one before testing the absence.

If you no longer want Codex to track the local marketplace either:

```powershell
codex plugin marketplace remove context-gc-local
codex plugin marketplace list
```

Plugin removal and ContextGC data erasure are separate decisions. ContextGC
does not expose an automatic deletion command and does not automatically delete
persisted non-secret evidence. Do not assume uninstall is a secure-erasure
operation.

Choose one data-retention action:

- **Keep:** retain the installation-managed private store if checkpoint
  recovery or audit history is still useful. Protect it as plaintext sensitive
  project data.
- **Back up, then remove:** close Codex, resolve the store locally through an
  approved administrative workflow, copy it to encrypted backup, verify the
  copy, and then remove only the original store.
- **Erase:** close Codex, resolve and inspect the exact store locally, then
  delete only that directory. Never publish the path or delete its parent, a
  repository root, `%USERPROFILE%`, or a path copied from a prompt.

Detected values that were redacted are not present as recoverable original
bytes in ContextGC. Credential, email, international/grouped-phone, and
home-path matching is a limited deterministic heuristic, not proof that all
PII, sensitive, or proprietary text was removed. Handle the entire store
according to the repository's data policy.

After upgrading from a markerless checkpoint created by an earlier build, the legacy latest remains
local and immutable but is not injected. Create a new strict checkpoint only
from currently verified facts. It is not linked as the new checkpoint's parent,
and earlier context is not automatically recovered.

## 13. Troubleshooting

| Signal | Likely layer | Safe next action |
| --- | --- | --- |
| ContextGC absent from `codex plugin list` | Marketplace/install | Run `codex plugin marketplace list`, confirm the clone path, then install the exact selector |
| Plugin installed but skill not visible | Session discovery | Start a new thread; optionally use the experimental `codex debug prompt-input` diagnostic |
| Skill visible but tools unavailable | MCP startup | Run `/mcp`, confirm Node 22.13+, and inspect the plugin server entry; do not edit generated bundles as a first response |
| Hooks listed but skipped | Hook trust | Use `/hooks`, compare with the checked-in definition, and trust only the reviewed version |
| Hook and MCP show different store IDs | Split store or installation | Stop mutations, omit `dataDir`, and inspect plugin configuration locally without publishing a path |
| Empty store blocks automatic compact | Fail-closed bootstrap | Use a writable/default turn to create one checkpoint; Plan mode intentionally defers mutation |
| Restore reports hash or manifest failure | Integrity boundary | Preserve the store, try a separately known checkpoint only if requested, and inspect the damaged files without rewriting hashes |
| Restored facts conflict with current files | Stale semantic state | Treat current repository files, tests, and user instructions as authoritative |
| Expected credits or savings value is absent | Product boundary | Use the reported usage proxy only; ContextGC intentionally reports actual ChatGPT/Codex credits as unknown |

## 14. Limitations

- ContextGC does not invoke `/compact`, change Codex's native compaction
  threshold, or inspect native encrypted compaction state.
- It does not convert tokens or usage proxies into actual ChatGPT/Codex credits.
- The optimizer is bounded and deterministic, not globally optimal, lossless,
  or reinforcement learning.
- Current benchmark results come from three frozen synthetic traces. They do
  not prove production savings or broad statistical generalization.
- `contextgc_plan` does not prove or perform externalization. It discards a
  missing or malformed `sha256:<64-lowercase-hex>` `archiveRef`, but any
  supplied reference and scan metadata remain
  caller-asserted until independently matched to a runtime-verified ContentRef
  returned by `contextgc_archive`.
- Detected credential values are intentionally redacted and cannot be restored
  from ContextGC.
- Credential, email, international/grouped-phone, and home-path heuristics
  cannot prove that arbitrary text contains no PII, secrets, or proprietary
  information. Contiguous numeric IDs, IP addresses, date/hour strings, and
  matching segments inside remote URLs are deliberately preserved. Explicit
  local `file:` and percent-encoded `file%3A` URIs are redacted in full.
- Checkpoints and archives are plaintext. Integrity hashes are not encryption.
- A valid stored frame can still contain stale or prompt-injection-like text;
  verify it against current files and instructions.
- Codex transcript telemetry is version-sensitive. Unsupported shapes disable
  automatic decisions instead of being guessed.
- JSONL events are append-only best-effort records, not a transactional
  multi-process database.
- ContextGC never automatically deletes persisted non-secret evidence.

## 15. Glossary

| Term | Definition |
| --- | --- |
| Archive | Local content-addressed storage for selected evidence after any intentional redaction |
| Checkpoint | A manifest plus canonical Task Frame whose bytes are verified by hash |
| `ContentRef` | A SHA-256 reference recording hash, byte count, media type, scan state, and redaction count |
| `contextgcStoreId` | Opaque store identifier rendered by a trusted hook; compare it with MCP `storeId` without revealing a path |
| `dataDir` | Advanced explicit absolute-path override; omit in normal installed use and never paste the value into shared output |
| EXTERNALIZE | Keep evidence outside the inline frame through a reversible archive reference |
| KEEP | Retain an atom directly in the working context representation |
| MCP | Model Context Protocol; the interface through which Codex calls the six ContextGC tools |
| Native compaction | Codex's own context-compaction mechanism; ContextGC can observe lifecycle boundaries but does not actuate it |
| `PLUGIN_DATA` | Codex-provided writable directory for an installed plugin; ContextGC hooks prefer it as their state root |
| `storeId` | Opaque 16-hex store correlation identifier; not a path, secret, or authorization token |
| PREPARE | A recommendation to prepare a reversible ContextGC checkpoint, not to compact |
| Rehydrate | Retrieve a bounded subset of archived evidence without replacing the Task Frame |
| Restore | Select a verified checkpoint as the current Task Frame mirror; not a Git rollback |
| SUMMARIZE | Retain a shorter non-exact representation while preserving evidence pointers where applicable |
| Task Frame | The bounded structured working set of verified goals, constraints, decisions, files, evidence, failures, and open loops |
| UPVS | Usage-proxy units per verified successful task; an evaluation metric, not credits or billing |

## 16. Next reference paths

- [Project overview](../README.md)
- [Short plugin installation reference](plugin-install.md)
- [Architecture and failure behavior](architecture.md)
- [Security and privacy boundary](security-and-privacy.md)
- [Developer guide](developer-guide.md)
- [Korean research report](../research/contextgc-korean-report.md)
- [Deterministic benchmark receipt](../output/benchmark/benchmark-report.json)
- [Official Codex plugin guide](https://learn.chatgpt.com/docs/build-plugins)
- [Official Codex hooks guide](https://learn.chatgpt.com/docs/hooks)
- [Official Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Official OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction)

## Verification and maintenance ledger

This compact ledger identifies the claims that must be refreshed when the
product or Codex changes.

| ID | Claim | Type | Evidence checked 2026-07-19 | Update trigger |
| --- | --- | --- | --- | --- |
| UM-001 | Marketplace add, plugin add/list/remove, and experimental prompt-input commands exist | Current/versioned | Current Codex manual plus local `codex ... --help` output | Codex CLI or manual change |
| UM-002 | Plugin hooks receive `PLUGIN_ROOT` and `PLUGIN_DATA` and require explicit trust | Current/versioned | [Official hooks guide](https://learn.chatgpt.com/docs/hooks) | Hook contract change |
| UM-003 | ContextGC exposes six named MCP tools with the stated boundaries | Versioned | `src/mcp/server.ts`, plugin manifest, and MCP tests | ContextGC interface/version change |
| UM-004 | Store layout, restore behavior, redaction, and plaintext boundaries match implementation | Versioned/security | `src/runtime`, `hooks/run-hook.mjs`, `docs/security-and-privacy.md`, and tests | Runtime schema or security-boundary change |
| UM-005 | The CLI smoke produces the listed receipt hash and UPVS values | Empirical | Executed checked-in `scripts/contextgc.bundle.mjs simulate`; generated receipts inspected and cleaned up | Bundle, fixture, scorer, or benchmark version change |
