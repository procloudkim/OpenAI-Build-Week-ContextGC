# From context anxiety to a reversible control plane

This is the public-safe story of how ContextGC was framed, narrowed, built, and
verified during OpenAI Build Week. It deliberately excludes private prompts,
session identifiers, local paths, account details, and raw transcripts.

## The starting point

The project began with a practical discomfort: long AI coding sessions become
harder to trust as context grows. Skilled users compensate by maintaining a
Markdown handoff, compacting near a personal threshold, and opening a fresh
thread with a carefully written state summary.

That workflow works, but it creates a second job for the user. While solving the
actual engineering problem, they must also operate a manual memory system:

- decide what must survive;
- copy exact values without mutation;
- distinguish current facts from stale attempts;
- remember when to checkpoint; and
- reconstruct the same state in the next thread.

The initial question was broader than the product that ultimately shipped:

> Could context cleanup be optimized so users do not have to run a manual
> compaction ritual every time a long task becomes crowded?

## Research changed the claim

Early research separated three mechanisms that are easy to conflate:

1. **Native compaction** produces a smaller continuation context.
2. **Task memory** decides which facts should remain available.
3. **Lifecycle control** determines when state must be protected and how it can
   be audited or recovered.

OpenAI's native compaction state is intentionally opaque. A normal Codex plugin
can observe and participate in lifecycle hooks, but it does not own arbitrary
existing threads or provide a documented command that forces native compaction.
Prompt-compression research also made a second point clear: fewer tokens do not
prove better task performance, especially when software work depends on exact
commands, paths, identifiers, and forbidden changes.

The project was therefore narrowed from “an optimal compressor” to a more
defensible product:

> A Codex-specific, auditable, reversible safety controller around native
> compaction.

## The human product decisions

The project owner made the following binding choices:

- build a Codex plugin rather than a standalone chat application;
- start Windows-first because that was the real development environment;
- keep persistence local and require no separate API key;
- never delete raw user data automatically;
- preserve a human-readable Markdown workflow instead of replacing it;
- reject unsupported token-to-credit conversion; and
- prefer a narrow falsifiable claim over a larger marketing claim.

These choices shaped every later engineering decision.

## Building the safety envelope

### 1. Typed memory instead of a free-form summary

ContextGC represents task state as MemoryAtoms and a bounded Task Frame.
Protected goals, constraints, exact identifiers, blockers, and authoritative
test outcomes cannot be silently dropped. The action set is deliberately
limited to `KEEP`, `SUMMARIZE`, and `EXTERNALIZE`; there is no `DROP` action.

### 2. Reversibility before automation

Externalized source is minimized, content-addressed with SHA-256, and retained
locally. A checkpoint connects the Task Frame to evidence pointers. Rehydration
loads only the required object, while restore selects a previously verified
frame. Restore does not pretend to undo Git, files, commands, or remote side
effects.

### 3. Lifecycle integration

Six Codex hooks form the control plane:

- `SessionStart` loads a verified bounded frame;
- `UserPromptSubmit` provides bounded context and bootstrap guidance;
- `PostToolUse` captures supported factual events;
- `PreCompact` verifies the protection boundary;
- `PostCompact` records completion and reports a bounded result; and
- `Stop` records metadata without forcing another model turn.

The most important behavior is fail-closed: automatic compaction remains paused
until the checkpoint, snapshot, and hook state all verify.

### 4. Privacy as an interface contract

The installed plugin infers its private local store and returns an opaque store
identifier instead of an absolute path. Raw session identifiers are hashed
before persistence. Task Frames use a closed schema, and explicit local file
URIs are redacted in full. These are deterministic data-minimization controls,
not a claim of comprehensive PII detection or encryption.

## The hardening cycle

The first working version was not treated as finished. Adversarial review found
several load-bearing failure modes:

