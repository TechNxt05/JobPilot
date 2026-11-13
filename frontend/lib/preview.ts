/**
 * Local UI preview only (NEXT_PUBLIC_UI_PREVIEW=1 with `next dev`): lets the signed-in screens render
 * without a session, filled with clearly synthetic data. Never enabled in production builds.
 */
import type { Application, Contact } from "@internova/core";
import type { Scan } from "./findJobs";

export const UI_PREVIEW = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_UI_PREVIEW === "1";

const day = 86_400_000;
const now = Date.now();
const iso = (d: number) => new Date(now - d * day).toISOString();
const date = (d: number) => new Date(now - d * day).toISOString().slice(0, 10);

const app = (id: string, title: string, company: string, status: Application["status"], score: number, followUp: number | null, created: number): Application => ({
  id, title, company, location: "Bengaluru", url: `https://example.com/${id}`, status, score, resumeName: "Resume v3 (ML)",
  deadline: "", appliedAt: status === "saved" ? null : now - (created - 1) * day, followUpOn: followUp === null ? "" : date(followUp),
  notes: "", createdAt: now - created * day, updatedAt: now - created * day,
});

export const previewApplications: Application[] = [
  app("p1", "SDE-1, Payments", "Groww (demo)", "interviewing", 74, -2, 9),
  app("p2", "Backend Engineer", "Zeta (demo)", "applied", 69, 1, 6),
  app("p3", "Software Engineer Intern", "CRED (demo)", "applied", 66, 2, 8),
  app("p4", "ML Engineer Intern", "InMobi (demo)", "saved", 63, null, 2),
  app("p5", "Platform Engineer", "Druva (demo)", "rejected", 58, null, 20),
];

export const previewContacts: Contact[] = [
  { id: "c1", company: "Razorpay (demo)", email: "asha@example.com", name: "Asha R.", title: "Talent Partner", country: "India", city: "Bengaluru", department: "", roleTags: [], source: "demo", linkedin: "", status: "verified", outreach: "sent", lastContactedAt: iso(8), followUpOn: date(1), notes: "" },
];

export const previewScan: Scan = {
  at: now - 2 * 3_600_000,
  boards: {
    matched: 23, scanned: 6937, companies: 31,
    jobs: [
      ["Software Engineer, Backend", "Razorpay (demo)", "Bengaluru, India", 82, 1, "greenhouse", [{ kind: "experience", severity: "caution", message: "Asks for 1+ years; your resume shows about 0.5" }]],
      ["Applied AI Engineer", "Sarvam AI (demo)", "Bengaluru", 79, 2, "ashby", []],
      ["SDE Intern, Platform", "Meesho (demo)", "Bangalore, Karnataka", 71, 0, "lever", []],
      ["Software Engineer, Delivery", "GitLab (demo)", "Remote, India", 68, 3, "greenhouse", []],
      ["Data Engineer", "Bosch (demo)", "Bengaluru, KA, India", 61, 4, "smartrecruiters", []],
      ["ML Engineer, Inference", "ElevenLabs (demo)", "Remote", 54, 5, "ashby", [{ kind: "experience", severity: "blocker", message: "Asks for 3+ years; your resume shows about 0.5" }]],
    ].map(([title, company, location, score, age, ats, flags], i) => ({
      id: `greenhouse:demo:${i}`, ats: ats as "greenhouse", slug: "demo", company: company as string, title: title as string, location: location as string,
      remote: /remote/i.test(location as string), department: "Engineering", url: `https://example.com/job/${i}`, applyUrl: `https://example.com/job/${i}`,
      postedAt: iso(age as number), text: "Synthetic description for the local UI preview.", score: score as number, resumeName: "Resume v3 (ML)",
      matchedSkills: ["Python", "FastAPI", "PostgreSQL"], missingSkills: i % 2 ? ["Kubernetes"] : [], flags: flags as never, deadline: null, contacts: i === 0 ? 1 : 0,
    })),
  },
  search: {
    query: "AI / backend engineer · India",
    jobs: [
      { role: "Backend Developer Intern", company: "Acme Labs (demo)", location: "Pune", apply_link: "https://example.com/s/1" },
      { role: "AI Engineer (Fresher)", company: "Northwind AI (demo)", location: "Hyderabad", apply_link: "https://example.com/s/2" },
    ],
  },
};
