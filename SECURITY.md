# Security policy

## Supported version

ContextGC is a Build Week prototype. Security fixes target the latest `0.1.x`
release on `main`; older commits are not maintained as separate release lines.

## Report privately

Use a private [GitHub security advisory](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC/security/advisories/new)
for suspected vulnerabilities. Never put security-sensitive details in a
public issue. If the advisory surface is unavailable, wait for a private
reporting channel instead of downgrading to public disclosure.

Do not include:

- raw Codex transcripts or prompts;
- ContextGC archive objects or Task Frames;
- credentials, tokens, session IDs, or account identifiers;
- complete private absolute paths;
- proprietary source or customer data.

Provide the smallest sanitized reproduction, ContextGC/Codex/Node versions,
affected operation, expected boundary, actual behavior, and whether the issue
requires an existing checkpoint or malicious local access.

## Response boundary

This prototype does not promise a response service-level agreement. The
maintainer will acknowledge a reproducible report, classify whether it crosses
an implemented guarantee, and keep disclosure private until a fix and migration
path are ready.

## Implemented and excluded guarantees

See [Security and privacy boundary](docs/security-and-privacy.md). In particular:

- hashes provide integrity, not encryption;
- pattern redaction cannot identify all sensitive data;
- sanitized secrets are intentionally not byte-restorable;
- hook coverage is not a complete security boundary;
- Task Frame strings remain untrusted model-visible data;
- ContextGC restore does not revert files, Git, commands, or remote side effects.

Reports about unsupported or explicitly excluded behavior are still useful when
they demonstrate an unexpected escalation or bypass.
