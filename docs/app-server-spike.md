# Experimental Codex app-server spike

## Result

Codex CLI 0.144.5 can generate experimental protocol bindings that include:

- client request `thread/compact/start`;
- parameter `{ threadId: string }`;
- `thread/tokenUsage/updated` notification;
- `thread/compacted` notification;
- a `contextCompaction` thread item.

This proves that a client which owns or resumes an app-server thread can request
native compaction. It does **not** prove that a normal plugin hook can compact an
arbitrary thread already owned by the desktop app or CLI.

## Reproducible probe

```powershell
codex app-server generate-ts --experimental --out <temporary-directory>
rg "thread/compact/start|ThreadCompactStartParams|tokenUsage/updated" <temporary-directory>
```

The generated `ThreadCompactStartParams` in this version contains only
`threadId`. Because app-server is explicitly experimental and the protocol may
change, ContextGC does not place this adapter on its required installation or
demo path. A future managed-mode host can add a version-pinned adapter and an
integration test without changing the stable core policy.
