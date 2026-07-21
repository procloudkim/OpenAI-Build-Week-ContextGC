import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../", import.meta.url);

function normalizeCanonical(value) {
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeCanonical(entry)]),
    );
  }
  return value;
}

function sha256Canonical(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeCanonical(value)), "utf8")
    .digest("hex");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete ContextGC evidence path", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ContextGC — Auditable context control for Codex<\/title>/i);
  assert.match(html, /Keep the truth\./);
  assert.match(html, /Compress the noise\./);
  assert.match(html, /Three traces\. Three policies\. No vibes\./);
  assert.match(html, /Protected facts get a fail-closed gate\./);
  assert.match(html, /Important non-secret evidence stays recoverable\./);
  assert.match(html, /3\.20(?:<!-- -->)?%/);
  assert.match(html, /9\.36(?:<!-- -->)?%/);
  assert.match(html, /65,488\.33/);
  assert.match(html, /liveCodexProof=false/i);
  assert.match(html, /Codex credits are unknown/i);
  assert.match(html, /Deterministic synthetic replay only/);
  assert.match(html, /does not claim to replace Codex/);
  assert.match(html, /No build\. Three commands\./);
  assert.match(html, /github\.com\/procloudkim\/OpenAI-Build-Week-ContextGC/i);
  assert.match(html, /node scripts\/contextgc\.bundle\.mjs simulate/);
  assert.doesNotMatch(html, /Nothing important disappears|raw preserved/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
  assert.doesNotMatch(html, /(?:^|["'(\s])[A-Z]:[\\/]/i);
});

test("ships the verified sanitized benchmark receipt without invented results", async () => {
  const [
    page,
    layout,
    packageJson,
    receiptText,
    sourceReceiptText,
    reportText,
    sourceReportText,
    publicFiles,
  ] =
    await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/demo-receipt.json", import.meta.url), "utf8"),
    readFile(new URL("../../output/benchmark/demo-receipt.json", import.meta.url), "utf8"),
    readFile(new URL("../public/benchmark-report.json", import.meta.url), "utf8"),
    readFile(new URL("../../output/benchmark/benchmark-report.json", import.meta.url), "utf8"),
    readdir(new URL("../public/", import.meta.url)),
    ]);

  const packageData = JSON.parse(packageJson);
  const receipt = JSON.parse(receiptText);
  const sourceReceipt = JSON.parse(sourceReceiptText);
  const report = JSON.parse(reportText);
  const sourceReport = JSON.parse(sourceReportText);

  assert.equal(packageData.name, "contextgc-demo");
  assert.equal(packageData.dependencies["react-loading-skeleton"], undefined);
  assert.equal(packageData.scripts.build, "vinext build");
  assert.equal(packageData.scripts.dev, "vinext dev");
  assert.doesNotMatch(packageJson, /WRANGLER_LOG_PATH/);

  assert.deepEqual(receipt, sourceReceipt);
  assert.deepEqual(report, sourceReport);
  const { receiptHash, ...reportWithoutHash } = report;
  assert.equal(receiptHash, sha256Canonical(reportWithoutHash));
  assert.equal(receipt.sourceReceiptHash, receiptHash);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.codexCredits, null);
  assert.equal(receipt.liveCodexProof, false);
  assert.equal(receipt.apiCallsMade, 0);
  assert.equal(receipt.sourceReceiptHash.length, 64);
  assert.deepEqual(
    receipt.policies.map(({ policy, upvs, verifiedSuccesses, criticalRetentionRate }) => ({
      policy,
      upvs,
      verifiedSuccesses,
      criticalRetentionRate,
    })),
    [
      { policy: "M_MANUAL", upvs: 59884.666667, verifiedSuccesses: 3, criticalRetentionRate: 1 },
      { policy: "F_FIXED", upvs: 67653.666667, verifiedSuccesses: 3, criticalRetentionRate: 1 },
      { policy: "A_ADAPTIVE", upvs: 65488.333333, verifiedSuccesses: 3, criticalRetentionRate: 1 },
    ],
  );

  assert.match(page, /fetch\("\/demo-receipt\.json"/);
  assert.match(page, /fetch\("\/benchmark-report\.json"/);
  assert.match(page, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(page, /receiptMatchesReport/);
  assert.match(page, /const fallbackReceipt: DemoReceipt/);
  assert.match(page, /useState<PolicyKey>/);
  assert.match(page, /Reveal recorded invariant result/);
  assert.match(page, /Rehydrate protected evidence/);
  assert.match(page, /Restore valid frame/);
  assert.match(page, /unknown—not publicly derivable/);
  assert.match(page, /liveCodexProof/);
  assert.match(page, /apiCallsMade/);
  assert.match(page, /sourceReceiptHash/);
  assert.match(page, /Detected secret bytes are redacted before persistence/);
  assert.doesNotMatch(
    page,
    /10\.86|9\.14|7\.28|cp-018|1\.94|0\.46|1842|Late invariant missed|destructiveDrops/,
  );
  assert.match(layout, /ContextGC — Keep the truth\. Compress the noise\./);
  assert.match(layout, /\/og\.jpeg/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|Starter Project/);
  assert.equal(publicFiles.some((file) => file.endsWith(".svg")), false);
  assert.equal(publicFiles.some((file) => /\.(png|jpg|webp|gif)$/i.test(file)), false);
  assert.equal(publicFiles.includes("og.jpeg"), true);

  const ogBytes = await readFile(new URL("../public/og.jpeg", import.meta.url));
  assert.deepEqual([...ogBytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual([...ogBytes.subarray(-2)], [0xff, 0xd9]);

  await assert.rejects(access(new URL("app/_sites-preview", siteRoot)));
});
