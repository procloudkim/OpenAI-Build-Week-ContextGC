# Three-minute demo script

Target runtime: 2:35–2:50. Use English narration. Record the working product,
not slides alone. Do not show account UI, local paths, raw session/checkpoint/
store identifiers, or private repository invitations.

## 0:00–0:20 — The user problem

“I work across several long Codex projects. Careful users keep a Markdown
handoff, compact around a personal threshold, and explain the task again in a
fresh thread. ContextGC keeps that good workflow but adds a verified safety
layer, so exact goals, constraints, and evidence do not depend on one manual
summary.”

Show the ContextGC README and the small architecture flow.

## 0:20–0:45 — What ContextGC controls

“ContextGC does not replace Codex's native compactor. It is a local-first Codex
plugin with a skill, six lifecycle hooks, and six MCP tools. It classifies task
state as KEEP, SUMMARIZE, or EXTERNALIZE. There is no DROP action for protected
state.”

Show the installed plugin and `/hooks`. Crop or blur unrelated plugin names and
any user-specific terminal chrome.

## 0:45–1:25 — Real installed lifecycle

Show a prepared, sanitized recording of:

1. all six ContextGC hooks active;
2. `contextgc_status` reporting a verified checkpoint with identifiers hidden;
3. native `/compact` completing; and
4. a fresh thread receiving the protected Task Frame through `SessionStart`.

Narration:

“Before compaction, ContextGC verifies the checkpoint, snapshot, and hook state.
If any part is missing, automatic compaction stays paused. In my acceptance
test, native compaction completed and a completely fresh thread recovered the
same verified protected frame without exposing a local absolute path.”

## 1:25–1:55 — Reversible evidence

Use the public synthetic capability walkthrough to show an invariant,
rehydration, and restore.

“Externalized evidence is sanitized, stored locally by SHA-256, and loaded only
when needed. Restore selects verified context metadata and evidence pointers. It
does not pretend to roll back Git, files, commands, or remote side effects.”

Clearly label this footage `SYNTHETIC CAPABILITY WALKTHROUGH`.

## 1:55–2:20 — Reproducible no-build evidence

Run:

```powershell
node scripts/contextgc.bundle.mjs simulate
```

Show the matching receipt hash on the site.

“Three frozen coding traces use hidden deterministic oracles, not an LLM judge.
Every policy retained every critical fact. ContextGC used 3.20% less UPVS than
the fixed policy but more than the frozen manual schedule, so I do not claim
proven live token or credit savings.”

## 2:20–2:45 — Codex and GPT-5.6

“Codex with GPT-5.6 was my primary engineering collaborator. I used it to frame
the architecture, verify official integration boundaries, implement the plugin,
build deterministic tests, run adversarial privacy and integrity reviews, and
repair the PreCompact liveness failure that appeared during real use. I made the
product decisions: Windows-first, local-first, reversible automation, no
automatic deletion, and no unsupported credit estimate.”

## 2:45–2:50 — Close

“ContextGC is a seatbelt for long Codex work: keep the truth, compress the
noise.”

End on the public repository and demo URLs only after both have passed signed-
out access checks.
