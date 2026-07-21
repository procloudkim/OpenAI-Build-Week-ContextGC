# Human decisions

These product constraints were selected by the project owner before
implementation. They are not retrospective model-generated rationalizations.

| Decision | Selected direction | Consequence |
| --- | --- | --- |
| Primary surface | Codex plugin | Hooks, skill and MCP tools form one installable package |
| Runtime cost | Local-first, no separate API key | Persistence and control code are local; active Codex turns may consume normal plan usage |
| Repository | New independent `context-gc` repository | Existing workspaces remain untouched |
| Platform | Windows-first | Commands, hook overrides and judge instructions are tested on Windows |
| Automation | Reversible automatic preparation | No automatic raw-data deletion and every externalization has a restore path |
| Research budget | No paid benchmark calls | Recorded traces and deterministic fixtures replace out-of-band model evaluation |

During implementation, the team also rejected a proposed numeric
token-to-ChatGPT-credit estimate after research found no public deterministic
conversion. ContextGC therefore reports raw token categories, a transparent
usage proxy and, only when explicitly configured, an API-equivalent cost.
