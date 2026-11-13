// Copies pdf.js's worker next to the site so the browser can read PDFs locally (no upload to a server).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
mkdirSync(join(here, "../public"), { recursive: true });
copyFileSync(src, join(here, "../public/pdf.worker.min.mjs"));
