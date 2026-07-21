#!/usr/bin/env node
import { runMcpServer } from "../dist/src/mcp/server.js";

try {
  await runMcpServer();
} catch (error) {
  // Never write diagnostics to stdout: it is reserved for MCP JSON-RPC.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
