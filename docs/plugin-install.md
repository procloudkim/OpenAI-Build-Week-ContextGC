# Install ContextGC

ContextGC `0.1.7` is a prebuilt Codex plugin for Node.js 22.13 or newer. No
TypeScript build or separate OpenAI API key is required for normal plugin use.

## Before installation

- Install Git, Node.js 22.13 or newer, and Codex CLI.
- Clone the public `procloudkim/OpenAI-Build-Week-ContextGC` repository.
- Understand that checkpoints are plaintext local files and plugin hooks require
  inspection and trust.

## Clone and install

```powershell
git clone https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location context-gc
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
codex plugin list
```

Expected observable: the list contains:

```text
context-gc@context-gc-local  installed, enabled  0.1.7
```

If you already have the clone, run the final three commands from its root.

## Review hooks and start a fresh thread

Start a new Codex thread and open `/hooks`. Compare the displayed commands with
`hooks/hooks.json` in this repository. Trust the definition only when it
matches. Plugin installation alone does not authorize bundled hooks.

For model-visibility diagnosis in a fresh process:

```powershell
codex debug prompt-input "Use ContextGC to inspect context health."
```

Expected observable: the JSON contains `context-gc` and `ContextGC` skill
metadata. `prompt-input` is an experimental diagnostic command, not the normal
user workflow.

## Notification behavior

- The first verified startup after a newly trusted ContextGC version shows one
  three-line onboarding notice with the README link.
- Later fresh startups show a two-line lifecycle wireframe. Resume is silent.
- Healthy prompts, tool calls, and `Stop` events are silent.
- A protected compaction reports one line. A recovery or integrity warning uses
  at most three lines.
- Successful restore reports its scope without identifiers: Task Frame metadata
  and evidence pointers are restored; Git, files, commands, and external side
  effects are not.

Detailed status belongs in this README or an explicit status request, not in
repeated lifecycle output.

## Create the first checkpoint

In the new trusted thread, ask:

```text
Use ContextGC to inspect this task's context health and create a reversible
checkpoint. Keep exact constraints protected and explain every externalization.
```

Confirm all of these before treating the setup as complete:

- the tool returns a checkpoint UUID;
- the hook and MCP results report the same opaque `contextgcStoreId`/`storeId`;
- normal tool calls omit `dataDir` and use the installed plugin's inferred
  private store;
- `contextgc_status` reports that UUID as `latestCheckpointId` and reports
  `latestCheckpointStatus: verified`;
- a new thread loads only the bounded, integrity-verified Task Frame.

Preserve important checkpoint UUIDs. ContextGC `0.1.7` does not expose a public
checkpoint-list command.

On an empty store, the first writable user turn may request one bootstrap
checkpoint without exposing a path. Plan mode defers that mutation for the
turn. Automatic PreCompact remains fail-closed until checkpoint, snapshot, and
hook-state persistence all verify.

After setup, checkpoint freshness is advisory rather than blocking. If recent
work outgrows the verified Task Frame, ContextGC snapshots that frame as a
fallback, allows native compaction, and emits only a bounded coverage notice.
Integrity or persistence failures still block automatic compaction.

When updating from a markerless checkpoint created by an earlier build, legacy content is not
injected. Create a new checkpoint only from currently verified facts and do not
claim that earlier context was recovered automatically.

## Run the deterministic demo without installing

```powershell
node scripts/contextgc.bundle.mjs simulate
```

Expected observable: all three frozen policies report 3/3 verified tasks and
the receipt hash ends in `47ddd`. This is synthetic regression evidence. It
does not invoke native Codex compaction, make an API call, or estimate Codex
credits.

## Update

```powershell
git pull --ff-only
node scripts/contextgc.bundle.mjs --version
codex plugin add context-gc@context-gc-local
```

Start another new thread and repeat the hook and model-visibility checks. A
maintainer must assign a new plugin version when installed bytes change; do not
manually overwrite Codex's versioned cache.

## Uninstall

```powershell
codex plugin remove context-gc@context-gc-local
codex plugin marketplace remove context-gc-local
```

These commands do not delete checkpoints or archives. Run `contextgc_status`
to identify the store by opaque `storeId`. If deletion is required, use a local
advanced administrative workflow to inspect the exact target, and never paste
its absolute path into prompts, issues, or reports.

## Next references

- [English user manual](user-manual.md)
- [한국어 사용자 매뉴얼](user-manual.ko.md)
- [Troubleshooting](troubleshooting.md)
- [Interface reference](reference.md)
- [Security and privacy](security-and-privacy.md)
