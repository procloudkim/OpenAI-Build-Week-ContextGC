# ContextGC interface reference

## Reference contract

- **Audience:** users and maintainers who need exact commands, inputs, side
  effects, limits, and compatibility boundaries.
- **Scope:** ContextGC `0.1.6` as verified on 2026-07-21.
- **Command convention:** user-facing CLI examples invoke the checked-in bundle
  with `node scripts/contextgc.bundle.mjs`. A bare `contextgc` command is
  available only in a development installation that explicitly links the npm
  package.
- **Authority:** source and tests override this reference if they diverge. File
  a documentation issue when that happens.

## Compatibility matrix

| Component | Verified or supported range | Behavior outside the range |
| --- | --- | --- |
| ContextGC | `0.1.6` | Recheck this reference and release notes |
| Node.js | `>=22.13.0`; verified with `24.18.0` | Package engine is unsupported |
| npm | Verified with `11.16.0` | Use the lockfile-compatible npm shipped with a supported Node release |
| Codex CLI installation/discovery | Verified with `0.144.5` | Re-run plugin, MCP, skill, and hook discovery checks |
| Transcript telemetry adapter | `0.144.x`, `0.145.0-alpha.x` | Transcript-derived automatic decisions fail closed; checkpoint tools remain available |
| Primary shell | Windows PowerShell | Other shells require equivalent quoting and path handling |

“Compatible newer Codex” is not assumed. Plugin packaging can still work while
the guarded transcript telemetry adapter rejects an unknown schema.

## Private store contract

Normal installed-plugin use does not require a path. When MCP `dataDir` is
omitted, ContextGC resolves one private store in this order:

1. server-configured default;
2. `PLUGIN_DATA`;
3. `CONTEXTGC_HOME`;
4. the installed plugin's inferred private data location;
5. `<current working directory>/.contextgc` as a status-only fallback.

The final fallback cannot authorize mutations. A mutating call without a
configured or installed-plugin store fails with `dataDir is required unless
ContextGC has a configured or installed-plugin data store`.

Successful MCP and model-visible hook results identify the selected store with
`storeId`, a 16-character lowercase hexadecimal digest. They do not return the
absolute root. `storeId` is an opaque correlation identifier, not a path,
credential, or authorization token. Users and agents should omit `dataDir` in
normal installed use.

An explicit absolute `dataDir` remains an advanced per-call override. A
relative override fails with `dataDir must be an absolute path`. Treat the
absolute value as private local administration data: inspect it locally and
never paste it into prompts, issues, reports, screenshots, or submission
artifacts.

```text
<private-store>/
├── events.jsonl
├── latest.json
├── task-frame.json
├── archive/
│   └── sha256/
└── checkpoints/
    └── <checkpoint-uuid>/
        ├── manifest.json
        └── task-frame.json
```

Archives and checkpoints are plaintext. SHA-256 hashes provide integrity, not
encryption. Match MCP and hook activity by `storeId`. Use the local CLI as an
advanced administrative boundary when an absolute path must be inspected or
deleted, and do not copy that path into a report.

## MCP tools

`dataDir` is optional on all MCP tools. Omit it for the installed plugin so the
server selects its private store. Successful results include `storeId`,
`dataDirSource`, and `dataDirBoundary`; absolute roots are not returned.

