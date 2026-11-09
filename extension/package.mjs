// Zips extension/dist into a Chrome Web Store upload: jobpilot-extension-v<version>.zip
import { zipSync } from "fflate";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = "dist";
const manifest = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));

async function collect(dir, out = {}) {
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) await collect(full, out);
    else if (!name.endsWith(".map") && name !== "icon.svg") {
      out[path.relative(dist, full).split(path.sep).join("/")] = new Uint8Array(await readFile(full));
    }
  }
  return out;
}

const files = await collect(dist);
const zip = zipSync(files, { level: 9 });
const out = `jobpilot-extension-v${manifest.version}.zip`;
await writeFile(out, zip);
console.log(`${out}: ${Object.keys(files).length} files, ${(zip.length / 1024).toFixed(0)} KB`);
