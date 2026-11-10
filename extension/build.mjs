// Bundles the MV3 extension into dist/. Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
// Deployed JobPilot website (hosted AI for signed-in users), e.g. https://jobpilot.vercel.app
const JOBPILOT_API_URL = (env.JOBPILOT_API_URL ?? "").replace(/\/$/, "");
console.log(JOBPILOT_API_URL ? `Hosted AI: ${JOBPILOT_API_URL}` : "Hosted AI: not configured (own keys only)");
console.log(SUPABASE_URL ? `Cloud sync: ${SUPABASE_URL}` : "Cloud sync: not configured (local-only build)");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

async function copyStatic() {
  await cp("static", outdir, { recursive: true });
  // The extension may call the JobPilot website's /api/ai (hosted AI): grant exactly that origin
  if (JOBPILOT_API_URL) {
    const manifestPath = path.join(outdir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const origin = `${new URL(JOBPILOT_API_URL).origin}/*`;
    if (!manifest.host_permissions.includes(origin)) manifest.host_permissions.push(origin);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
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
    __JOBPILOT_API_URL__: JSON.stringify(JOBPILOT_API_URL),
  },
  plugins: [{ name: "static", setup(b) { b.onEnd(() => copyStatic()); } }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
