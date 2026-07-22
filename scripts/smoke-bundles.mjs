import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "contextgc-bundle-smoke-"));

try {
  const notice = await readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const packageName of [
    "@modelcontextprotocol/sdk",
    "ajv",
    "fast-uri",
    "zod",
    "zod-to-json-schema",
  ]) {
    if (!notice.includes(packageName)) {
      throw new Error(`Third-party notice is missing ${packageName}`);
    }
  }
  for (const bundleName of ["contextgc.bundle.mjs", "mcp-server.bundle.mjs"]) {
    const bundle = await readFile(join(root, "scripts", bundleName), "utf8");
    if (!bundle.includes("Third-party license notices: ../THIRD_PARTY_NOTICES.md")) {
      throw new Error(`${bundleName} does not point to the third-party notices`);
    }
  }

  const cli = await run(process.execPath, [
    join(root, "scripts", "contextgc.bundle.mjs"),
    "simulate",
    "--fixtures",
    join(root, "fixtures"),
    "--output",
    join(scratch, "benchmark"),
    "--compact",
  ]);
  const cliLines = cli.stdout.trim().split(/\r?\n/);
  if (cliLines.length !== 1) {
    throw new Error(`CLI bundle emitted ${cliLines.length} stdout lines; expected one JSON document`);
  }
  const cliResult = JSON.parse(cliLines[0]);
  if (cliResult?.ok !== true || cliResult?.command !== "simulate") {
    throw new Error("CLI bundle did not return a successful simulate result");
  }

  const dataDir = join(scratch, "mcp-data");
  const client = new Client({ name: "contextgc-bundle-smoke", version: "0.1.9" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "scripts", "mcp-server.bundle.mjs")],
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    const expected = [
      "contextgc_archive",
      "contextgc_checkpoint",
      "contextgc_plan",
      "contextgc_rehydrate",
      "contextgc_restore",
      "contextgc_status",
    ];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`MCP bundle exposed unexpected tools: ${names.join(", ")}`);
    }

    const result = await client.callTool({
      name: "contextgc_status",
      arguments: { dataDir },
    });
    const structured = result.structuredContent;
    if (
      structured?.root !== undefined ||
      structured?.storeId !== storeIdForRoot(dataDir) ||
      structured?.dataDirSource !== "tool_argument" ||
      structured?.codexChatgptCredits !== null ||
      structured?.codexChatgptCreditsReason !== "public_conversion_unavailable"
    ) {
      throw new Error("MCP bundle did not preserve the opaque store or credit boundary");
    }

    const archived = await client.callTool({
      name: "contextgc_archive",
      arguments: { text: "bundle archive proof", dataDir },
    });
    if (
      archived.isError === true ||
      archived.structuredContent?.ref?.algorithm !== "sha256" ||
      archived.structuredContent?.storeId !== storeIdForRoot(dataDir) ||
      archived.structuredContent?.boundary?.assurance !== "runtime-verified-content-ref"
    ) {
      throw new Error("MCP bundle archive tool did not return a verified ContentRef");
    }

    const planned = await client.callTool({
      name: "contextgc_plan",
      arguments: planArguments(dataDir),
    });
    if (
      planned.isError === true ||
      planned.structuredContent?.trigger?.recommendation !== "PREPARE" ||
      planned.structuredContent?.boundary?.assurance !== "advisory-caller-asserted" ||
      planned.structuredContent?.boundary?.nativeCompactionTriggered !== false ||
      planned.structuredContent?.storeId !== storeIdForRoot(dataDir) ||
      !/^[a-f0-9]{64}$/.test(planned.structuredContent?.auditReceipt?.receiptHash ?? "")
    ) {
      throw new Error("MCP bundle plan tool did not preserve optimizer assurance boundaries");
    }
  } finally {
    await client.close();
  }

  const report = JSON.parse(
    await readFile(join(scratch, "benchmark", "benchmark-report.json"), "utf8"),
  );
  process.stdout.write(
    `${JSON.stringify({
      cliBundle: "pass",
      mcpBundle: "pass",
      receiptHash: report.receiptHash,
    })}\n`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit ${code}: ${stderr.trim()}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function planArguments(dataDir) {
  return {
    dataDir,
    selection: {
      tokenBudget: 5,
      candidates: [{
        atom: {
          id: "bundle-evidence",
          kind: "evidence",
          sourceRef: "ledger:bundle-evidence",
          contentHash: "sha256:bundle-evidence",
          archiveRef: `sha256:${"b".repeat(64)}`,
          protected: true,
          exact: true,
          tokenEstimate: 10,
          lifecyclePhase: "verify",
          lastUsedAt: "2026-07-18T00:00:00.000Z",
        },
        options: [
          {
            action: "KEEP",
            tokenCost: 10,
            utility: 10,
            riskScore: 0,
            reversible: true,
            preservesExactContent: true,
          },
          {
            action: "EXTERNALIZE",
            tokenCost: 2,
            utility: 9,
            riskScore: 0.01,
            reversible: true,
            preservesExactContent: true,
            redactionCount: 0,
            secretScanStatus: "clean",
          },
        ],
      }],
    },
    trigger: {
      currentTokens: 80,
      contextWindowTokens: 100,
      reclaimableTokens: 8,
      predictedRemainingTurns: 10,
      usageProxyPerRetainedTokenTurn: 1,
      checkpointCostProxy: 10,
      cacheChurnProxy: 5,
      rehydrationCostProxy: 2,
      riskCostProxy: 1,
      previousRecommendation: null,
      turnsSinceLastPreparation: 10,
      riskScore: 0.01,
      invariantViolations: [],
    },
  };
}

function storeIdForRoot(dataDir) {
  const absolute = resolve(dataDir);
  const normalized = process.platform === "win32"
    ? absolute.toLocaleLowerCase("en-US")
    : absolute;
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}
