# Judge guide

## Fastest public path

The project owner must complete a signed-out access check immediately before
submission. A checked-in URL is not proof of current visibility.

1. Open https://contextgc-build-week.trytrytry.chatgpt.site.
2. Choose each of the three frozen policies.
3. Inspect the protected invariant panel.
4. Use the labeled capability walkthrough to rehydrate evidence and restore a
   valid frame; these buttons illustrate the installed feature and are not a
   live benchmark run.
5. Inspect the separately verified synthetic receipt hash.
6. Open the matching checked-in receipt at
   https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.

The hosted demo uses synthetic data and cannot access a visitor's local Codex
files.

For the human problem and engineering chronology, read the public-safe
[project journey](../docs/project-journey.md).

## No-build deterministic path

Requirements: Git and Node.js 22.13 or newer. No dependency installation, API
key or rebuild is needed for this receipt path.

```powershell
git clone https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location context-gc
node scripts/contextgc.bundle.mjs simulate
```

The final release includes prebuilt MCP and CLI bundles. Building from source
is needed only to inspect or modify implementation code.

## Plugin test path

Requirements: Windows PowerShell and Codex CLI 0.144.5 for the verified install
path. Transcript telemetry supports only the allowlisted schemas documented in
the repository reference.

The repository README contains the final marketplace installation command. On
first use, inspect and trust `hooks/hooks.json`; Codex does not automatically
trust plugin-bundled hooks. Start a new Codex thread after installing or
updating the plugin.

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
- The stable plugin prepares, protects and restores context; native compaction
  actuation is not part of its required path.
- Installed-plugin tools infer a private store and return an opaque `storeId`;
  an absolute `dataDir` is an advanced local override and must not be shown.
- Credential, email, international/grouped-phone and home-path redaction is
  deterministic but heuristic. It is not a claim of comprehensive PII
  detection.
- The owner-observed lifecycle acceptance proved one real compact and one fresh-
  thread recovery. It did not produce an authoritative live token-savings
  receipt.
- Raw Session IDs, checkpoint IDs, store IDs, account details, and local paths
  are intentionally excluded from public submission evidence.
