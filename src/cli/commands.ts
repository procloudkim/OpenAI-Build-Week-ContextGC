import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { HELP_TEXT, type ParsedArgs, UsageError } from "./args.js";
import { withUsageBoundary } from "./accounting.js";
import { readJsonObject, serialize } from "./io.js";
import { defaultRuntimeFactory, resolveCliDataDir } from "./runtime.js";
import { CONTEXT_GC_VERSION } from "./version.js";
import type {
  BenchmarkOptions,
  BenchmarkRunner,
  CliIo,
  RuntimeFactory,
  RuntimeOptions,
} from "./types.js";

export interface CliDependencies {
  runtimeFactory?: RuntimeFactory;
  benchmarkRunner?: BenchmarkRunner;
}

function runtimeOptions(args: ParsedArgs, io: CliIo): RuntimeOptions {
  const options: RuntimeOptions = { cwd: resolve(args.cwd ?? io.cwd()), env: io.env };
  if (args.dataDir !== undefined) options.dataDir = args.dataDir;
  return options;
}

async function loadBenchmarkRunner(): Promise<BenchmarkRunner> {
  try {
    const loaded = await loadBenchmarkModule();
    return loaded.runBenchmark;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`benchmark module is unavailable; run npm run build first (${message})`);
  }
}

async function loadBenchmarkModule(): Promise<
  typeof import("../eval/run-benchmark.js")
> {
  // esbuild inlines this lazy module in the no-build CLI. Temporarily change
  // argv[1] so the benchmark file's direct-entry guard cannot mistake the
  // containing CLI bundle for `run-benchmark.js` and emit a second JSON line.
  const invokedPath = process.argv[1];
  if (invokedPath !== undefined) process.argv[1] = `${invokedPath}.library-import`;
  try {
    return await import("../eval/run-benchmark.js");
  } finally {
    if (invokedPath === undefined) {
      delete process.argv[1];
    } else {
      process.argv[1] = invokedPath;
    }
  }
}

function benchmarkOptions(args: ParsedArgs, options: RuntimeOptions): BenchmarkOptions {
  const cwd = options.cwd ?? process.cwd();
  const benchmark: BenchmarkOptions = {};
  if (args.fixturesDir !== undefined) benchmark.fixturesDir = resolve(cwd, args.fixturesDir);
  benchmark.outputDir = args.outputDir === undefined
    ? join(resolveCliDataDir(options), "receipts")
    : resolve(cwd, args.outputDir);
  return benchmark;
}

async function readReport(args: ParsedArgs, options: RuntimeOptions): Promise<unknown> {
  const dataDir = resolveCliDataDir(options);
  const cwd = options.cwd ?? process.cwd();
  const reportPaths = args.reportPath === undefined
    ? [
        join(dataDir, "receipts", "latest.json"),
        join(dataDir, "receipts", "benchmark-report.json"),
        join(cwd, "output", "benchmark", "benchmark-report.json"),
      ]
    : [resolve(cwd, args.reportPath)];
  for (const reportPath of reportPaths) {
    try {
      if (basename(reportPath) === "benchmark-report.json") {
        const { loadBenchmarkReport } = await loadBenchmarkModule();
        return await loadBenchmarkReport(reportPath);
      }
      return JSON.parse(await readFile(reportPath, "utf8")) as unknown;
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `no benchmark receipt found (${reportPaths.join(", ")}); run 'contextgc simulate' first`,
  );
}

export async function executeCommand(
  args: ParsedArgs,
  io: CliIo,
  dependencies: CliDependencies = {},
): Promise<unknown> {
  if (args.command === "help") return HELP_TEXT;
  if (args.command === "version") return CONTEXT_GC_VERSION;

  const options = runtimeOptions(args, io);
  if (args.command === "simulate") {
    const runner = dependencies.benchmarkRunner ?? await loadBenchmarkRunner();
    return runner(benchmarkOptions(args, options));
  }
  if (args.command === "report") {
    return withUsageBoundary(await readReport(args, options));
  }

  const factory = dependencies.runtimeFactory ?? defaultRuntimeFactory;
  const runtime = factory(options);

  if (args.command === "status") {
    return withUsageBoundary(await runtime.status());
  }

  if (args.command === "checkpoint") {
    const defaultFramePath = join(resolveCliDataDir(options), "task-frame.json");
    const framePath = args.framePath ?? defaultFramePath;
    const checkpointOptions: { reason?: string; sourceSessionId?: string } = {};
    if (args.reason !== undefined) checkpointOptions.reason = args.reason;
    if (args.sourceSessionId !== undefined) {
      checkpointOptions.sourceSessionId = args.sourceSessionId;
    }
    const frame = await readJsonObject(framePath, {
      cwd: options.cwd ?? io.cwd(),
      readStdin: io.readStdin,
    });
    return runtime.createCheckpoint(frame, checkpointOptions);
  }

  if (args.command === "restore") {
    if (args.checkpointId === undefined) {
      throw new UsageError("restore requires a checkpoint id");
    }
    return runtime.restoreCheckpoint(args.checkpointId);
  }

  throw new UsageError(`unsupported command: ${args.command}`);
}

export function formatCommandResult(command: ParsedArgs["command"], value: unknown, pretty: boolean): string {
  if (command === "help" || command === "version") {
    return `${String(value).trimEnd()}\n`;
  }
  return serialize({ ok: true, command, data: value }, pretty);
}
