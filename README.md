# ContextGC

**Keep the truth. Compress the noise.**

[English](README.md) | [한국어](README.ko.md)

![ContextGC cover](submission/assets/contextgc-cover.jpeg)

ContextGC is a local-persistence, reversible context control plane for long
Codex engineering tasks. It protects typed invariants, archives sanitized
evidence by hash, prepares bounded Task Frames, and explains when checkpoint
preparation is worth its usage and cache overhead. “Reversible” means selecting
a verified Task Frame checkpoint and rehydrating retained evidence; it does not
restore redacted bytes, Git state, files, commands, or external side effects.
Task Frames injected into a Codex turn are processed under the user's normal
Codex service terms, so local persistence does not mean offline model use.

It is a Developer Tools project for OpenAI Build Week.

## Why this exists

Experienced Codex users often keep a hand-written `PROJECT_STATE.md`, compact
around a personal threshold, and paste a handoff into the next thread. That is a
good practice, but it depends on attention at exactly the moment the context is
most crowded.

ContextGC does not replace that human-readable project record. It adds a
machine-checked safety layer around it:

- exact goals, constraints, identifiers, and test evidence become typed
  invariants;
- `PreCompact` refuses to proceed until the checkpoint, snapshot, and hook
  state verify;
- archived evidence is addressed by hash and rehydrated only when needed;
- `SessionStart` injects a small verified Task Frame into a fresh thread; and
- every normal installed-plugin result uses an opaque store ID instead of a
  local path.

The practical benefit is less re-explanation and less recovery work when a long
task compacts or moves to a fresh thread. The current release does not claim a
measured reduction in live Codex credits.

## Judge: 60-second public path

