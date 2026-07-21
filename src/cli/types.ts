export interface RuntimeOptions {
  cwd?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RehydrateOptions {
  maxBytes?: number;
  maxItems?: number;
}

export interface CheckpointOptions {
  reason?: string;
  sourceSessionId?: string;
}

/**
 * The command layer deliberately depends on the runtime structurally. This
 * keeps CLI and MCP tests hermetic while the production factory still uses the
 * real local runtime.
 */
export interface ContextGcService {
  init(): Promise<unknown>;
  status(): Promise<unknown>;
  appendEvent(type: string, payload: unknown): Promise<unknown>;
  archiveContent(content: string): Promise<unknown>;
  createCheckpoint(
    frame: Record<string, unknown>,
    options?: CheckpointOptions,
  ): Promise<unknown>;
  restoreCheckpoint(id?: string): Promise<unknown>;
  rollback(): Promise<unknown>;
  rehydrate(refs: unknown[], options?: RehydrateOptions): Promise<unknown>;
}

export type RuntimeFactory = (options: RuntimeOptions) => ContextGcService;

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  cwd(): string;
}

export interface BenchmarkOptions {
  fixturesDir?: string;
  outputDir?: string;
}

export type BenchmarkRunner = (options?: BenchmarkOptions) => Promise<unknown>;
