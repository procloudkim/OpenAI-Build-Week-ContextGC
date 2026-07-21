import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CliIo } from "./types.js";
import { UsageError } from "./args.js";

export function defaultCliIo(): CliIo {
  return {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    stdinIsTTY: Boolean(process.stdin.isTTY),
    env: process.env,
    cwd: () => process.cwd(),
  };
}
export function serialize(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new UsageError(`${label} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

export async function readJsonObject(
  path: string,
  options: { cwd: string; readStdin: () => Promise<string> },
): Promise<Record<string, unknown>> {
  let source: string;
  if (path === "-") {
    source = await options.readStdin();
  } else {
    source = await readFile(resolve(options.cwd, path), "utf8");
  }
  try {
    return asObject(JSON.parse(source) as unknown, path === "-" ? "stdin" : path);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`invalid JSON in ${path === "-" ? "stdin" : path}: ${message}`);
  }
}
