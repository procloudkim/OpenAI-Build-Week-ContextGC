import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  contextGcStoreId,
  inferCodexPluginDataDir,
  resolveRuntimeDataRoot,
} from "../src/runtime/paths.js";

test("installed Codex plugin cwd maps to its private persistent data directory", () => {
  const plugins = resolve("sandbox", "plugins");
  const cwd = resolve(
    plugins,
    "cache",
    "context-gc-local",
    "context-gc",
    "0.1.3",
  );

  assert.equal(
    inferCodexPluginDataDir(cwd),
    resolve(plugins, "data", "context-gc-context-gc-local"),
  );
});

test("plugin data inference rejects malformed or mismatched cache layouts", () => {
  const plugins = resolve("sandbox", "plugins");
  assert.equal(
    inferCodexPluginDataDir(
      resolve(plugins, "cache", "market place", "context-gc", "0.1.3"),
    ),
    null,
  );
  assert.equal(
    inferCodexPluginDataDir(
      resolve(plugins, "cache", "marketplace", "other-plugin", "0.1.3"),
    ),
    null,
  );
  assert.equal(
    inferCodexPluginDataDir(
      resolve(plugins, "not-cache", "marketplace", "context-gc", "0.1.3"),
    ),
    null,
  );
  assert.equal(
    inferCodexPluginDataDir(
      resolve(plugins, "cache", "marketplace", "context-gc", "bad version"),
    ),
    null,
  );
  assert.equal(
    inferCodexPluginDataDir(
      resolve(plugins, "cache", "marketplace", "context-gc", "0.1.3"),
      "../context-gc",
    ),
    null,
  );
});

test("runtime data-root provenance preserves explicit and environment precedence", () => {
  const installedCwd = resolve(
    "sandbox",
    "plugins",
    "cache",
    "marketplace",
    "context-gc",
    "0.1.3",
  );

  assert.deepEqual(
    resolveRuntimeDataRoot({
      cwd: installedCwd,
      dataDir: "explicit",
      env: { PLUGIN_DATA: "plugin", CONTEXTGC_HOME: "home" },
    }),
    {
      root: resolve("explicit"),
      source: "configured_default",
      mutationDefaultAllowed: true,
    },
  );
  assert.equal(
    resolveRuntimeDataRoot({
      cwd: installedCwd,
      env: { PLUGIN_DATA: "plugin", CONTEXTGC_HOME: "home" },
    }).source,
    "env_plugin_data",
  );
  assert.equal(
    resolveRuntimeDataRoot({ cwd: installedCwd, env: { CONTEXTGC_HOME: "home" } }).source,
    "env_contextgc_home",
  );
  assert.equal(
    resolveRuntimeDataRoot({ cwd: installedCwd, env: {} }).source,
    "plugin_data_inferred",
  );
  assert.deepEqual(
    resolveRuntimeDataRoot({ cwd: resolve("ordinary-workspace"), env: {} }),
    {
      root: resolve("ordinary-workspace", ".contextgc"),
      source: "server_default",
      mutationDefaultAllowed: false,
    },
  );
});

test("store identifiers are deterministic opaque short hashes", () => {
  const root = resolve("sandbox", "plugins", "data", "context-gc-marketplace");
  const storeId = contextGcStoreId(root);
  assert.match(storeId, /^[a-f0-9]{16}$/);
  assert.equal(contextGcStoreId(root), storeId);
  assert.doesNotMatch(storeId, /sandbox|context-gc|plugins/);
  assert.notEqual(contextGcStoreId(resolve(root, "other")), storeId);
});
