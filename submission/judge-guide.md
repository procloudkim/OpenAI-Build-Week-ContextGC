# Judge guide

## Fastest public path

An unauthenticated HTTP GET returned `200` on 2026-07-23. This dated check is
not a guarantee of future hosting availability; the no-build path below remains
the reproducible fallback.

1. Open https://contextgc-build-week.trytrytry.chatgpt.site.
2. Choose each of the three frozen policies.
3. Inspect the protected invariant panel.
4. Use the labeled capability walkthrough to rehydrate evidence and restore a
   valid frame; these buttons illustrate the installed feature and are not a
   live benchmark run.
5. Confirm the separately verified synthetic receipt hash is
   `f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd`.
6. Open the matching checked-in
   [receipt](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/blob/v0.1.13/output/benchmark/benchmark-report.json).

The hosted demo uses synthetic data and cannot access a visitor's local Codex
files.

For the human problem and engineering chronology, read the public-safe
[project journey](../docs/project-journey.md).

## No-build deterministic path

Requirements: Git and Node.js 22.13 or newer. No dependency installation, API
key or rebuild is needed for this receipt path.

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
node scripts/contextgc.bundle.mjs simulate
```

Stop if any hash differs. This proves that the five checked-out files agree
with the tagged manifest; it does not authenticate the publisher because the
tag and manifest are not cryptographically signed.

The final release includes prebuilt MCP and CLI bundles. Building from source
is needed only to inspect or modify implementation code.

## Plugin test path

Requirements: Windows PowerShell and Codex CLI 0.145.0 for the verified install
path. Transcript telemetry supports only the allowlisted schemas documented in
the repository reference.

The repository README contains the final marketplace installation command. On
first use, inspect and trust `hooks/hooks.json`; Codex does not automatically
trust plugin-bundled hooks. Start a new Codex thread after installing or
updating the plugin. Expected observable: `/hooks` no longer shows the reviewed
ContextGC definition as pending or skipped and reports it active for the
current definition hash; wording can vary by Codex release.

Suggested prompt:

```text
Use ContextGC to inspect this task's context health, create a reversible
checkpoint, and explain which atoms are KEEP, SUMMARIZE, or EXTERNALIZE.
Omit dataDir, report only the opaque storeId, and do not reveal local paths.
Do not claim native compaction occurred unless a real PostCompact event exists.
```

## Evidence boundary

- `usageProxy` is a transparent token-derived comparison unit.
- `estimatedApiEquivalentUsd` appears only when an explicit rate card is
  supplied.
- ChatGPT/Codex credits remain unknown because no deterministic public
  conversion is documented.
- Synthetic replay proves deterministic policy behavior, not statistical
  generalization to every software task.
- The stable plugin prepares, protects and restores context. It never initiates
  native compaction; `PreCompact` may permit or block a host-initiated event.
- Installed-plugin tools infer a private store and return an opaque `storeId`;
  an absolute `dataDir` is an advanced local override and must not be shown.
- Credential, email, international/grouped-phone and home-path redaction is
  deterministic but heuristic. It is not a claim of comprehensive PII
  detection.
- The owner-observed lifecycle record reports one real compact and one fresh-
  thread recovery. It is a bounded operator observation, not an independently
  reproduced production benchmark or an authoritative live token-savings receipt.
- Raw Session IDs, checkpoint IDs, store IDs, account details, and local paths
  are intentionally excluded from public submission evidence. The suggested
  prompt returns an opaque store ID only in the judge's private runtime output;
  do not copy it into public evidence.
