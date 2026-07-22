# Final submission and release record

This file is safe to commit. It contains no private session value, account
identifier, local path, or credential. Keep all values marked `UI_ONLY` out of
the repository, screenshots, video, issues, and public chat.

The official deadline was **July 21, 2026 at 5:00 PM Pacific Time**
(**July 22, 2026 at 9:00 AM Korea Standard Time**). The owner reported the
Devpost entry submitted. This document now preserves the privacy and release
checks for the public `v0.1.11` source; it is not proof of Devpost's private UI
state.

## 1. Freeze the candidate

- [ ] Confirm the intended public snapshot matches local `main`.
- [ ] Run `npm run verify` from the release candidate.
- [ ] Run `git diff --check`.
- [ ] Confirm the working tree is clean.
- [ ] Confirm the no-build command succeeds:

```powershell
node scripts/contextgc.bundle.mjs simulate
```

- [ ] Confirm the receipt hash matches the site and checked-in report.
- [ ] Do not change plugin bytes under version `0.1.11`. Any plugin-byte change
      requires a new version, restaging, reinstall, and trust review.

## 2. Privacy gate before publication

Never publish:

- `/feedback` Session IDs;
- raw Codex session, turn, checkpoint, or store identifiers;
- user email, phone number, account name, profile screen, or billing screen;
- credentials, API keys, tokens, cookies, `.env` files, or private repository
  invitation links;
- complete local absolute paths or screenshots containing them;
- raw transcripts, Task Frames, archive objects, or user project content; or
- Git author metadata from the private development history.

Required checks:

- [ ] Scan the release tree for home paths, personal email domains, tokens, and
      private identifiers.
- [ ] Inspect every `.jpeg` frame at full size for terminal title bars, browser
      profiles, notifications, and account avatars.
- [ ] Inspect video frames and audio for spoken or visible private identifiers.
- [ ] Publish only the clean single-root public release branch. Do not mirror all
      private refs, tags, branches, pull-request refs, or Git notes.
- [ ] Keep the primary build Session ID in the Devpost form only.

The public release branch prepared by this repository is:

```text
submission-release-v0.1.11
```

Before pushing it, verify that it extends only the reviewed privacy-safe public
release ancestry and that its tree is identical to the reviewed release
candidate.

## 3. Repository access

Choose exactly one path.

### Preferred: public open-source repository

- [ ] Push only `submission-release-v0.1.11` to the public repository's `main`.
- [ ] Confirm MIT `LICENSE` is visible.
- [ ] Open the repository in a signed-out/private browser.
- [ ] Test a fresh anonymous clone.
- [ ] Confirm README setup, supported platform, sample synthetic data, and the
      no-build path are visible.

### Fallback: private judging repository

- [ ] Share the repository with `testing@devpost.com`.
- [ ] Share the repository with `build-week-event@openai.com`.
- [ ] Confirm both invitations are pending or accepted before the deadline.
- [ ] Keep the repository available through the judging period.

Do not put the project owner's private email into a committed checklist.

## 4. Public demo

- [ ] Set the selected Sites delivery mode to public.
- [ ] Open the demo in a signed-out/private browser.
- [ ] Check the receipt, invariant, rehydrate, restore, and copy interactions.
- [ ] Confirm the browser console has no error or warning.
- [ ] Confirm the demo says it uses synthetic data and cannot access a visitor's
      Codex files.
- [ ] Keep the demo available free of charge through the judging period.

## 5. Video

Target 2:30–2:50. Judges are not required to watch beyond three minutes.

- [ ] Record a working product rather than slides only.
- [ ] Include English narration or an English translation.
- [ ] Explain what ContextGC does.
- [ ] Explain specifically how Codex accelerated implementation and review.
- [ ] Explain specifically how GPT-5.6 was used.
- [ ] Distinguish the synthetic site from the installed plugin.
- [ ] Do not claim live credit savings.
- [ ] Do not expose private identifiers or local paths.
- [ ] Upload to the Vimeo destination selected by the owner and wait for processing.
- [ ] Use the visibility accepted by the submitted Devpost form.
- [ ] Watch the processed upload with sound from beginning to end.
- [ ] Paste and reopen the final Vimeo URL in Devpost; do not commit it here.

## 6. Devpost fields

- [ ] Track: `Developer Tools`.
- [ ] Use the reviewed English project description.
- [ ] Repository URL opens for the judge access mode selected above.
- [ ] Demo URL opens signed out.
- [ ] Video URL opens and has audio.
- [ ] `UI_ONLY`: enter the `/feedback` Session ID from the thread where most
      core functionality was built.
- [ ] `UI_ONLY`: provide the required hosted-model evidence without committing
      the identifier.
- [ ] Add every team member and confirm each invitation is accepted, or confirm
      that the entry is solo.
- [ ] Save the form.

## 7. Final eligibility check

- [ ] Re-read the live [rules](https://openai.devpost.com/rules),
      [updates](https://openai.devpost.com/updates), and announcements.
- [ ] Read the description aloud and remove wording the project owner would not
      naturally say.
- [ ] Confirm the README explains setup, supported platform, no-build testing,
      Codex contribution, GPT-5.6 contribution, key human decisions, and claim
      boundaries.
- [ ] Confirm all submitted materials are English or include an English
      translation.
- [x] Owner reported submission before the deadline.
- [x] Owner reported the project labeled **Submitted**, not Draft. This remains
      a user-attested UI result rather than independently reproducible evidence.
- [ ] Save a private proof of the submitted state without publishing account or
      session information.

## Stop conditions

Do not submit until all applicable items below are resolved:

- repository cannot be accessed under the selected judge access mode;
- video is over three minutes, missing voiceover, or still processing;
- Codex or GPT-5.6 contribution is generic or absent;
- required team invitation is unaccepted;
- a screenshot or artifact contains private data;
- the project appears only as Draft; or
- the public release branch contains private development history.
