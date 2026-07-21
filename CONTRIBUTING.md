# Contributing to ContextGC

ContextGC accepts narrowly scoped, evidence-backed changes. The project treats
reversibility, explicit uncertainty, and generated-artifact parity as product
contracts rather than optional polish.

## Before you start

- Read the [developer guide](docs/developer-guide.md).
- Read the [security and privacy boundary](docs/security-and-privacy.md).
- Search existing public issues before opening a duplicate. Use the private
  security-reporting path for anything sensitive.
- Do not paste transcripts, archive objects, Task Frames, credentials, account
  IDs, or private absolute paths into issues or pull requests.

## Source-of-truth boundaries

Edit these canonical locations:

- TypeScript: `src/`
- lifecycle hooks: `hooks/`
- model-facing skill: `skills/context-gc/`
- fixtures and oracles: `fixtures/`
- demo source: `site/app/`, `site/worker/`, and `site/tests/`
- documentation: `README.md`, `docs/`, `research/`, and `submission/`

Do not directly edit these generated or synchronized outputs:

- `scripts/*.bundle.mjs`
- `plugins/context-gc/`
- `output/benchmark/*.json`
- `site/public/benchmark-report.json`
- `site/public/demo-receipt.json`

Use the repository scripts to regenerate them.

## Development workflow

```powershell
npm ci --ignore-scripts
npm --prefix site ci --ignore-scripts
npm run check
```

Create a focused branch, add the smallest falsifying test, implement the scoped
change, and run the relevant verification ladder from the developer guide.

Before opening a pull request:

```powershell
npm run verify
git diff --check
git diff --exit-code
```

The final `git diff --exit-code` is expected to succeed after committing. Before
the commit, inspect generated diffs and include them when they are a required
consequence of the source change.

## Pull request contract

Describe:

- the user or maintainer problem;
- what changed and what intentionally did not;
- exact verification commands and results;
- receipt/hash changes and their reason;
- security, privacy, compatibility, and native-compaction boundaries;
- manual verification still required.

Changes that claim economic or quality improvement must identify the metric,
fixtures or data, evaluator, comparison policy, and promotion gate. Do not infer
Codex credits from token counts.

## Release changes

Plugin bytes are cached by version. Any change to staged plugin bytes requires a
new version and fresh installation proof. Follow the complete release procedure
in [developer-guide.md](docs/developer-guide.md#release-procedure).

## Security reports

Do not open a normal issue for suspected secret persistence, path escape,
tampering, prompt-injection persistence, or integrity bypass. Follow
[SECURITY.md](SECURITY.md).
