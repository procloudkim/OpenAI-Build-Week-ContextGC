# ContextGC demo

Judge-facing, one-page evidence demo for ContextGC. It runs on the bundled
vinext/Sites stack and needs no hosted database, object storage, login, or API
key.

## Local use

Requires Node.js `>=22.13.0`.

```powershell
npm ci --ignore-scripts
npm run dev
npm test
```

The scripts are cross-platform and work in PowerShell without a POSIX shell.

## Demo receipt contract

The page loads `public/demo-receipt.json` and
`public/benchmark-report.json`, recomputes the report's canonical SHA-256 in the
browser, and checks every displayed policy result against that hashed report.
It retains an equivalent checked-in fallback for offline server rendering. The
public files are exact copies of `../output/benchmark/`, and the site test fails
if either copy diverges or the report hash is invalid.

`usageProxyDefinition` and UPVS describe a deterministic synthetic replay.
They are not an OpenAI billing statement or live Codex proof. The receipt keeps
`codexCredits: null`, `liveCodexProof: false`, `apiCallsMade: 0`, its
`sourceReceiptHash`, and the complete benchmark caveat.

## Validation

```powershell
npm run build
npm test
```

The test renders the production worker, checks the complete evidence path,
validates the receipt shape, and confirms that starter preview artifacts are
absent.
