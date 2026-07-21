# Changelog

All notable ContextGC changes are recorded here. Dates use ISO 8601.

## Unreleased

## [0.1.7] - 2026-07-21

### Fixed

- Treat checkpoint freshness as an advisory coverage signal instead of an
  integrity failure. Automatic `PreCompact` now preserves a byte-verified
  fallback snapshot and proceeds, so six tool events or twenty minutes of work
  cannot interrupt the conversation.
- Keep fail-closed blocking for missing or invalid checkpoints and failed
  snapshot or hook-state persistence. When the preserved fallback predates
  recent work, `PostCompact` reports the boundary in two short lines without
  identifiers or local paths.

## [0.1.6] - 2026-07-21

### Changed

- Make ordinary `Stop`, prompt, and tool lifecycle events user-silent; checkpoint
  freshness is now enforced only at the real `PreCompact` safety boundary.
- Limit every user-visible hook notice to three lines and 240 characters. A
  healthy compaction uses one line, while recovery and integrity failures remain
  actionable without exposing identifiers or local paths.
- Show the trust/README/Star onboarding once per installed version, keep later
  fresh-session notices compact, and suppress onboarding on resume.
- Report successful restore scope once: Task Frame metadata and evidence
  pointers are restored, while Git, files, commands, and external side effects
  are not.

### Fixed

- Remove the recurring long `Stop` continuation prompt that could add model
  turns after six tool events even when observed telemetry was unavailable.
- Remove repeated SessionStart and Stop status banners from the hook manifest.

## [0.1.5] - 2026-07-19

### Changed

- Add user-first English and Korean manuals, interface reference,
  troubleshooting, contributor/security guidance, and GitHub automation.
- Replace model-visible local paths with opaque store identifiers, make the
  installed plugin's private store the default, and expand deterministic
  credential and personal-data redaction heuristics.

### Fixed

- Bootstrap an empty private store once on the first writable turn, defer in
  Plan mode, and keep automatic PreCompact fail-closed until the checkpoint,
  snapshot, and hook state all verify.
- Reject unsafe Task Frame paths and reject or discard unknown fields before checkpoint writes;
  treat redaction as limited deterministic minimization rather than
  comprehensive PII detection.
- Require the `deterministic-minimization-v1` checkpoint marker. Legacy latest
  checkpoints remain immutable and may be superseded, but are not injected as
  trusted context after upgrade.
- Keep status, explicit restore, and strict checkpoint creation usable when the
  latest pointer is malformed; report its state as `invalid` instead of loading
  or mirroring it.
- Require a fully verified parent, publish the Task Frame mirror and latest
  pointer transactionally with mirror rollback, and make status verify both
  canonical checkpoint bytes and mirror bytes.
- Reread and byte-compare hook state after atomic writes, discard unknown state
  fields on load, suppress duplicate same-turn bootstrap prompts, and fail
  closed for unrecognized PreCompact triggers through catch-all lifecycle
  routing.
- Hash transcript session identifiers before ledger persistence and redact
  explicit local `file:` and percent-encoded `file%3A` URIs in full while
  preserving HTTP(S) route negative controls.
- Discard EXTERNALIZE options without a syntactically content-addressed
  `archiveRef`; keep planner metadata explicitly caller-asserted until a runtime
  ContentRef is verified independently.

## [0.1.1] - 2026-07-18

### Added

- Deterministic KEEP/SUMMARIZE/EXTERNALIZE optimizer and PREPARE/HOLD trigger.
- Local content-addressed archive, checkpoints, bounded rehydration, and restore.
- Six MCP tools, a bundled CLI, ContextGC skill, and Codex lifecycle hooks.
- Frozen synthetic benchmark with hidden-use oracles and negative controls.
- Sanitized evidence site, research reports, and Build Week submission material.

### Security

- Fail-closed protected/exact retention gates.
- Secret redaction status and byte-recovery boundaries.
- Checkpoint, mirror, manifest, and archive integrity validation in hooks.
- Absolute MCP `dataDir` requirement and bounded inputs.

### Known limitations

- No direct native `/compact` actuation.
- No deterministic token-to-Codex-credit conversion.
- No production-generalization claim beyond the frozen synthetic fixtures.
- Plaintext local archives; encryption at rest is outside the MVP.
