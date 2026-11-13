/**
 * Turning a PDF's text layer into clean resume text, shared by the website and the extension.
 * The PDF reader (pdf.js) is loaded by each app; this module holds the pure parts:
 *  - itemsToText: positioned text items → lines, inserting spaces from glyph gaps (LaTeX resumes often
 *    have no space characters at all, only gaps)
 *  - cleanResumeText: removes icon-font glyphs and extraction junk
 *  - classifyLinks: the PDF's clickable links (LinkedIn, GitHub, Scholar, project and paper URLs)
 */

export interface PdfTextItem {
  str: string;
  /** Baseline x, y in PDF units */
  x: number;
  y: number;
  width: number;
  /** Font size estimate (transform scale) */
  size: number;
  hasEOL?: boolean;
}

/** One page's items → text lines. Items are in content-stream order (pdf.js default). */
export function itemsToText(pages: PdfTextItem[][]): string {
  const out: string[] = [];
  for (const items of pages) {
    let text = "";
    let last: PdfTextItem | null = null;
    for (const it of items) {
      if (!it.str) {
        if (it.hasEOL && !text.endsWith("\n")) text += "\n";
        continue;
      }
      if (last) {
        const newLine = Math.abs(it.y - last.y) > Math.max(2, last.size * 0.4);
        if (newLine) {
          if (!text.endsWith("\n")) text += "\n";
        } else {
          // Same line: a visible gap between glyph runs is a space even when the PDF stored none
          const gap = it.x - (last.x + last.width);
          const em = Math.max(1, Math.min(it.size, last.size));
          if (gap > em * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
        }
      }
      text += it.str;
      if (it.hasEOL) text += "\n";
      last = it;
    }
    out.push(text);
  }
  return out.join("\n");
}

/**
 * Remove what PDF text layers leave behind: icon-font glyphs (Private Use Area), "(cid:123)" placeholders,
 * replacement characters, and the stray letter an external-link / GitHub icon decodes to in common LaTeX
 * templates ("RAGOps W Next.js" → "RAGOps · Next.js").
 */
export function cleanResumeText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      // Icon glyphs (Private Use Area) become a separator so "Name [icon] Tech, Stack" stays splittable
      let l = line.replace(/\(cid:\d+\)/g, " · ").replace(/[\uE000-\uF8FF\u0080-\u009F\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " · ");
      // pdfplumber renders unmapped bullets / dashes as U+FFFD
      l = l.replace(/^\s*\uFFFD\s*/, "• ").replace(/\s*\uFFFD\s*/g, " — ");
      const isBullet = /^\s*[•\-*▪●◦‣–·]\s/.test(l);
      // A lone capital W between a heading and its tech list / year is an icon glyph, not a word
      if (!isBullet) l = l.replace(/(\S)\s+W(?=\s+[A-Z0-9(·]|\s*$)/g, "$1 · ");
      return l
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/(\s*·\s*){2,}/g, " · ")
        .replace(/^\s*·\s*|\s*·\s*$/g, "")
        .trim();
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ResumeLinks {
  linkedin: string;
  github: string;
  portfolio: string;
  scholar: string;
  /** Repos and live sites, matched to projects by name later */
  projects: string[];
  /** Papers: IEEE Xplore, DOI, arXiv, ACM, Scholar citation pages */
  papers: string[];
  other: string[];
}

const clean = (u: string) => u.trim().replace(/[).,;]+$/, "");

/** Sort a resume's clickable links by what they point at, keeping their order on the page. */
export function classifyLinks(urls: string[]): ResumeLinks {
  const out: ResumeLinks = { linkedin: "", github: "", portfolio: "", scholar: "", projects: [], papers: [], other: [] };
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = clean(raw);
    if (!/^https?:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    let host = "";
    let parts: string[] = [];
    try {
      const p = new URL(u);
      host = p.hostname.replace(/^www\./, "").toLowerCase();
      parts = p.pathname.split("/").filter(Boolean);
    } catch {
      continue;
    }
    if (host.endsWith("linkedin.com") && parts[0] === "in") out.linkedin ||= u;
    else if (host === "github.com" && parts.length === 1) out.github ||= u;
    else if (host === "github.com" && parts.length >= 2) out.projects.push(u);
    else if (host === "scholar.google.com" && /citation_for_view/.test(u)) out.papers.push(u);
    else if (host === "scholar.google.com") out.scholar ||= u;
    else if (/ieeexplore\.ieee\.org|doi\.org|arxiv\.org|dl\.acm\.org|springer\.com|sciencedirect\.com|researchgate\.net\/publication|openreview\.net/.test(host + "/" + parts.join("/"))) out.papers.push(u);
    else if (/portfolio|resume|about/.test(host) || (!out.portfolio && /\.(dev|me)$/.test(host))) out.portfolio ||= u;
    else out.projects.push(u);
  }
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best link for a project name: a live site or repo whose host/path contains the name. */
export function linkForProject(name: string, urls: string[]): { live: string; repo: string } {
  const key = squash(name.split(/\s+[-–—|:]\s+/)[0]);
  const res = { live: "", repo: "" };
  if (key.length < 3) return res;
  for (const u of urls) {
    let target = "";
    let isRepo = false;
    try {
      const p = new URL(u);
      isRepo = p.hostname.endsWith("github.com");
      target = squash(isRepo ? p.pathname.split("/")[2] ?? "" : p.hostname.split(".")[0] === "www" ? p.hostname.split(".")[1] : p.hostname.split(".")[0]);
    } catch {
      continue;
    }
    if (!target) continue;
    let common = 0;
    while (common < Math.min(key.length, target.length) && key[common] === target[common]) common++;
    const hit = target === key || target.startsWith(key) || (key.startsWith(target) && target.length >= 4) || (common >= 6 && common >= key.length * 0.6);
    if (!hit) continue;
    if (isRepo) res.repo ||= u;
    else res.live ||= u;
  }
  return res;
}
