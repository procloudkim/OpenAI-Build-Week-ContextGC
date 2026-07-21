import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "output", "benchmark");
const target = resolve(root, "site", "public");

await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(resolve(source, "demo-receipt.json"), resolve(target, "demo-receipt.json")),
  copyFile(
    resolve(source, "benchmark-report.json"),
    resolve(target, "benchmark-report.json"),
  ),
]);

process.stdout.write(`${target}\n`);