- a stale versioned plugin cache could run older bytes;
- malformed or markerless checkpoints could enter successor lineage;
- mirror and latest-pointer publication could split;
- hook state could be written without byte-for-byte readback;
- unknown future compaction triggers could bypass the intended guard; and
- normalized file URI variants could expose a local path.

Each issue was converted into an invariant and a regression test. The release
version moved to `0.1.5` so Codex would load a new immutable plugin cache entry.
The final hook manifest routes every compaction trigger to code that fails
closed on unknown values.

Release `0.1.6` then tightened the human interface after real terminal use
showed that a long Stop continuation could obscure normal work. Healthy
lifecycle events became silent, user-visible notices were capped at three
lines, resume stopped repeating onboarding, and checkpoint freshness moved to
the actual PreCompact safety boundary.

That boundary still needed one more correction. A fresh-session trial showed
that `0.1.6` treated six tool events as if an intact checkpoint had failed
integrity, interrupting automatic compaction with `STALE`. Release `0.1.7`
separates semantic coverage from storage integrity: it preserves the verified
older frame as a fallback, permits the host-initiated native compaction, and reports the coverage
gap in two lines. Corruption and failed durable writes remain fail-closed.

Release `0.1.8` then made that advisory state agree across the PreCompact and
PostCompact audit events; it did not change the `0.1.7` liveness correction.
Release `0.1.9` validated the exact Codex CLI `0.145.0` stable transcript shape,
kept later unverified schemas fail-closed, and aligned the public installation,
privacy, checksum, and recovery documentation through zero-context cold reads.

## Evaluation without pretending

ContextGC replays three frozen software-engineering traces under manual,
fixed-threshold, and adaptive policies. Hidden deterministic oracles check exact
facts and forbidden changes; the model does not grade itself.

All three policies achieved 3/3 verified tasks and 100% critical retention. The
adaptive policy used 3.20% less UPVS than the fixed policy but 9.36% more than
the frozen manual schedule. It therefore failed the project's ambitious
15%-versus-both economics promotion gate.

That result changed the positioning rather than being hidden. ContextGC ships
as a safety and audit controller, not as a proven savings winner. Live Codex
credit savings remain unmeasured because the current surface did not provide an
authoritative per-run conversion or complete before/after token receipt.

## Real lifecycle acceptance

After the automated suite passed, the plugin was tested through the actual
Codex trust and lifecycle flow:

- all six bundled hooks were reviewed and activated;
- a verified checkpoint was created;
- native compaction completed with both compaction hooks active;
- a completely fresh thread loaded the same verified protected Task Frame;
- checkpoint and store correlation remained consistent; and
- no absolute local path appeared in the acceptance report.

The raw checkpoint, store, and session identifiers are intentionally excluded
from public artifacts.

## How Codex and GPT-5.6 contributed

Codex with GPT-5.6 was the primary engineering collaborator. It was used to:

- turn the product question into a testable architecture;
- verify current OpenAI integration boundaries;
- implement the TypeScript core, MCP server, hooks, CLI, and site;
- construct deterministic fixtures and negative controls;
- perform adversarial privacy and integrity review;
- repair the liveness deadlock and package-cache mismatch; and
- assemble reproducible judge and open-source documentation.

The project owner retained responsibility for product direction, privacy
boundaries, platform choice, release authority, and final submission. The
primary build `/feedback` Session ID is submitted only through Devpost and is
never part of this repository.

## What the project demonstrates

ContextGC is less a story about inventing a new memory theory than about
engineering discipline around an uncertain model boundary:

- narrow an attractive but unsupported claim;
- make exact user constraints non-negotiable;
- separate local proof from external release proof;
- convert review findings into executable invariants;
- preserve user privacy even in release metadata; and
- report a failed economic promotion gate honestly.

The next research milestone is a privacy-preserving live CompactionReceipt with
before/after context, checkpoint overhead, rehydration overhead, cache impact,
and explicit provenance. Until that exists, the product's strongest verified
benefit is continuity and recoverability, not a numerical claim about credits.
