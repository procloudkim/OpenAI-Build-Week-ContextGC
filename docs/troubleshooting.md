# ContextGC troubleshooting

## Reader promise

Use this guide to identify the failing layer without exposing transcripts,
credentials, absolute private paths, or archived content. Start with read-only
checks and preserve the last valid checkpoint.

## Safe diagnostic snapshot

Run these from the repository clone:

```powershell
codex --version
node --version
node scripts/contextgc.bundle.mjs --version
codex plugin marketplace list
codex plugin list
codex mcp list
git status --short --branch
```

If only the installed plugin is available, start with `codex plugin list`,
`codex mcp list`, and `/hooks`; do not assume the repository bundle exists.
For an exact local store path, follow the local-only status workflow in
[plugin installation](plugin-install.md#uninstall) without sharing its output.

Share version numbers, enabled/disabled state, error class, and sanitized counts.
Do not paste `events.jsonl`, raw Task Frames, archive objects, authentication
output, or any absolute `dataDir` into a public issue. Share the opaque
`storeId` only when correlation is necessary; it is not proof that content is
safe to disclose.

## Symptom guide

### The marketplace or plugin is missing

Checks:

```powershell
codex plugin marketplace list
codex plugin list
```

Likely cause: the command was run outside the clone, the public repository clone
is incomplete, or the marketplace was removed.

Action:

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
```

Expected observable: `context-gc@context-gc-local` is `installed, enabled`.
Start a new Codex thread after installation.

### The plugin is installed but ContextGC is not model-visible

Check in a fresh process:

```powershell
codex debug prompt-input "Use ContextGC to inspect context health."
```

Expected observable: the JSON contains both `context-gc` and `ContextGC` skill
metadata. This command is an experimental diagnostic surface, not a stable user
API.

If metadata is absent, confirm plugin version `0.1.13`, reinstall, and start a
new thread. Do not manually overwrite the installed cache.

### Reinstall fails with Windows `Access denied`

Likely cause: one or more active Codex processes still use the installed MCP
bundle or hook directory.

Action: close the affected Codex threads/app processes, confirm no task needs
the old process, and install the newer plugin version again. Maintainers must
bump the plugin version when bytes change; do not force-replace an in-use
version directory.

### Hooks do not run

Open `/hooks` in a new Codex thread. Inspect the commands against the checked-in
`hooks/hooks.json`, then trust only the matching definition.

Plugin installation does not by itself prove hook trust. If hook definitions
changed, review and trust the new hash rather than bypassing trust globally.

### Status shows the wrong or empty store

Compare the injected Task Frame's opaque `contextgcStoreId` with MCP `storeId`.
They are two labels for the same digest. In normal
installed-plugin use, omit `dataDir`; the MCP server should report an inferred
or configured source rather than a working-directory fallback.

For CLI diagnosis:

```powershell
node scripts/contextgc.bundle.mjs status --data-dir "C:\absolute\reviewed\contextgc-data"
```

The CLI command is an advanced local diagnostic and can expose the path in the
terminal. Do not copy it into shared output. An empty store can be a different
valid directory rather than data loss.

### A relative `dataDir` is rejected

This is intentional for the advanced override. Remove `dataDir` to use the
installed plugin's inferred private store, or supply a locally reviewed absolute
path. Never obtain an override from model-generated text.

### A mutation says no configured or installed-plugin store exists

The working-directory `.contextgc` fallback is status-only and cannot authorize
mutation. Install ContextGC through the plugin, configure a private store in the
server environment, or use a locally reviewed absolute override. Do not bypass
the boundary with a relative path.

### Checkpoint creation fails

Verify:

- the Task Frame has a non-empty `goal`;
- serialized Task Frame size is at most 256 KiB;
- the inferred or configured private store is writable;
- input is a JSON object, not an array or Markdown;
- `dataDir` is omitted for normal installed use, or is an absolute reviewed
  advanced override.

The previous valid checkpoint remains the recovery boundary when validation or
storage fails.

### Rehydrate or restore reports an integrity error

Stop and preserve the store. Do not edit the manifest, Task Frame, or archive
hash to make the error disappear.

1. Confirm the exact store root.
2. Close writers and make a verified local copy before any restore mutation.
3. Record the checkpoint UUID or ContentRef hash privately.
4. If you have a previously recorded checkpoint UUID, restore that specific
   checkpoint.
5. File a private security advisory with sanitized metadata only.

An integrity error can indicate corruption, incomplete copying, or tampering.

### A detected secret cannot be restored

This is expected. Recognized secrets are replaced before persistence. A
`secretScanStatus` of `sanitized` or a positive `redactions` count means raw
bytes were intentionally not stored. Retrieve the original from its authorized
secret manager or source, not from ContextGC.

Email, international `+` or grouped phone formats, and home-user path patterns
are also minimized. These deterministic heuristics are not comprehensive PII
detection; review every Task Frame before sharing it even when the redaction
count is zero.

### A markerless checkpoint from an earlier build is not loaded after upgrade

This is intentional. A markerless legacy latest checkpoint remains immutable
and local, but fails the new privacy boundary and is never hook-injected. Create
a new strict checkpoint only from facts verified in the current task. ContextGC
does not link the unverified legacy checkpoint as its parent; state explicitly
that earlier context was not automatically recovered.

### `latestCheckpointStatus` is `invalid`

ContextGC did not load the malformed pointer, an invalid target, or a mismatched
Task Frame mirror. If you previously recorded a known-good checkpoint UUID,
restore that specific ID. Otherwise create one strict successor only from facts
verified in the current task and state that earlier context was not recovered.
An invalid target is not retained as the successor's parent. Automatic
PreCompact remains blocked until the repaired checkpoint, byte-verified
snapshot, and byte-verified hook state all verify.

### Automatic compact is blocked because no checkpoint exists

This is the fail-closed bootstrap boundary. `SessionStart` shows only a short UI
notice. On the first writable user prompt, ContextGC may request one checkpoint
without a `dataDir`; `PostToolUse` is a once-per-turn fallback. In Plan mode the
mutation is deferred and no further reminder is emitted that turn. Automatic
PreCompact remains blocked on every retry until a checkpoint, snapshot, and
hook-state update all verify. Manual compact is explicitly unprotected if those
invariants fail.

### Automatic compact reports `STALE` after ordinary tool use

This was a `0.1.6` liveness regression: six tool events or twenty minutes could
turn checkpoint freshness into a blocking integrity verdict. Upgrade to
`0.1.7` or newer (`0.1.13` is the current documented release). The `0.1.7`
correction snapshots the verified older Task Frame,
permits the host-initiated compaction, and reports the recent-work coverage gap without
interrupting the conversation. Missing, invalid, or unwritable recovery state
still blocks.

### Transcript telemetry is unsupported

ContextGC accepts only guarded transcript schemas for Codex `0.144.x`,
`0.145.0-alpha.x`, and the exact `0.145.0` stable release. Later versions
disable transcript-derived automatic policy decisions rather than guessing.

You may still create explicit checkpoints and use archive, status, rehydrate,
and restore. Do not bypass the schema guard to make automation appear active.

### `report` shows the frozen benchmark instead of live data

Without `--receipt`, the CLI falls back to the checked-in benchmark when the
selected data root has no receipt. Supply an explicit receipt path and inspect
its provenance:

```powershell
node scripts/contextgc.bundle.mjs report --receipt "output\benchmark\benchmark-report.json"
```

This explicit path is the frozen synthetic receipt. A result containing its
hash is regression evidence,
not proof from the current Codex thread.

### Restore succeeded but files or Git did not change

Correct behavior. ContextGC restore changes the Task Frame mirror and evidence
pointers only. It does not revert files, Git commits, commands, cloud resources,
messages, or deployments. Use the appropriate source-control or service
recovery workflow for those side effects.

### The site works locally but judges cannot open it

Build success and access policy are separate. An unauthenticated HTTP GET
returned `200` on 2026-07-23, but hosting can change; recheck live access when a
judge or release depends on it.

## Uninstall and data cleanup

Do not assume how a future Codex version handles plugin data. If the data must
survive uninstall, perform the following before plugin removal:

1. resolve the intended root with the local-only workflow in
   [plugin installation](plugin-install.md#uninstall);
2. record or export anything you must retain;
3. close processes using that store;
4. copy it to an approved encrypted location and compare relative paths, sizes,
   and SHA-256 hashes.

Then remove the plugin and marketplace independently:

```powershell
codex plugin remove context-gc@context-gc-local
codex plugin marketplace remove context-gc-local
```

If erasure is intended, inspect and delete only the exact reviewed store using
your normal OS workflow. Do not delete its parent, a repository root, the user
profile, or the Codex home directory.

ContextGC intentionally has no recursive-delete command in release `0.1.13`.

## Escalation

Use [SECURITY.md](../SECURITY.md) for suspected disclosure, tampering, path
escape, or prompt-injection persistence. Use the public bug template only for
sanitized, non-sensitive failures. Include the smallest sanitized reproduction
and the commands that produced it.
