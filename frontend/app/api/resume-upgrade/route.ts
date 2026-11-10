import {
  compileLatex,
  compileOnePage,
  fitToWords,
  LatexError,
  latexLogErrors,
  ONE_PAGE_WORDS,
  pdfPageCount,
  renderResumeLatex,
  tailorLatex,
  tailorResume,
} from "@internova/core";
import { aiGate, json } from "@/lib/ai";
import { clampText, loadUserData } from "@/lib/userData";

export const maxDuration = 120;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * POST { jobDescription, company?, role?, latex?, compile?: boolean }
 * - With `latex` (Overleaf code): tailors that document, keeping its preamble/layout.
 * - Without: builds a tailored resume from the profile in JobPilot's ATS-friendly template.
 * With compile=true, also returns the PDF (base64) and enforces one page: the profile
 * template is trimmed deterministically; user LaTeX gets one AI "shorten" pass.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobDescription = clampText(body.jobDescription, 15000);
  if (jobDescription.length < 80) return json({ error: "Paste the job description (at least a few sentences)." }, 400);
  const job = { title: clampText(body.role, 160) || null, company: clampText(body.company, 120) || null, text: jobDescription };
  const userLatex = clampText(body.latex, 60000);
  if (userLatex && !userLatex.includes("\\begin{document}")) return json({ error: "Paste the full Overleaf main.tex (it needs \\begin{document})." }, 400);

  const gate = await aiGate(req);
  if (!gate.ok) return gate.res;
  const { ai } = gate;
  const { profile, resumes } = await loadUserData(gate.supabase);
  if (!userLatex && !profile.firstName && !resumes.length) return json({ error: "Upload a resume or fill in your Profile first." }, 400);
  const input = { profile, resumeText: resumes[0]?.text ?? "", job };

  try {
    if (userLatex) {
      let result = await tailorLatex(ai, { ...input, latex: userLatex });
      if (!body.compile) return json({ mode: "latex", ...result });
      let compiled = await compileLatex(result.latex, { signal: AbortSignal.timeout(60000) });
      let pages = await pdfPageCount(compiled.pdf);
      if (pages > 1) {
        const shorter = await tailorLatex(ai, { ...input, latex: result.latex, shorten: true });
        const again = await compileLatex(shorter.latex, { signal: AbortSignal.timeout(60000) });
        const againPages = await pdfPageCount(again.pdf);
        if (againPages <= pages) {
          result = { ...shorter, changes: [...result.changes, ...shorter.changes], warnings: [...new Set([...result.warnings, ...shorter.warnings])] };
          compiled = again;
          pages = againPages;
        }
      }
      return json({ mode: "latex", ...result, pages, pdf: b64(compiled.pdf), compiledBy: compiled.service });
    }

    const { resume, report } = await tailorResume(ai, input);
    if (!body.compile) {
      const fitted = fitToWords(resume, ONE_PAGE_WORDS);
      return json({ mode: "profile", resume: fitted, report, latex: renderResumeLatex(fitted) });
    }
    let compiledBy = "";
    const out = await compileOnePage(
      resume,
      async (tex) => { const c = await compileLatex(tex, { signal: AbortSignal.timeout(60000) }); compiledBy = c.service; return c.pdf; },
      pdfPageCount,
    );
    return json({ mode: "profile", resume: out.resume, report, latex: out.latex, pages: out.pages, pdf: b64(out.pdf), compiledBy });
  } catch (e) {
    if (e instanceof LatexError) return json({ error: e.message, log: latexLogErrors(e.log) }, 422);
    return json({ error: (e as Error).message }, 502);
  }
}
