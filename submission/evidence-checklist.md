# Build Week evidence checklist

## Automated evidence

- [x] Root `npm run verify` passes from a clean checkout (final post-commit gate).
- [x] Plugin validator passes for both source and staged package.
- [x] Fresh `codex debug prompt-input` includes `context-gc` and `ContextGC` in
      the model-visible input after installation.
- [x] MCP stdio smoke test lists and calls ContextGC tools.
- [x] Hook fixtures cover every configured lifecycle event.
- [x] Three policy fixtures produce deterministic receipt hashes.
- [x] Critical invariant retention is 100% in the final receipt.
- [x] Rehydrate and full restore both pass hash verification.
- [x] Demo site build and rendered-HTML test pass.
- [x] Local browser QA passes the invariant, rehydrate, restore and copy-command
      interactions with zero console warnings or errors.
- [x] Demo artifacts contain only sanitized fixture data.
- [x] Every submitted raster asset uses lowercase `.jpeg` and valid JPEG magic
      bytes.
- [x] One owner-observed trusted-hook lifecycle completed native compaction and
      recovered the same verified Task Frame in a completely fresh thread.
- [x] The final recovery report exposed no local absolute path.
- [x] A clean single-root public release branch can be created without rewriting
      the private development history.

## Human-required evidence

- [ ] Verify anonymous access to the public GitHub repository. The planned URL
      returned 404 during the 2026-07-21 preflight and is not release proof.
- [ ] Push only the clean public release branch; do not publish private history,
      private refs, or local author metadata.
- [ ] Change the selected Sites delivery mode to public and verify the demo from
      a signed-out browser.
- [ ] `USER_REQUIRED`: run `/feedback` on the primary Codex implementation
      session and enter its Session ID only in the Devpost UI. Never commit it.
- [ ] `USER_REQUIRED`: record narration and upload a public, under-three-minute
      YouTube video.
- [ ] `USER_REQUIRED`: confirm every team invitation is accepted, or confirm the
      submission is solo.
- [ ] Paste and re-open the public repository and demo URLs in Devpost.
- [ ] `USER_REQUIRED`: review the official rules and announcements immediately
      before submission.
- [ ] `USER_REQUIRED`: confirm the Devpost entry is `Submitted`, not draft.

## Claim gate

- [x] Every numeric result links to a checked-in receipt.
- [x] ChatGPT/Codex credits are shown as unknown, never inferred from tokens.
- [x] Any dollar estimate is labeled `API-equivalent` with its rate-card snapshot.
- [x] No use of “first”, “lossless”, “never forgets”, “globally optimal” or
      “exact credits”.
- [x] Native `/compact` actuation is not implied by the stable plugin.
- [ ] `USER_REQUIRED`: attach authoritative session evidence for the exact
      hosted model only in the Devpost UI; never commit its identifier and do
      not infer a model version from CLI metadata.

## Privacy publication gate

- [x] Committed submission material contains no real `/feedback` Session ID.
- [x] Committed acceptance evidence omits raw checkpoint and store identifiers.
- [x] `.env`, key, certificate, log, local ContextGC state and deployment-state
      directories are ignored.
- [ ] Inspect the final video frame-by-frame for profile UI, notifications,
      terminal title bars, user directories and account identifiers.
- [ ] Re-run the release-tree and public-branch metadata scan immediately before
      push.