1. Open the [hosted evidence explorer](https://contextgc-build-week.trytrytry.chatgpt.site)
   and inspect the verified synthetic receipt. An unauthenticated HTTP GET
   returned `200` on 2026-07-23; live hosting can still change.
2. Compare it with the exact checked-in
   [receipt](output/benchmark/benchmark-report.json), whose expected receipt
   hash is `f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd`.

For an optional no-build local reproduction, use the pinned release. This path
requires Node.js 22.13 or newer but no dependency installation or rebuild:

```powershell
git clone --branch v0.1.13 --depth 1 https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location context-gc
node scripts/contextgc.bundle.mjs simulate
```

To test the installed Codex surface on Windows, continue with:

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
codex plugin list
```

Expected observable: `context-gc@context-gc-local` appears as
`installed, enabled`. Start a new Codex thread, inspect `/hooks`, and trust the
definition only after it matches this clone.

Then ask:

```text
Use ContextGC to inspect this task's context health and create a reversible
checkpoint. Keep exact constraints protected and explain every externalization.
```

Continue with the [English user manual](docs/user-manual.md) or
[한국어 사용자 매뉴얼](docs/user-manual.ko.md). Use the
[troubleshooting guide](docs/troubleshooting.md) when an expected observable is
missing.

## Recommended expert workflow

Keep your durable project journal as the human source of truth. Use ContextGC
for the bounded operational state that must survive the next lifecycle boundary.

```text
PROJECT_STATE.md      human-readable project history and durable decisions
        |
        v
ContextGC Task Frame  current goal, exact constraints, blockers, next action
        |
        +--> hashed local evidence archive
        |
        v
native compact or fresh thread
        |
        v
verified SessionStart recovery + selective rehydration
```

This hybrid approach preserves Markdown portability while removing the need to
trust an unverified free-form handoff.

## Fit boundary

ContextGC fits long Codex engineering work where goals, exact constraints,
decisions, test evidence, and recovery pointers must survive context pressure.
It is useful when a user accepts local plaintext checkpoint storage and is
willing to inspect lifecycle hooks before trusting them.

Do not adopt this release when you need encrypted storage, automatic deletion,
a Git/file rollback system, proof of native `/compact` execution, exact Codex
credit accounting, or statistically validated production savings.

## What is working

- Installable Codex plugin with a skill, lifecycle hooks, and six MCP tools
- Deterministic `KEEP | SUMMARIZE | EXTERNALIZE` optimizer with no `DROP`
- Protected/exact and redacted-secret fail-closed gates
- Installed private-store inference with opaque model-visible store IDs
- SHA-256 content-addressed archive, atomic checkpoints, bounded rehydration,
  and explicit checkpoint restore
- Version-allowlisted Codex transcript telemetry adapter
- Three frozen 10–12 turn software-engineering traces and hidden deterministic
  oracles
- Interactive judge-facing Sites demo backed by a sanitized benchmark receipt

## Truth boundary

ContextGC does **not** claim to:

- replace or inspect Codex's encrypted native compaction state;
- invoke `/compact` in an arbitrary existing Codex Desktop or CLI thread;
- preserve detected secret bytes after intentional redaction;
- comprehensively detect or remove all personally identifiable information;
- be lossless, globally optimal, or the first context-memory system;
- convert tokens into actual ChatGPT/Codex credits.

ContextGC never initiates native compaction. A trusted `PreCompact` hook can
permit or block a **host-initiated** automatic compaction according to verified
checkpoint, snapshot, and hook-state integrity.

OpenAI's Codex hooks documentation describes `transcript_path` as convenient but
unstable, so unknown versions and shapes disable automatic decisions rather than
being guessed. OpenAI also does not publish a deterministic per-token conversion
for ChatGPT plan credits. ContextGC therefore keeps raw token categories,
explicit usage-proxy weights, optional caller-supplied API-equivalent pricing,
and `codexCredits: null`.

Before persistence, ContextGC applies deterministic heuristics for known
credential formats, secret-named fields, email addresses, international `+` or
grouped phone formats, and home-user path segments. This is a data-minimization
boundary, not a general PII detector; users must still keep sensitive task data
out of prompts, reports, screenshots, and public artifacts. Redaction takes
precedence over exact retention: if a protected exact value is redacted, the
original bytes are not checkpoint-recoverable and that source is ineligible for
protected exact EXTERNALIZE advice.

Official product references: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[building plugins](https://learn.chatgpt.com/docs/build-plugins), and
[compaction](https://developers.openai.com/api/docs/guides/compaction).

### Codex memories coexistence

Host-managed Codex memories and ContextGC serve different layers. Memories are
advisory cross-chat recall; ContextGC stores a bounded, integrity-verified Task
Frame and reversible evidence pointers around compaction. ContextGC does not
read, modify, deduplicate, or treat native memories as checkpoint evidence.
After a Codex memory or model update, verify that recalled guidance does not
conflict with the current repository or the latest verified Task Frame.

## Verified synthetic benchmark

All policies replay the same three frozen traces. Success is decided by hidden
deterministic oracles; no model grades its own answer.

| Policy | UPVS ↓ | Verified tasks | Critical retention | Manual interventions |
| --- | ---: | ---: | ---: | ---: |
| Manual frozen schedule | **59,884.67** | 3/3 | 100% | 6 |
| Fixed 75% + cooldown | 67,653.67 | 3/3 | 100% | 0 |
| ContextGC adaptive | 65,488.33 | 3/3 | 100% | 0 |

On these synthetic fixtures, adaptive UPVS is 3.20% below the fixed policy but
9.36% above the frozen manual schedule; the manual schedule requires six human
interventions while adaptive requires none. A corrupt-protected-fact negative
control fails all three fixtures, so success is not guaranteed by the scorer.
The project's 15%-versus-both economics promotion gate therefore fails, and
this release is positioned as a safety/audit controller rather than a savings
winner. This is deterministic regression evidence, not proof of live native-
compaction quality, production savings, or statistical generalization. See the full
[benchmark receipt](output/benchmark/benchmark-report.json) and
[web-safe receipt](output/benchmark/demo-receipt.json).

UPVS means usage-proxy units per verified successful task. The default proxy
uses neutral 1.0 weights over non-overlapping recorded token categories and
stores those weights in every receipt.

## Architecture

```text
Codex hooks / replay trace
        |
        v
append-only ledger ---> sanitized SHA-256 archive
        |                         |
        v                         |
schema guard -> MemoryAtoms -> invariant gate -> optimizer
                                              |
                          KEEP / SUMMARIZE / EXTERNALIZE
                                              |
                                              v
                              TaskFrame + Receipt + checkpoint
                                              |
                                  rehydrate / restore known ID
```

See [architecture](docs/architecture.md),
[security and privacy](docs/security-and-privacy.md), and the
[experimental app-server spike](docs/app-server-spike.md).

## Hosted evidence path

The [hosted demo](https://contextgc-build-week.trytrytry.chatgpt.site)
loads only sanitized synthetic data and cannot read a visitor's Codex files.
It is an interactive evidence explorer and capability walkthrough, not a live
Codex session or a benchmark running in the visitor's browser.

Unauthenticated access returned HTTP `200` on 2026-07-23. The checked-in site
and receipt remain reproducible evidence; this dated check is not a guarantee
of future hosting availability.

The checked-in CLI bundle reproduces the deterministic receipt without
rebuilding:

```powershell
node scripts/contextgc.bundle.mjs simulate
```

## Install the plugin on Windows

Requirements: Node.js 22.13 or newer. Installation, discovery, and lifecycle
hooks are verified with Codex CLI 0.145.0. Transcript telemetry is allowlisted
only for Codex `0.144.x`, `0.145.0-alpha.x`, and the exact `0.145.0` stable
schema; later versions disable automatic decisions rather than being treated as
compatible.

Release `v0.1.13` pins the reviewed source. Verify the checked-in
[release hash manifest](release/v0.1.13.sha256) before trusting prebuilt bundles
or hooks. Matching `/hooks` with the clone proves command parity; the release
tag and manifest identify which source and bytes were reviewed.

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
```

Start a new Codex thread. Open `/hooks`, inspect `hooks/hooks.json`, and trust it
only if it matches this repository. Installation alone does not trust bundled
hooks. In normal installed use, users and agents omit `dataDir`; ContextGC
infers its private local store, while hooks and tools expose only an opaque
`storeId`. The injected Task Frame labels that same digest
`contextgcStoreId`; MCP structured results label it `storeId`. An absolute
`dataDir` is an advanced override that must stay local
and must never be pasted into prompts or reports.

### Minimal notification policy

ContextGC keeps normal work quiet. The first verified startup after trusting a
new plugin version shows one three-line onboarding notice and a README link.
Later fresh startups show a compact two-line wireframe; resume does not repeat
onboarding. Ordinary prompts, tool calls, and `Stop` events are silent and never
create a model continuation merely because a tool-count or clock threshold was
crossed. A protected compaction reports one line. Integrity failures and an
explicit restore report at most three lines and never include a checkpoint ID,
store ID, session ID, or local path.

The full Task Frame remains bounded model context rather than a user-facing
status transcript. Native Codex summary contents are opaque to ContextGC;
notifications report only the checkpoint, snapshot, and recovery state that the
plugin can verify.

Checkpoint freshness is advisory. When recent work outgrows the latest verified
Task Frame, `PreCompact` preserves that frame as a byte-verified fallback and
permits the host-initiated native compaction; the result notice says that recent work relies on
Codex's opaque native summary. ContextGC blocks automatic compaction only when
checkpoint integrity or durable snapshot/state persistence cannot be verified.

An empty store is handled fail-closed. The first writable user turn may request
one checkpoint without a path; Plan mode defers the mutation for that turn.
Automatic PreCompact stays blocked until the checkpoint, snapshot, and hook
state all verify.

If `contextgc_status` reports `latestCheckpointStatus: invalid`, ContextGC does
not load that pointer, its target, or a mismatched Task Frame mirror. Restore a
previously recorded verified checkpoint ID or create one strict successor from
facts re-verified in the current task; invalid or markerless targets are not
linked as the successor's parent. Then retry from a fresh writable turn.

After upgrading from a markerless checkpoint created by an earlier build, ContextGC does not inject the
markerless legacy frame. Create a new strict checkpoint only from currently
verified facts; earlier context is not automatically recovered.

Full instructions: [plugin installation](docs/plugin-install.md).

## MCP tools and CLI

MCP tools:

- `contextgc_status`
- `contextgc_plan`
- `contextgc_archive`
- `contextgc_checkpoint`
- `contextgc_rehydrate`
- `contextgc_restore`

CLI commands:

```text
node scripts/contextgc.bundle.mjs status
node scripts/contextgc.bundle.mjs simulate
node scripts/contextgc.bundle.mjs checkpoint --frame <file-or-stdin>
node scripts/contextgc.bundle.mjs restore <checkpoint-id>
node scripts/contextgc.bundle.mjs report
```

The plugin install does not create a global `contextgc` executable. Bare
`contextgc` commands are for maintainers who explicitly link the development
npm package. See the exact [interface reference](docs/reference.md), including
private-store inference, `storeId`, advanced `dataDir` overrides, limits, exit
codes, and report fallback behavior.

State-changing operations return a checkpoint or receipt identifier. Restoring
a ContextGC checkpoint restores context metadata and evidence pointers; it does
not revert Git, files, commands, or external side effects.

## Build and verify

```powershell
npm ci --ignore-scripts
npm --prefix site ci --ignore-scripts
npm run verify
```

`verify` compiles TypeScript, runs the unit/integration suite, regenerates the
deterministic benchmark receipts, builds no-rebuild MCP/CLI bundles, stages the
repo marketplace plugin, and lints, server-renders, tests, and builds the Sites
demo.

Useful focused commands:

```powershell
npm run check
npm run benchmark
npm run stage:plugin
npm --prefix site test
```

## Codex contribution

Codex with GPT-5.6 was used for the primary implementation,
official-document verification, adversarial claim review, fixture construction,
testing and final integration. The authoritative primary-build `/feedback`
Session ID is entered only in the Devpost UI, is never committed to this
repository, and is not inferred from CLI or transcript metadata.
In the installed product, a policy-selected lifecycle boundary may ask the
active Codex model for one structured Task Frame. Deterministic code validates
the frame, chooses actions, stores evidence, and evaluates fixtures. There is no
separate API key or out-of-band inference service, and the synthetic benchmark
has no model-as-judge step. Active Codex turns can still consume the user's
normal plan usage. The repository does not attempt to recover or infer model
identity from unstable transcript metadata.

The project owner's decisions—including Windows-first, plugin-first,
local-persistence and reversible automation—are recorded in
[human decisions](docs/human-decisions.md).

## Research and novelty

The [research decision brief](research/contextgc-decision-brief.md) and
[claim ledger](research/claim-ledger.json) compare ContextGC with prior work in
prompt compression, long-term memory, checkpointing, context engines and
risk-controlled selection. The defensible contribution is narrow:

> A Codex-specific, auditable controller that combines typed invariant gates,
> reversible evidence pointers, lifecycle integration, transparent usage
> accounting, and deterministic policy receipts.

It is not presented as a new memory theory.

## Submission material

- [Devpost draft](submission/devpost-draft.md)
- [Three-minute demo script](submission/demo-script.md)
- [Judge guide](submission/judge-guide.md)
- [Evidence checklist](submission/evidence-checklist.md)
- [Final submission runbook](submission/final-submission-runbook.md)

Repository: [github.com/procloudkim/OpenAI-Build-Week-ContextGC](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC)

Demo: [contextgc-build-week.trytrytry.chatgpt.site](https://contextgc-build-week.trytrytry.chatgpt.site)

The owner completed the Devpost submission. Live submission/video URLs are not
duplicated here, and the primary `/feedback` Session ID remains only in the
Devpost UI; none of those private submission values should be committed.

The Build Week story is available as a public-safe [project journey](docs/project-journey.md)
and [한국어 프로젝트 일대기](docs/project-journey.ko.md).

## Documentation map

| Reader job | Document |
| --- | --- |
| Install and operate in English | [User manual](docs/user-manual.md) |
| 한국어로 설치하고 복구하기 | [한국어 사용자 매뉴얼](docs/user-manual.ko.md) |
| Resolve a symptom safely | [Troubleshooting](docs/troubleshooting.md) |
| Look up tools, limits, and schemas | [Interface reference](docs/reference.md) |
| Modify and release the project | [Developer guide](docs/developer-guide.md) |
| Understand security boundaries | [Security and privacy](docs/security-and-privacy.md) |
| Understand how and why the project was built | [Project journey](docs/project-journey.md), [프로젝트 일대기](docs/project-journey.ko.md) |
| Contribute or report a vulnerability | [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md) |

## License

ContextGC is MIT licensed. See [LICENSE](LICENSE). Checked-in bundles also carry
the applicable [third-party notices](THIRD_PARTY_NOTICES.md).
