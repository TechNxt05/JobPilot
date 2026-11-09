// Bundles the MV3 extension into dist/. Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const watch = process.argv.includes("--watch");
const outdir = "dist";

// Optional cloud sync config: env vars, or extension/.env (SUPABASE_URL=..., SUPABASE_ANON_KEY=...)
const env = { ...process.env };
try {
  for (const line of (await readFile(".env", "utf8")).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const SUPABASE_URL = env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "";
console.log(SUPABASE_URL ? `Cloud sync: ${SUPABASE_URL}` : "Cloud sync: not configured (local-only build)");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

async function copyStatic() {
  await cp("static", outdir, { recursive: true });
  // pdf.js parses PDFs in a web worker shipped alongside the side panel
  const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  await cp(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), path.join(outdir, "pdf.worker.min.mjs"));
}

const options = {
  entryPoints: { background: "src/background.ts", sidepanel: "src/sidepanel/main.tsx" },
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  jsx: "automatic",
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
    __SUPABASE_URL__: JSON.stringify(SUPABASE_URL),
    __SUPABASE_ANON_KEY__: JSON.stringify(SUPABASE_ANON_KEY),
  },
  plugins: [{ name: "static", setup(b) { b.onEnd(() => copyStatic()); } }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
