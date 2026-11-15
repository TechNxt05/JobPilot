import type { RankedJob } from "@/lib/discoverTypes";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/** One email listing the new jobs: score, company, location, flags, skill gaps, Apply link. Plain HTML tables for mail apps. */
export function digestEmail(jobs: RankedJob[], site: string, totalNew: number): { subject: string; html: string; text: string } {
  const strong = jobs.filter((j) => (j.score ?? 0) >= 70).length;
  const subject = `JobPilot: ${jobs.length} new job${jobs.length === 1 ? "" : "s"}${strong ? ` (${strong} strong match${strong === 1 ? "" : "es"})` : ""}`;
  const inbox = `${site}/daily`;

  const rows = jobs.map((j) => {
    const score = j.score == null ? "–" : `${j.score}`;
    const color = j.score == null ? "#777" : j.score >= 70 ? "#1a7f37" : j.score >= 50 ? "#9a6700" : "#b42318";
    const where = [j.company, j.location || (j.remote ? "Remote" : "")].filter(Boolean).join(" · ");
    const flags = j.flags.map((f) => `<span style="color:${f.severity === "blocker" ? "#b42318" : "#9a6700"}">⚠ ${esc(f.message)}</span>`).join("<br>");
    const gaps = j.missingSkills.length ? `Missing: ${esc(j.missingSkills.slice(0, 5).join(", "))}` : "";
    const resume = j.resumeName ? `Best resume: ${esc(j.resumeName)}` : "";
    return `<tr><td style="padding:12px 8px;border-top:1px solid #e5e5e5;vertical-align:top;width:44px;font:700 18px Arial;color:${color}">${score}</td>
<td style="padding:12px 8px;border-top:1px solid #e5e5e5;font:14px Arial;color:#222">
<a href="${esc(safeUrl(j.url))}" style="font-weight:700;color:#1d3fd8;text-decoration:none">${esc(j.title)}</a><br>
<span style="color:#555">${esc(where)}</span><br>
<span style="font-size:12px;color:#555">${[resume, gaps].filter(Boolean).join(" · ")}</span>${flags ? `<br><span style="font-size:12px">${flags}</span>` : ""}
<br><a href="${esc(safeUrl(j.applyUrl || j.url))}" style="display:inline-block;margin-top:6px;padding:5px 12px;background:#1d3fd8;color:#fff;border-radius:3px;font-size:13px;text-decoration:none">Apply</a>
</td></tr>`;
  }).join("\n");

  const more = totalNew > jobs.length ? `<p style="font:13px Arial;color:#555">${totalNew - jobs.length} more in your inbox.</p>` : "";
  const html = `<div style="max-width:640px;margin:0 auto">
<p style="font:15px Arial;color:#222">Good morning. JobPilot found <b>${totalNew}</b> new job${totalNew === 1 ? "" : "s"} on your watched boards. Scores compare each description with your best-matching resume.</p>
<p style="font:13px Arial;color:#555">Tip: open Apply, then press <b>Scan application form</b> in the JobPilot extension to fill it and attach your resume. Nothing is submitted for you.</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
${more}
<p style="font:13px Arial"><a href="${esc(inbox)}" style="color:#1d3fd8">Open all in JobPilot</a> · <a href="${esc(inbox)}#settings" style="color:#777">Change or stop these emails</a></p>
</div>`;

  const text = [
    `JobPilot found ${totalNew} new jobs.`,
    "",
    ...jobs.map((j) => `[${j.score ?? "–"}] ${j.title}, ${j.company}${j.location ? ` (${j.location})` : ""}\n  Apply: ${j.applyUrl || j.url}${j.flags.length ? `\n  ⚠ ${j.flags.map((f) => f.message).join("; ")}` : ""}`),
    "",
    `All jobs: ${inbox}`,
  ].join("\n");
  return { subject, html, text };
}
