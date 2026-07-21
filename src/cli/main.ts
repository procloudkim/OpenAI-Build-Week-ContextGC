#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { parseArgs, UsageError } from "./args.js";
import { executeCommand, formatCommandResult, type CliDependencies } from "./commands.js";
import { defaultCliIo } from "./io.js";
import type { CliIo } from "./types.js";

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultCliIo(),
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    const result = await executeCommand(parsed, io, dependencies);
    io.stdout(formatCommandResult(parsed.command, result, parsed.pretty));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof UsageError ? error.exitCode : 1;
    io.stderr(serializeError(message, code));
    return code;
  }
}
function serializeError(message: string, code: number): string {
  return `${JSON.stringify({ ok: false, error: message, exitCode: code })}\n`;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(entryPath)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
