# Security and privacy boundary

ContextGC handles transcripts, commands and tool metadata that may contain
source code, untrusted instructions or secrets. Persistence and deterministic
control are local-first, while Task Frames supplied to the active Codex session
are still processed by that session's model.

## Guarantees implemented by the project

- Sanitized objects are content-addressed and verified before restore.
- Durable events are append-only; checkpoints refer to immutable hashes.
- Deterministic heuristics redact known credential formats, secret-named JSON
  fields, email addresses, international `+` or grouped phone formats, and
  home-user path segments from persisted text and metadata.
- Public demo fixtures contain no real transcript text, encrypted compaction
  payload, absolute user path or account identifier.
- Unknown Codex transcript shapes cannot support EXTERNALIZE advice.
- Non-secret protected information is never irreversibly deleted; detected
  secret values are intentionally replaced before persistence.
- Normal installed-plugin MCP calls infer the private local store. Model-visible
  MCP output uses opaque `storeId` and the injected Task Frame uses
  `contextgcStoreId`, not an absolute local path.
- Persisted Task Frames use a closed schema. Active-file paths must be
  repository-relative and evidence pointers cannot be local absolute paths.
- Raw checkpoint and transcript source session identifiers are not persisted;
  compatible lower-level runtime input is stored only as a SHA-256 digest.
- New checkpoint manifests require the `deterministic-minimization-v1` marker;
  markerless legacy frames are not injected into model-visible context or
  linked as verified successor parents.
- Latest-pointer publication updates the bounded Task Frame mirror before the
  pointer and restores the previous mirror if pointer publication fails. Status
  verifies the canonical checkpoint, archive object, and mirror together.
- Automatic PreCompact rereads and byte-compares both its reversible snapshot
  and closed-schema hook state before allowing automatic compaction.

## Explicit non-guarantees

- Redaction is deterministic data minimization, not comprehensive PII or secret
  detection. Names, addresses, identifiers, proprietary facts, novel credential
  formats, and ambiguous phone/path forms can remain.
- Contiguous numeric IDs, IP addresses, date/hour strings, and `/home/` or
  `/Users/` route segments inside remote HTTP(S) URLs are deliberately preserved
  to limit false positives. Explicit local `file:` URIs, including
  percent-encoded `file%3A` forms, are redacted in full.
- `contextgc_plan` is advisory. Its archive reference and scan fields are
  caller-asserted and do not become runtime proof until independently matched
  to a ContentRef returned by `contextgc_archive`; the planner does not execute
  externalization.
- A detected secret is intentionally not byte-restorable. Receipts expose the
  redaction count and protected exact atoms with redactions are kept rather than
  treated as eligible for EXTERNALIZE advice.
- ContextGC cannot inspect or reconstruct Codex's encrypted native compaction
  payload.
- Hook coverage is a lifecycle aid, not a complete security enforcement
  boundary.
- Usage proxy is not a billing record, and ChatGPT credits are not inferred.
- A user must review and trust plugin hook definitions before Codex runs them.
- Archives and checkpoints are plaintext files. Content hashes provide
  integrity, not encryption; OS ACL hardening and encryption at rest are out of
  scope for this MVP.
- A legitimately created checkpoint can contain prompt-injection text. Frame
  values are bounded and presented as quoted, untrusted data, but schema and
  hash validation cannot prove semantic safety. Current repository state and
  user instructions remain authoritative.
- An explicit absolute `dataDir` is a privileged advanced override. Normal
  installed-plugin calls omit it. A locally inspected override must never be
  copied into a prompt, issue, report, screenshot, or submission artifact.
- `storeId` is an opaque correlation value, not a capability or proof that two
  stores contain safe or equivalent data.
- A hashed source session ID remains deterministic, pseudonymous, and linkable;
  hashing is not anonymization.
- Automatic PreCompact fails closed when no verified checkpoint exists. Manual
  compact is explicitly outside that protection when checkpoint, snapshot, or
  hook-state invariants fail.
- JSONL appends are durable best-effort records, not a linearizable
  multi-process database. Concurrent hook/MCP writers may interleave in OS-
  dependent order; receipts should be reconciled by id and timestamp.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Transcript schema drift | Version guard, structural validation, advisory-only fallback |
| Archive tampering | SHA-256 verification on every rehydrate and restore |
| Persisted prompt injection | Bounded fields, untrusted-data framing, no raw tool-output capture, and repository re-verification; semantic poisoning remains a documented residual risk |
| Hook recursion | Stop is observability-only and never creates a continuation |
| Context flooding | Hard byte/token bounds on injected TaskFrame and rehydration |
| Store split or path injection | Installed-store inference, mutation denial on an unconfigured working-directory fallback, absolute-only advanced overrides, path-redacted errors, and opaque `storeId` output |
| Personal data in Task Frames | Closed frame schema, repository-relative active files, safe evidence pointers, deterministic redaction heuristics, and an explicit residual-risk warning |
| Legacy checkpoint injection or lineage | Required privacy-boundary marker; markerless legacy latest remains local and immutable but cannot be hook-injected or linked as a verified parent |
| Secret disclosure in shared demo artifacts | Synthetic fixtures and an explicit sanitizer gate |
| Misleading economic claim | `usageProxy`; optional API-equivalent estimate kept separate; credits remain unknown |

## Data deletion

MVP operations do not delete persisted objects automatically. Manual deletion is
out of scope for the Build Week release so checkpoint-history restore remains
demonstrable. Advanced users can remove the reviewed local store themselves,
but should obtain its path only through a local administrative workflow and
must not paste that path into shared output. ContextGC does not expose a
recursive-delete command.
