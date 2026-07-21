export type CommandName =
  | "status"
  | "simulate"
  | "checkpoint"
  | "restore"
  | "report"
  | "help"
  | "version";

export interface ParsedArgs {
  command: CommandName;
  cwd?: string;
  dataDir?: string;
  framePath?: string;
  reason?: string;
  sourceSessionId?: string;
  checkpointId?: string;
  fixturesDir?: string;
  outputDir?: string;
  reportPath?: string;
  pretty: boolean;
}

export class UsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS = new Set<CommandName>([
  "status",
  "simulate",
  "checkpoint",
  "restore",
  "report",
  "help",
  "version",
]);

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    return { command: "help", pretty: true };
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", pretty: true };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    return { command: "version", pretty: true };
  }

  const first = argv[0];
  if (first === undefined || !COMMANDS.has(first as CommandName)) {
    throw new UsageError(`unknown command: ${first ?? ""}`);
  }

  const parsed: ParsedArgs = {
    command: first as CommandName,
    pretty: true,
  };
  const positional: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case "--cwd":
        parsed.cwd = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--data-dir":
        parsed.dataDir = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--frame":
        parsed.framePath = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--reason":
        parsed.reason = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--source-session-id":
        parsed.sourceSessionId = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--fixtures":
        parsed.fixturesDir = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--output":
        parsed.outputDir = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--receipt":
        parsed.reportPath = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--compact":
        parsed.pretty = false;
        break;
      case "--pretty":
        parsed.pretty = true;
        break;
      case "--help":
      case "-h":
        parsed.command = "help";
        break;
      default:
        if (arg.startsWith("-")) {
          throw new UsageError(`unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (parsed.command === "restore") {
    if (positional.length !== 1) {
      throw new UsageError("restore requires exactly one checkpoint id");
    }
    parsed.checkpointId = positional[0]!;
  } else if (positional.length > 0) {
    throw new UsageError(`unexpected argument: ${positional[0]}`);
  }

  return parsed;
}

export const HELP_TEXT = `ContextGC - local, reversible context control for Codex

Usage:
  contextgc status [--cwd PATH] [--data-dir PATH]
  contextgc simulate [--fixtures PATH] [--output PATH]
  contextgc checkpoint [--frame FILE|-] [--reason TEXT] [--source-session-id ID]
  contextgc restore CHECKPOINT_ID
  contextgc report [--receipt FILE]

Global output options:
  --pretty        Pretty JSON output (default)
  --compact       Compact JSON output
  -h, --help      Show this help
  -v, --version   Show the ContextGC version

Data directory precedence:
  --data-dir, PLUGIN_DATA, CONTEXTGC_HOME, <cwd>/.contextgc

Checkpoint input:
  --frame defaults to <data-dir>/task-frame.json; use '-' to read JSON from stdin.
`;
