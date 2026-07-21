import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

import type { RuntimePaths } from "./types.js";

export interface ResolveRuntimePathsOptions {
  readonly cwd?: string;
  readonly dataDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export type RuntimeDataDirSource =
  | "configured_default"
  | "env_plugin_data"
  | "env_contextgc_home"
  | "plugin_data_inferred"
  | "server_default";

export interface ResolvedRuntimeDataRoot {
  readonly root: string;
  readonly source: RuntimeDataDirSource;
  readonly mutationDefaultAllowed: boolean;
}

const SAFE_PLUGIN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_VERSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

/**
 * Infer the persistent Codex plugin data directory from an installed plugin's
 * version-directory cwd. This intentionally accepts only the exact documented
 * cache shape and conservative path segments so a crafted cwd cannot redirect
 * persistence outside the sibling plugin data directory.
 */
export function inferCodexPluginDataDir(
  cwd: string,
  expectedPluginName = "context-gc",
): string | null {
  if (!SAFE_PLUGIN_SEGMENT.test(expectedPluginName)) return null;

  const versionDirectory = resolve(cwd);
  const version = basename(versionDirectory);
  const pluginDirectory = dirname(versionDirectory);
  const pluginName = basename(pluginDirectory);
  const marketplaceDirectory = dirname(pluginDirectory);
  const marketplace = basename(marketplaceDirectory);
  const cacheDirectory = dirname(marketplaceDirectory);
  const pluginsDirectory = dirname(cacheDirectory);

  if (
    !SAFE_VERSION_SEGMENT.test(version) ||
    pluginName !== expectedPluginName ||
    !SAFE_PLUGIN_SEGMENT.test(marketplace) ||
    basename(cacheDirectory) !== "cache" ||
    basename(pluginsDirectory) !== "plugins"
  ) {
    return null;
  }

  return resolve(pluginsDirectory, "data", `${expectedPluginName}-${marketplace}`);
}

export function resolveRuntimeDataRoot(
  options: ResolveRuntimePathsOptions = {},
): ResolvedRuntimeDataRoot {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const configured = nonEmpty(options.dataDir);
  const pluginData = nonEmpty(env.PLUGIN_DATA);
  const contextGcHome = nonEmpty(env.CONTEXTGC_HOME);
  const inferred = inferCodexPluginDataDir(cwd);

  if (configured !== null) {
    return selectedRoot(configured, "configured_default", true);
  }
  if (pluginData !== null) {
    return selectedRoot(pluginData, "env_plugin_data", true);
  }
  if (contextGcHome !== null) {
    return selectedRoot(contextGcHome, "env_contextgc_home", true);
  }
  if (inferred !== null) {
    return selectedRoot(inferred, "plugin_data_inferred", true);
  }
  return selectedRoot(resolve(cwd, ".contextgc"), "server_default", false);
}

/** Opaque, deterministic identifier used to bind hooks and MCP receipts. */
export function contextGcStoreId(root: string): string {
  const normalized = resolve(root);
  const platformNormalized = process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
  return createHash("sha256").update(platformNormalized, "utf8").digest("hex").slice(0, 16);
}

export function resolveRuntimePaths(options: ResolveRuntimePathsOptions = {}): RuntimePaths {
  const { root } = resolveRuntimeDataRoot(options);

  return {
    root,
    ledger: resolve(root, "events.jsonl"),
    archive: resolve(root, "archive", "sha256"),
    checkpoints: resolve(root, "checkpoints"),
    latest: resolve(root, "latest.json"),
    taskFrame: resolve(root, "task-frame.json"),
  };
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value;
}

function selectedRoot(
  value: string,
  source: RuntimeDataDirSource,
  mutationDefaultAllowed: boolean,
): ResolvedRuntimeDataRoot {
  return {
    root: resolve(value),
    source,
    mutationDefaultAllowed,
  };
}