| Tool | Required input | Side effect | Primary result | Important boundary |
| --- | --- | --- | --- | --- |
| `contextgc_status` | Optional advanced `dataDir` override | None | Opaque store ID, source, counts, latest checkpoint | Working-directory fallback is readable but cannot authorize mutations |
| `contextgc_plan` | Selection candidates and trigger state; optional advanced override | Appends a policy receipt | KEEP/SUMMARIZE/EXTERNALIZE decisions and PREPARE/HOLD | Caller-supplied retention metadata is advisory; PREPARE is not native compaction |
| `contextgc_archive` | UTF-8 `text`; optional advanced override | Writes a content-addressed object | `ContentRef` and redaction boundary | Sanitized content is not raw byte-exact rollback data |
| `contextgc_checkpoint` | Strict Task Frame; optional reason and advanced override | Writes an immutable checkpoint and updates latest mirror | Checkpoint manifest, frame, UUID | Frame strings remain untrusted model-visible data |
| `contextgc_rehydrate` | One or more `ContentRef` values; optional limits and advanced override | Reads objects and appends an audit event | Bounded encoded content plus omissions | Does not change the active Task Frame |
| `contextgc_restore` | Optional checkpoint UUID and advanced override | Changes latest pointer and Task Frame mirror | Integrity-verified checkpoint and frame | Does not revert Git, files, commands, deployments, or external side effects |

### MCP size limits

| Input or store | Limit |
| --- | ---: |
| `contextgc_plan` JSON | 1 MiB |
| Archive UTF-8 input/object | 1 MiB |
| Total archive | 128 MiB |
| Task Frame JSON | 256 KiB |
| Rehydrate references per MCP call | 100 |
| Rehydrate `maxBytes` per MCP call | 1 MiB |
| Default rehydrate bounds | 16 items, 64 KiB |

## Task Frame

A caller supplies the content fields. The runtime replaces identity and time
metadata with locally generated values.

```json
{
  "goal": "Ship the verified ContextGC documentation update",
  "constraints": ["Do not publish local paths or session identifiers"],
  "decisions": ["Use a repository marketplace"],
  "openLoops": ["Wait for CI"],
  "activeFiles": ["README.md"],
  "testEvidence": ["npm run verify: pending"],
  "failedAttempts": [],
  "evidencePointers": ["git:HEAD"]
}
```

Required caller field: non-empty `goal`. The seven shown arrays default to
empty. The public MCP rejects unknown fields; lower-level runtime persistence
discards any extras outside the closed schema. `activeFiles` accepts non-empty
repository-relative paths only and rejects absolute, drive-relative,
home-relative, and traversal paths. `evidencePointers` accepts HTTP(S) URLs or
safe relative/opaque references and rejects local absolute paths, `file:` or
percent-encoded `file%3A` URIs, and traversal.

The runtime adds `schemaVersion`, `checkpointId`, and `createdAt`. It applies
deterministic heuristics for known credential formats, secret-named fields,
email addresses, international `+` or grouped phone formats, and home-user path
segments before persistence. These are minimization heuristics, not
comprehensive personally identifiable information (PII) detection. Lower-level
callers that supply a source session identifier persist only its deterministic
SHA-256 digest; this is pseudonymous and linkable, not anonymized. The public
MCP checkpoint input does not accept a raw session ID. Contiguous numeric IDs,
IP addresses, date/hour strings, and remote URL routes containing `/home/` or
`/Users/` are deliberately preserved to reduce false positives. Explicit local
`file:` URIs, including percent-encoded `file%3A` forms, are redacted in full.

Every new checkpoint manifest carries `privacyBoundary:
deterministic-minimization-v1`. A markerless latest checkpoint from an earlier build remains
immutable and local but is fail-closed and never hook-injected. A new strict
checkpoint may supersede it, but the unverified legacy checkpoint is not linked
as its parent. Rebuild that checkpoint only from currently verified facts;
earlier context is not automatically recovered.

## ContentRef

| Field | Meaning |
| --- | --- |
| `algorithm` | Always `sha256` |
| `hash` | Lowercase hash of persisted bytes |
| `bytes` | Persisted byte length |
| `mediaType` | UTF-8 text or opaque bytes |
| `secretScanStatus` | `clean`, `sanitized`, or `unscanned` |
| `sanitized` | Whether secret removal changed persisted bytes |
| `redactions` | Number of detected values removed |

