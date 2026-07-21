import { access, cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "plugins", "context-gc");

if (!target.startsWith(`${resolve(root, "plugins")}\\`) && !target.startsWith(`${resolve(root, "plugins")}/`)) {
  throw new Error("Plugin stage target escaped the repository plugins directory");
}

await mkdir(target, { recursive: true });

for (const directory of [".codex-plugin", "hooks", "skills"]) {
  await cp(join(root, directory), join(target, directory), {
    recursive: true,
    force: true,
  });
}

const optionalAssets = join(root, "assets");
try {
  await access(optionalAssets);
  await cp(optionalAssets, join(target, "assets"), {
    recursive: true,
    force: true,
  });
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

for (const file of [".mcp.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  await copyFile(join(root, file), join(target, file));
}

await mkdir(join(target, "scripts"), { recursive: true });
for (const file of ["mcp-server.bundle.mjs", "contextgc.bundle.mjs"]) {
  await copyFile(join(root, "scripts", file), join(target, "scripts", file));
}

const sourceReadme = await readFile(join(root, "docs", "plugin-install.md"), "utf8");
await writeFile(join(target, "README.md"), sourceReadme, "utf8");

process.stdout.write(`${target}\n`);
