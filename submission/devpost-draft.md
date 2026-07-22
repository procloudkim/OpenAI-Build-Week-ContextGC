# Devpost draft

Read this aloud before submission. Keep the owner's natural voice. Values marked
`UI_ONLY` belong only in Devpost and must never be committed.

Devpost project URL: https://devpost.com/software/contextgc

## Project name

ContextGC

## Track

Developer Tools

## One-line description

ContextGC keeps critical goals, constraints, and evidence recoverable when a
long Codex task compacts or moves to a fresh thread.

## Inspiration

I work on several AI-assisted projects at the same time. The careful way to
handle a long session is to maintain a Markdown handoff, compact around a
personal threshold, and explain the state again in the next thread. That works,
but it makes the user operate a second system just to keep the AI on track.

I wanted to know whether that ritual could become safer and less repetitive.
Research changed my first idea. A Codex plugin cannot honestly claim that it
replaces the native compactor, and fewer tokens do not prove that exact coding
constraints survived. So I built a narrower tool: a reversible control plane
around compaction.

## What it does

ContextGC packages a Codex skill, six lifecycle hooks, and six local MCP tools.
It turns the current task into a bounded Task Frame and separates information
into three actions:

- `KEEP` exact goals and constraints active;
- `SUMMARIZE` eligible explanation; and
- `EXTERNALIZE` sanitized source to a local hash-addressed archive.

There is deliberately no `DROP` action. Before compaction, ContextGC verifies
the checkpoint, snapshot, and hook state. If that protection boundary is not
valid, automatic compaction stays paused. After compaction or in a fresh thread,
it can load the verified Task Frame and selectively rehydrate archived evidence.

Normal installed use keeps data local. Model-visible results contain an opaque
store ID rather than an absolute path. Common credential, email, phone, and home
path patterns are minimized before persistence, but this is not a claim of
complete PII detection or encryption.

## What I demonstrated

The release was tested in two different ways.

First, three frozen software-engineering traces compare a manual schedule, a
fixed 75% threshold, and the adaptive ContextGC policy. Hidden deterministic
oracles check exact facts and forbidden changes; an LLM does not grade its own
work. Every policy completed 3/3 tasks with 100% critical retention. ContextGC
used 3.20% less UPVS than the fixed policy, but 9.36% more than the frozen manual
schedule. That means the project's 15%-versus-both savings gate failed.

Second, I tested the installed plugin through the real Codex lifecycle. I
reviewed and trusted all six hooks, created a verified checkpoint, completed
native compaction, and opened a completely fresh thread. SessionStart recovered
the same protected Task Frame, and the acceptance report exposed no local
absolute path.

This is why I describe ContextGC as a continuity and audit tool, not as a proven
credit-saving product.

## How I built it

- TypeScript policy and reversible local runtime
- SHA-256 content-addressed evidence archive
- Atomic checkpoint, mirror, and latest-pointer publication
- Codex skill, MCP server, CLI, and lifecycle hooks
- Frozen fixtures, hidden deterministic oracles, and negative controls
- React/Vinext evidence explorer deployed with OpenAI Sites
- Prebuilt CLI and MCP bundles for no-rebuild judge testing

Hardening work covered stale plugin caches, corrupt checkpoint lineage,
transactional publication, bounded state reads, unknown compaction triggers,
and normalized local file URI redaction.

## How I used Codex and GPT-5.6

Codex with GPT-5.6 was my primary engineering collaborator. I used it to turn
the original idea into a testable architecture, verify OpenAI's documented
integration boundaries, implement the TypeScript core and plugin, construct
fixtures and tests, run adversarial privacy and integrity reviews, repair a real
PreCompact liveness deadlock, and integrate the release package.

I made the binding product decisions: Windows-first, local-first persistence,
no automatic deletion, a reversible checkpoint boundary, no unsupported
token-to-credit estimate, and an honest failed economics gate.

The product itself may ask the active Codex model for one structured Task Frame
at a selected lifecycle boundary. Deterministic code validates that frame,
selects actions, stores evidence, and evaluates the frozen traces. The benchmark
contains no model-as-judge step and makes no out-of-band API call.

`UI_ONLY`: enter the primary build `/feedback` Session ID in Devpost. Never
paste it into this repository, the video, screenshots, or public discussion.

## Challenges

- Separating native compaction from the state a plugin can safely control
- Protecting exact software constraints without calling every summary lossless
- Making checkpoint publication recoverable under partial failure
- Preventing local paths and session metadata from leaking through the tool
- Comparing policies without turning a usage proxy into a billing claim
- Shipping a public package without exposing private development history

## What I learned

Compaction is not only a summarization problem. It is a control problem across
future work, exact invariants, cache continuity, retrieval cost, and recovery.
The best first version was not a grand memory theory. It was a small controller
whose decisions and failures could be inspected.

I also learned that a failed promotion gate is useful product information. The
manual policy remained more efficient on the frozen proxy, so ContextGC's
verified value is reducing memory-risk and recovery work. Live before/after
token receipts are the next measurement milestone.

## What's next

- Privacy-preserving live CompactionReceipts
- Markdown handoff import and export
- Calibration on consented real task traces
- User-configurable lifecycle and risk policies
- Version-pinned managed mode for app-server-owned threads
- Cross-platform hook packaging after the Windows contract is stable

## Links

- Repository: https://github.com/procloudkim/OpenAI-Build-Week-ContextGC
- Live demo: https://contextgc-build-week.trytrytry.chatgpt.site
- Video: `UI_ONLY: retained only in the submitted Devpost form; do not commit the URL`
- Codex `/feedback` Session ID: `UI_ONLY`

## Required final checks

The owner reported completing submission. For any organizer-requested revision,
re-open the live [rules](https://openai.devpost.com/rules),
[updates](https://openai.devpost.com/updates), and announcements first. Keep the
video URL and `/feedback` Session ID in Devpost UI only.
