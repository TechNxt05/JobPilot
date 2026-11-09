import type { ResumeAnalysis } from "./resume";

export interface ATSCheck {
  id: string;
  label: string;
  points: number;
  maxPoints: number;
  passed: boolean;
  detail: string;
}

export interface ATSReport {
  /** 0–100: how readable and well-structured the resume is for ATS parsers. Independent of any job. */
  score: number;
  checks: ATSCheck[];
  warnings: string[];
}

function check(id: string, label: string, maxPoints: number, ratio: number, detail: string): ATSCheck {
  const r = Math.max(0, Math.min(1, ratio));
  return { id, label, maxPoints, points: Math.round(maxPoints * r * 10) / 10, passed: r >= 0.999, detail };
}

/** General (job-independent) ATS readability score. Fully deterministic. */
export function scoreATS(r: ResumeAnalysis): ATSReport {
  const checks: ATSCheck[] = [];
  const warnings: string[] = [];

  checks.push(check("email", "Email address", 8, r.contact.email ? 1 : 0, r.contact.email ?? "No email found"));
  checks.push(check("phone", "Phone number", 5, r.contact.phone ? 1 : 0, r.contact.phone ?? "No phone number found"));
  const links = [r.contact.linkedin, r.contact.github].filter(Boolean).length;
  checks.push(check("links", "LinkedIn / GitHub", 5, links / 2, links ? `${links} of 2 profile links found` : "No LinkedIn or GitHub link"));

  checks.push(check("education", "Education section", 10, r.sections.education ? 1 : 0,
    r.sections.education ? "Found" : "No clearly labelled Education heading"));
  const hasWork = !!(r.sections.experience || r.sections.projects);
  checks.push(check("experience", "Experience or Projects section", 10, hasWork ? 1 : 0,
    hasWork ? "Found" : "No Experience or Projects heading"));
  checks.push(check("skills_section", "Skills section", 8, r.sections.skills ? 1 : 0,
    r.sections.skills ? "Found" : "No dedicated Skills heading"));

  const skillCount = r.skills.size;
  checks.push(check("skills_count", "Recognisable skills", 10, skillCount / 8, `${skillCount} skills recognised (target 8+)`));

  const bulletCount = r.bullets.length;
  checks.push(check("bullets", "Bullet points", 10, bulletCount / 6, `${bulletCount} bullet points (target 6+)`));

  const quantRatio = bulletCount ? r.quantifiedBullets.length / bulletCount : 0;
  checks.push(check("quantified", "Quantified impact", 14, quantRatio / 0.4,
    `${r.quantifiedBullets.length} of ${bulletCount} bullets include numbers (target 40%+)`));

  const verbRatio = bulletCount ? r.actionVerbBullets.length / bulletCount : 0;
  checks.push(check("action_verbs", "Strong action verbs", 10, verbRatio / 0.6,
    `${r.actionVerbBullets.length} of ${bulletCount} bullets start with an action verb (target 60%+)`));

  const wc = r.wordCount;
  const lengthRatio = wc < 250 ? wc / 250 : wc > 1000 ? Math.max(0, 1 - (wc - 1000) / 600) : 1;
  checks.push(check("length", "Length", 10, lengthRatio, `${wc} words (ideal 250–1000 for a 1–2 page resume)`));

  if (wc < 120) warnings.push("Very little text was extracted. The PDF may be scanned or built from images, which most ATS can't read.");
  if (/[\u{1F300}-\u{1FAFF}]/u.test(r.text)) warnings.push("Emoji found. Some ATS parsers drop or garble them.");

  const max = checks.reduce((s, c) => s + c.maxPoints, 0);
  const got = checks.reduce((s, c) => s + c.points, 0);
  return { score: Math.round((got / max) * 100), checks, warnings };
}
