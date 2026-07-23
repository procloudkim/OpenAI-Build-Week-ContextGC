# Install ContextGC

ContextGC `0.1.13` is a prebuilt Codex plugin for Node.js 22.13 or newer. No
TypeScript build or separate OpenAI API key is required for normal plugin use.

## Before installation

- Install Git, Node.js 22.13 or newer, and Codex CLI.
- Clone the public `procloudkim/OpenAI-Build-Week-ContextGC` repository.
- Understand that checkpoints are plaintext local files and plugin hooks require
  inspection and trust.

## Clone and install

```powershell
git clone --branch v0.1.13 --depth 1 https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location context-gc
$manifest = Get-Content .\release\v0.1.13.sha256
foreach ($line in $manifest) {
  if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Malformed hash manifest.' }
  $expected, $path = $Matches[1], $Matches[2]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Hash mismatch: $path" }
}
'releaseHashesVerified=True'
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
codex plugin list
```

Stop on any hash mismatch. This consistency check proves that the five local
files agree with the tagged manifest; it does not authenticate the publisher
because the tag and manifest are not cryptographically signed.

Expected observable: the list contains:

```text
context-gc@context-gc-local  installed, enabled  0.1.13
```

If you already have the clone, run the final three commands from its root.

## Review hooks and start a fresh thread

Start a new Codex thread and open `/hooks`. Compare the displayed commands with
`hooks/hooks.json` in this repository. Trust the definition only when it
matches. Plugin installation alone does not authorize bundled hooks.
After approval, the reviewed ContextGC definition must no longer appear pending
or skipped and should be active for its current hash; exact wording can vary by
Codex release.

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

Detailed status belongs in the repository README or an explicit status request, not in
repeated lifecycle output.

## Create the first checkpoint

In the new trusted thread, ask:

```text
Use ContextGC to inspect this task's context health and create a reversible
checkpoint. Keep exact constraints protected and explain every externalization.
```

Confirm all of these before treating the setup as complete:

- the tool returns a checkpoint UUID;
- the injected Task Frame's `contextgcStoreId` and the MCP result's `storeId`
  report the same opaque 16-hex digest;
- normal tool calls omit `dataDir` and use the installed plugin's inferred
  private store;
- `contextgc_status` reports that UUID as `latestCheckpointId` and reports
  `latestCheckpointStatus: verified`;
- a new thread loads only the bounded, integrity-verified Task Frame.

Preserve important checkpoint UUIDs. ContextGC `0.1.13` does not expose a public
checkpoint-list command.

Redaction takes precedence over exact retention. If a protected exact value is
redacted, its original bytes are not checkpoint-recoverable and that source is
not eligible for protected exact EXTERNALIZE advice. Keep secrets in an
approved secret manager rather than a Task Frame.

On an empty store, the first writable user turn may request one bootstrap
checkpoint without exposing a path. Plan mode defers that mutation for the
turn. Automatic PreCompact remains fail-closed until checkpoint, snapshot, and
hook-state persistence all verify.

After setup, checkpoint freshness is advisory rather than blocking. If recent
work outgrows the verified Task Frame, ContextGC snapshots that frame as a
fallback, permits the host-initiated native compaction, and emits only a bounded coverage notice.
Integrity or persistence failures still block automatic compaction.

When updating from a markerless checkpoint created by an earlier build, legacy content is not
injected. Create a new checkpoint only from currently verified facts and do not
claim that earlier context was recovered automatically.

## Run the deterministic demo without installing

```powershell
node scripts/contextgc.bundle.mjs simulate
```

Expected observable: all three frozen policies report 3/3 verified tasks and
the receipt hash equals
`f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd`.
Compare it with the checked-in
[benchmark receipt](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/output/benchmark/benchmark-report.json). This is
synthetic regression evidence. It
does not invoke native Codex compaction, make an API call, or estimate Codex
credits.

## Update

```powershell
$targetVersion = 'v0.1.13'
git fetch --tags --prune
git checkout --detach $targetVersion
node scripts/contextgc.bundle.mjs --version
codex plugin add context-gc@context-gc-local
codex plugin list
```

Expected observable: the ContextGC row reports the version declared by the
updated plugin manifest. If it remains stale, close active Codex processes,
back up the store using the local-only workflow below, then run `plugin remove`
followed by `plugin add`. Start another new thread and repeat the hook and
model-visibility checks. A
maintainer must assign a new plugin version when installed bytes change; do not
manually overwrite Codex's versioned cache.

## Uninstall

Do not assume what a future Codex version does with plugin data. Before removal,
record the opaque `storeId` from `contextgc_status`; if the data must survive,
close Codex and back it up first. To resolve the exact store locally, copy the
installed ContextGC `PATH` from `codex plugin list` below; never paste either
path into a prompt or report:

```powershell
$expectedStoreId = 'PASTE THE 16-HEX STORE ID FROM contextgc_status'
$contextGcPluginRoot = 'PASTE THE INSTALLED CONTEXTGC PATH'
if ($expectedStoreId -notmatch '^[a-f0-9]{16}$') { throw 'Invalid expected storeId.' }
$bundle = Join-Path $contextGcPluginRoot 'scripts\contextgc.bundle.mjs'
$rawStatus = node $bundle status --cwd $contextGcPluginRoot --compact
if ($LASTEXITCODE -ne 0) { throw "ContextGC status failed: $LASTEXITCODE" }
$localStatus = $rawStatus | ConvertFrom-Json
$dataDir = [IO.Path]::GetFullPath([string]$localStatus.data.root)
$normalized = if ($env:OS -eq 'Windows_NT') {
  $dataDir.ToLower([Globalization.CultureInfo]::GetCultureInfo('en-US'))
} else { $dataDir }
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $hex = [BitConverter]::ToString(
    $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized))
  ).Replace('-', '').ToLowerInvariant()
} finally { $sha.Dispose() }
if ($hex.Substring(0, 16) -cne $expectedStoreId) {
  throw 'Store mismatch; abort backup, uninstall, and erasure.'
}
$localStatus.data | Select-Object initialized,latestCheckpointId,latestCheckpointStatus,checkpointCount
```

Here `--compact` means compact JSON formatting; it does not invoke native
compaction. Inspect `$dataDir` locally, close all writers before copying it,
verify the backup by relative file names, sizes, and SHA-256 hashes, and delete
only that exact reviewed directory if erasure is intended. Never delete its
parent, a repository root, the user profile, or the Codex home directory.

Only after the ID check and any required verified backup, remove the plugin:

```powershell
codex plugin remove context-gc@context-gc-local
codex plugin marketplace remove context-gc-local
```

## Next references

- [English user manual](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/docs/user-manual.md)
- [한국어 사용자 매뉴얼](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/docs/user-manual.ko.md)
- [Troubleshooting](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/docs/troubleshooting.md)
- [Interface reference](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/docs/reference.md)
- [Security and privacy](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/docs/security-and-privacy.md)