The advisory selector considers protected exact EXTERNALIZE only when the atom
has a syntactically content-addressed `archiveRef` in
`sha256:<64-lowercase-hex>` form and the caller reports a
reversible, exact, clean, zero-redaction option. Those fields are not runtime-
verified by `contextgc_plan`, and the plan tool performs no externalization. A
caller must independently match the reference and scan metadata to a ContentRef
returned by `contextgc_archive`; absent references are discarded.

## Bundled CLI

```text
node scripts/contextgc.bundle.mjs status [--cwd PATH] [--data-dir PATH]
node scripts/contextgc.bundle.mjs simulate [--fixtures PATH] [--output PATH]
node scripts/contextgc.bundle.mjs checkpoint [--frame FILE|-] [--reason TEXT]
node scripts/contextgc.bundle.mjs restore CHECKPOINT_ID [--data-dir PATH]
node scripts/contextgc.bundle.mjs report [--receipt FILE]
```

Global output flags are `--pretty` and `--compact`. There is no `--json` flag;
successful non-help commands already return JSON. Exit code `0` means success,
`2` means command usage error, and `1` means runtime failure.

| Command | Behavior | Expected observable |
| --- | --- | --- |
| `status` | Reads the selected local store | Local administrative status, counts, `latestCheckpointId`, and `latestCheckpointStatus` (`missing`, `verified`, or `invalid`) |
| `simulate` | Replays deterministic fixtures | Policy aggregates and receipt hash |
| `checkpoint` | Reads a JSON object from file, stdin, or the current Task Frame mirror | New checkpoint UUID and stored frame |
| `restore` | Restores an explicitly named checkpoint | Matching manifest/frame after integrity checks |
| `report` | Reads an explicit receipt or searches fallback locations | Usage-boundary report; inspect its scope before treating it as live evidence |

### Report fallback order

Without `--receipt`, `report` searches:

1. `<selected-local-store>/receipts/latest.json`;
2. `<selected-local-store>/receipts/benchmark-report.json`;
3. the checked-in `output/benchmark/benchmark-report.json`.

The final fallback is synthetic benchmark evidence. It is not a live Codex
session report. Use `--receipt <path>` when provenance must be explicit.

## Restore and rollback vocabulary

- **Rehydrate:** read bounded archived evidence without changing the active
  frame.
- **Restore:** select one known checkpoint as the latest frame mirror.
- **Rollback:** operational shorthand for restoring a previously recorded
  checkpoint ID. ContextGC `0.1.6` has no public checkpoint-list command, so
  preserve important returned IDs.

## Plugin lifecycle commands

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local
codex plugin list
codex mcp list
codex plugin remove context-gc@context-gc-local
codex plugin marketplace remove context-gc-local
```

Plugin removal and marketplace removal do not delete ContextGC data. Review any
local deletion target separately and never publish its absolute path.

## Glossary

| Term | Definition |
| --- | --- |
| Task Frame | Bounded working set of goal, constraints, decisions, open loops, files, tests, failures, and evidence pointers |
| MemoryAtom | Typed candidate unit considered by the optimizer |
| ContentRef | Hash, size, media type, and secret-scan metadata for one archived object |
| KEEP | Retain the atom in active context |
| SUMMARIZE | Retain a shorter non-exact representation; forbidden for protected exact content |
| EXTERNALIZE | Replace active bytes with a reversible evidence pointer when safety gates permit |
| PREPARE | Recommend creating a reversible checkpoint; not a native compact command |
| HOLD | Do not prepare another checkpoint now |
| Rehydrate | Read selected archived content within explicit item/byte bounds |
| UPVS | Usage-proxy units per verified successful synthetic task |
| Usage proxy | Transparent weighted token-category comparison unit, not billing or Codex credits |
| `storeId` | Opaque 16-hex correlation identifier for a private local store; not a path, credential, or authorization token |

## Related documents

- [English user manual](user-manual.md)
- [한국어 사용자 매뉴얼](user-manual.ko.md)
- [Troubleshooting](troubleshooting.md)
- [Developer guide](developer-guide.md)
- [Security and privacy](security-and-privacy.md)
