import { ContextGcRuntime, resolveRuntimePaths } from "../runtime/index.js";
import type { ContextGcService, RuntimeFactory, RuntimeOptions } from "./types.js";

export function resolveCliDataDir(options: RuntimeOptions): string {
  return resolveRuntimePaths(options).root;
}

export const defaultRuntimeFactory: RuntimeFactory = (options) => {
  const runtimeOptions: RuntimeOptions = {};
  if (options.cwd !== undefined) runtimeOptions.cwd = options.cwd;
  if (options.dataDir !== undefined) runtimeOptions.dataDir = options.dataDir;
  if (options.env !== undefined) runtimeOptions.env = options.env;

  const runtime = new ContextGcRuntime(runtimeOptions);
  return {
    init: () => runtime.init(),
    status: () => runtime.status(),
    appendEvent: (type, payload) =>
      runtime.appendEvent(
        type,
        payload as Parameters<typeof runtime.appendEvent>[1],
      ),
    archiveContent: (content) => runtime.archiveContent(content),
    createCheckpoint: (frame, checkpointOptions) =>
      runtime.createCheckpoint(
        frame as Parameters<typeof runtime.createCheckpoint>[0],
        checkpointOptions,
      ),
    restoreCheckpoint: (id) => runtime.restoreCheckpoint(id),
    rollback: () => runtime.rollback(),
    rehydrate: (refs, rehydrateOptions) =>
      runtime.rehydrate(
        refs as Parameters<typeof runtime.rehydrate>[0],
        rehydrateOptions,
      ),
  } satisfies ContextGcService;
};
