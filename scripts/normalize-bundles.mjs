import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["mcp-server.bundle.mjs", "contextgc.bundle.mjs"]) {
  const path = join(root, "scripts", name);
  const source = await readFile(path, "utf8");
  const normalized = `${source.replace(/[ \t]+$/gm, "").replace(/\s*$/, "")}\n`;
  await writeFile(path, normalized, "utf8");
}
