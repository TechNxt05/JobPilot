import { compileLatex, LatexError, latexLogErrors, pdfPageCount } from "@internova/core";
import { json, requireUser } from "@/lib/ai";

/**
 * POST { latex } → application/pdf (X-Page-Count header). Compiles with a public TeX Live service
 * (latex.ytotech.com, fallback texlive.net); only called when the user asks for a PDF.
 */
export async function POST(req: Request) {
  if (!(await requireUser())) return json({ error: "Sign in first" }, 401);
  const body = (await req.json().catch(() => ({}))) as { latex?: unknown };
  const latex = typeof body.latex === "string" ? body.latex : "";
  if (!latex.includes("\\begin{document}")) return json({ error: "That isn't a complete LaTeX document (no \\begin{document})." }, 400);
  if (latex.length > 200_000) return json({ error: "LaTeX document is too large." }, 413);
  // Shell-escape style commands have no business in a resume
  if (/\\(write18|immediate\s*\\write|openout|input\s*\{\s*\/|include\s*\{\s*\/)/.test(latex)) return json({ error: "That LaTeX uses file or shell commands, which aren't allowed." }, 400);

  try {
    const { pdf, service } = await compileLatex(latex, { signal: AbortSignal.timeout(60000) });
    const pages = await pdfPageCount(pdf).catch(() => 0);
    return new Response(pdf as BodyInit, {
      headers: { "Content-Type": "application/pdf", "X-Page-Count": String(pages), "X-Compiled-By": service, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof LatexError) return json({ error: e.message, log: latexLogErrors(e.log) }, 422);
    return json({ error: (e as Error).message }, 502);
  }
}
