# ContextGC architecture

ContextGC is a local-persistence control plane around Codex context compaction. It does
not replace Codex's encrypted native compaction state and it does not promise to
invoke `/compact` in arbitrary existing Codex threads.

## Data flow

```text
Codex hooks / recorded trace
          |
          v
append-only event ledger -----> sanitized content-addressed archive
          |                               |
          v                               |
schema-guarded telemetry                  |
          |                               |
          v                               |
MemoryAtom set -> invariant gate -> policy optimizer
                                      |   |   |
                                      |   |   +-- EXTERNALIZE (reversible)
                                      |   +------ SUMMARIZE (non-exact only)
                                      +---------- KEEP
                                             |
                                             v
                                  TaskFrame + Receipt + checkpoint
                                             |
                          bounded injection / rehydrate / restore
```

The event ledger and sanitized archive are evidence. The TaskFrame is a compiled
working set. A TaskFrame can point back to byte-exact non-secret source. If a
secret pattern is detected, the persisted value is intentionally redacted and
the receipt records that it is not byte-restorable; protected exact atoms with
redactions fail closed instead of receiving EXTERNALIZE advice.

## Layers

### Deterministic core

The core owns domain types, usage-proxy calculations, memory selection,
the break-even trigger and safety gates. It never reads Codex private files and
never performs I/O. The optimizer's output is a recommendation and checkpoint
preparation decision, not a native compaction command.

### Local runtime

The runtime selects a store from an explicit/configured root, `PLUGIN_DATA`,
`CONTEXTGC_HOME`, or a conservatively inferred installed-plugin data location.
An ordinary working-directory `.contextgc/` is a read-only/status fallback: it
cannot authorize writes. Mutations require one of the reviewed store sources
above. The runtime provides:

- append-only JSONL events;
- SHA-256 addressed immutable, sanitized source objects;
- atomic checkpoint manifests;
- bounded rehydration;
- rollback with hash verification;
- deterministic credential, email, international/grouped-phone, and home-path
  minimization before durable metadata is written;
- a version-gated adapter for observed Codex JSONL telemetry.

The Codex transcript is documented as an unstable convenience interface.
Unknown shapes therefore disable automatic policy actions instead of being
silently guessed.

### Plugin boundary

The plugin combines a skill, MCP tools and trusted lifecycle hooks.

- `PostToolUse` captures only cheap factual metadata and never calls an LLM.
- `PreCompact` verifies that the latest TaskFrame matches its checkpoint
  manifest and content-addressed archive object before snapshotting it.
- `PostCompact` records the trigger and measurement boundary and emits one
  bounded result notice.
- `SessionStart` and `UserPromptSubmit` inject only a bounded TaskFrame.
- `SessionStart` reports an empty-store condition only as a short UI message.
  The first writable `UserPromptSubmit` may request one checkpoint without
  exposing a storage path; `PostToolUse` is a once-per-turn fallback.
- Plan mode emits a non-mutating defer notice and suppresses checkpoint
  reminders for that turn.
- `Stop` records bounded metadata but never requests a model continuation.
  Tool-count and elapsed-time pressure are evaluated only at the real
  `PreCompact` boundary. If recent work is not represented by the verified
  checkpoint, freshness is recorded as an advisory coverage gap; the hook
  preserves a byte-verified fallback and permits host-initiated native compaction. Missing or
  invalid checkpoints and failed snapshot/state persistence remain fail-closed.

Every user-visible hook notice is limited to three lines and 240 characters.
Healthy prompts, tools, and Stop events are silent. The full bounded Task Frame
remains model context rather than a repeated user-facing transcript.

Installing or enabling a plugin does not automatically trust its hooks. The
user must inspect and trust the current hook definition in Codex.

### Evaluation and demo

Three synthetic, deterministic software-engineering traces are replayed under
manual, fixed-threshold and adaptive policies. Hidden oracles check required
facts at their late-use turns, and corrupt-protected-fact negative controls
prove the scorer rejects loss. There is no model-as-judge. The public site
loads only sanitized fixture receipts and cannot read a visitor's Codex files.

## Mathematical contract

At turn `t`, the policy state is:

```text
x_t = (active tokens, growth, remaining horizon, cache reads/writes,
       lifecycle phase, memory atoms)
```

The action space is `KEEP | SUMMARIZE | EXTERNALIZE`. `DROP` is deliberately
absent. Protected exact values may be kept or receive an advisory EXTERNALIZE
recommendation, never a summary. The selector discards EXTERNALIZE when a
syntactically content-addressed `archiveRef` is absent, but MCP plan metadata is
caller-asserted and the planner neither verifies that reference against the
runtime store nor performs externalization. A caller must independently match
the recommendation to a ContentRef returned by `contextgc_archive` before
acting on it.

Checkpoint preparation requires:

```text
predicted future savings
  > checkpoint cost + cache churn + rehydration cost + safety margin
```

Risk and invariant gates override this inequality. Hysteresis and cooldown
prevent repeated actions around one threshold. The implementation is a bounded
deterministic controller, not reinforcement learning and not a claim of global
mathematical optimality.

## Public interfaces

The CLI exposes `status`, `simulate`, `checkpoint`, `restore` and `report`.
The MCP server exposes `status`, advisory `plan`, runtime-verified text
`archive`, `checkpoint`, bounded `rehydrate`, and `restore` tools. Installed
plugin calls infer their private local store and return an opaque `storeId`
instead of a path; explicit absolute-path selection is an advanced override.
All state-changing operations return a checkpoint, content reference, or
receipt identifier. The economic fields are
`usageProxy` and optional `estimatedApiEquivalentUsd`. Codex/ChatGPT credits are
`null` with a machine-readable `public_conversion_unavailable` reason because
OpenAI does not publish a deterministic token-to-credit conversion.

## Failure behavior

| Failure | Behavior |
| --- | --- |
| Unknown transcript schema | Telemetry marked unsupported; automatic action disabled |
| Missing or corrupt archive object | Restore fails with hash-integrity error |
| Secret detected in protected exact atom | Persist sanitized evidence; discard protected-exact EXTERNALIZE advice |
| Missing or unverified planner `archiveRef` | Discard when absent; otherwise label the recommendation caller-asserted until independently matched to a runtime ContentRef |
| Malformed pointer, invalid target, or mirror mismatch | Report `latestCheckpointStatus: invalid`; allow a known-good explicit restore or a strict successor without loading or linking the invalid target |
| Mirror or latest-pointer publication fails | Do not report the successor as latest; restore the previous mirror when pointer publication fails |
| Invalid model-produced TaskFrame | Previous valid checkpoint retained |
| Empty store before automatic compact | Automatic compact remains blocked on every retry until checkpoint, snapshot, and hook-state persistence all verify |
| Checkpoint request while in Plan mode | Mutation is deferred and reminders are suppressed for that turn |
| Protected atom cannot fit budget | KEEP-all fail-closed result |
| Repeated Stop hook | Observability-only; never creates a continuation |
| Pricing table missing | Token report and usage proxy remain; API-equivalent estimate omitted |
| Native compaction cannot be actuated | Recommendation and safety checkpoint remain usable |
