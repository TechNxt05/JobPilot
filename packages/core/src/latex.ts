import { PDFDocument } from "pdf-lib";

/* ------------------------------ Escaping / plain text ------------------------------ */

const LATEX_SPECIALS: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/([&%$#_{}])/g, "\\$1"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
  [/₹/g, "Rs. "],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, "..."],
  [/•/g, ""],
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ""], // emoji break pdflatex
];

/** Escape user text for safe inclusion in LaTeX (pdflatex). */
export function escapeLatex(text: string): string {
  let out = text;
  // Backslash first, but its replacement contains braces, so protect them
  out = out.replace(/\\/g, "\u0000");
  for (const [re, rep] of LATEX_SPECIALS.slice(1)) out = out.replace(re, rep);
  return out.replace(/\u0000/g, "\\textbackslash{}").trim();
}

/** Escape a URL for \href{...}: only % and # need escaping there. */
export function escapeUrl(url: string): string {
  return url.replace(/([%#])/g, "\\$1");
}

/**
 * LaTeX → readable plain text (for ATS scoring and grounding checks). Not a full parser:
 * keeps the arguments of commands, drops the commands, comments and the preamble.
 */
export function latexToText(tex: string): string {
  let body = tex.replace(/(^|[^\\])%.*$/gm, "$1"); // comments
  const begin = body.indexOf("\\begin{document}");
  const end = body.lastIndexOf("\\end{document}");
  if (begin >= 0) body = body.slice(begin + "\\begin{document}".length, end > begin ? end : undefined);
  body = body
    .replace(/\\(item)\b(\[[^\]]*\])?/g, "\n• ")
    .replace(/\\\\(\[[^\]]*\])?/g, "\n")
    .replace(/\\(section|subsection|subsubsection|paragraph)\*?\s*\{([^{}]*)\}/g, "\n$2\n")
    .replace(/\\(begin|end)\{[^}]*\}(\{[^}]*\})*/g, "\n")
    .replace(/\\href\{[^}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\(vspace|hspace|setlength|addtolength|titlespacing|newcommand|renewcommand)\*?(\{[^{}]*\}|\[[^\]]*\])*/g, " ")
    .replace(/\\textbackslash\{\}/g, "\\")
    // Table column separators are gaps on the page, not text
    .replace(/(^|[^\\])&/g, "$1 ")
    .replace(/\$\\sim\$/g, "~")
    .replace(/\\textbar\b\s*/g, "| ")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\(textbf|textit|emph|underline|textsc|small|large|Large|LARGE|huge|scshape|bfseries|itshape|normalsize|footnotesize|tiny)\b/g, "");
  // Unwrap remaining command arguments repeatedly: \cmd[opt]{arg}{arg2} → arg arg2
  for (let i = 0; i < 6; i++) {
    const next = body.replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?\{([^{}]*)\}/g, "$2");
    if (next === body) break;
    body = next;
  }
  return body
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    // Adjacent macro arguments ({title}{date}) render apart, and LaTeX dashes render as dashes
    .replace(/\}\s*\{/g, " ")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "•" && !/^[|$&\s]+$/.test(l))
    .join("\n");
}

/** The document preamble (everything before \begin{document}). */
export function latexPreamble(tex: string): string {
  const i = tex.indexOf("\\begin{document}");
  return i >= 0 ? tex.slice(0, i) : "";
}

/* ------------------------------ Compilation ------------------------------ */

export class LatexError extends Error {
  constructor(message: string, public log: string = "") {
    super(message);
    this.name = "LatexError";
  }
}

/** First LaTeX error lines from a log ("! Undefined control sequence." + context). */
export function latexLogErrors(log: string): string {
  const lines = log.split(/\r?\n/);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith("!")) out.push(l, ...(lines.slice(i + 1, i + 3).filter(Boolean)));
  });
  return out.slice(0, 8).join("\n") || log.slice(-800);
}

export interface CompileOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

/**
 * Compile LaTeX to PDF with a public TeX Live service: YtoTech LaTeX-on-HTTP first,
 * texlive.net as fallback. The document (resume text) is sent to that service; callers
 * must only do this when the user asks for a PDF.
 */
export async function compileLatex(tex: string, opts: CompileOptions = {}): Promise<{ pdf: Uint8Array; service: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const failures: string[] = [];
  let lastLog = "";

  try {
    const res = await fetchImpl("https://latex.ytotech.com/builds/sync", {
      method: "POST",
      signal: opts.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler: "pdflatex", resources: [{ main: true, content: tex }] }),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok && isPdf(bytes)) return { pdf: bytes, service: "latex.ytotech.com" };
    const text = new TextDecoder().decode(bytes);
    try {
      const j = JSON.parse(text);
      lastLog = j.log_files?.["__main_document__.log"] ?? j.logs ?? "";
      failures.push(`ytotech: ${j.error ?? res.status}`);
      // A real LaTeX error won't compile elsewhere either
      if (lastLog && /^!/m.test(lastLog)) throw new LatexError("LaTeX compilation failed", lastLog);
    } catch (e) {
      if (e instanceof LatexError) throw e;
      failures.push(`ytotech: HTTP ${res.status}`);
    }
  } catch (e) {
    if (e instanceof LatexError || (e as Error)?.name === "AbortError") throw e;
    failures.push(`ytotech: ${(e as Error).message}`);
  }

  try {
    const form = new FormData();
    form.append("filecontents[]", tex);
    form.append("filename[]", "document.tex");
    form.append("engine", "pdflatex");
    form.append("return", "pdf");
    const res = await fetchImpl("https://texlive.net/cgi-bin/latexcgi", { method: "POST", body: form, signal: opts.signal });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (res.ok && isPdf(bytes)) return { pdf: bytes, service: "texlive.net" };
    lastLog = new TextDecoder().decode(bytes);
    if (/^!/m.test(lastLog)) throw new LatexError("LaTeX compilation failed", lastLog);
    failures.push(`texlive.net: HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof LatexError || (e as Error)?.name === "AbortError") throw e;
    failures.push(`texlive.net: ${(e as Error).message}`);
  }
  throw new LatexError(`Couldn't reach a LaTeX compiler (${failures.join("; ")}). Use "Open in Overleaf" instead.`, lastLog);
}

export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return doc.getPageCount();
}

/** Overleaf's "open this LaTeX as a new project" endpoint: POST a form with field `snip`. */
export const OVERLEAF_NEW_PROJECT_URL = "https://www.overleaf.com/docs";
