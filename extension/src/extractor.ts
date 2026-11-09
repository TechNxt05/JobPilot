import type { JobPosting } from "@internova/core";

/**
 * Runs INSIDE the job page via chrome.scripting.executeScript({ func }).
 * Chrome serialises the function source, so it must be fully self-contained:
 * no imports, no references to anything outside its own body.
 *
 * Priority: user's text selection → schema.org JobPosting JSON-LD → site selectors → generic.
 */
export function extractJobFromPage(): JobPosting {
  const MAX = 15000;
  const clean = (s: string | null | undefined) =>
    (s ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const textOf = (el: Element | null) => (el ? clean((el as HTMLElement).innerText || el.textContent) : "");
  const first = (selectors: string[]) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = textOf(el);
      if (t) return t;
    }
    return "";
  };
  const htmlToText = (html: string) => {
    const doc = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "$&\n"), "text/html");
    doc.querySelectorAll("li").forEach((li) => li.prepend("• "));
    return clean(doc.body.textContent);
  };
  const metaTitle = clean(document.querySelector('meta[property="og:title"]')?.getAttribute("content") || document.title);

  // 1. Selection: lets the user point at the description on any site
  const selection = clean(window.getSelection()?.toString());
  if (selection.length > 200) {
    return { title: metaTitle || null, company: null, location: null, url: location.href, text: selection.slice(0, MAX), source: "selection" };
  }

  // 2. JSON-LD JobPosting (most career sites and ATSs publish it for Google Jobs)
  type LD = Record<string, unknown>;
  const flatten = (node: unknown): LD[] => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    const obj = node as LD;
    return [obj, ...flatten(obj["@graph"])];
  };
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent || "");
    } catch {
      continue;
    }
    const posting = flatten(data).find((n) => {
      const t = n["@type"];
      return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
    });
    if (posting && typeof posting.description === "string") {
      const org = posting.hiringOrganization as LD | undefined;
      const locs = ([] as unknown[]).concat(posting.jobLocation ?? []) as LD[];
      const addr = (locs[0]?.address ?? {}) as LD;
      const loc = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .map((v) => (typeof v === "string" ? v : (v as LD | undefined)?.name))
        .filter(Boolean)
        .join(", ");
      const remote = posting.jobLocationType === "TELECOMMUTE" ? "Remote" : "";
      return {
        title: clean(String(posting.title ?? "")) || metaTitle || null,
        company: clean(typeof org?.name === "string" ? org.name : "") || null,
        location: [loc, remote].filter(Boolean).join(" · ") || null,
        url: location.href,
        text: htmlToText(posting.description).slice(0, MAX),
        source: "json-ld",
        validThrough: typeof posting.validThrough === "string" ? posting.validThrough : null,
      };
    }
  }

  // 3. Site-specific selectors (job boards change markup often; JSON-LD and selection are the fallbacks)
  // companyFromPath: ATS URLs carry the company slug, e.g. jobs.lever.co/<company>/<id>
  const SITES: { name: string; host: RegExp; title: string[]; company: string[]; location: string[]; desc: string[]; companyFromPath?: boolean }[] = [
    {
      name: "linkedin",
      host: /(^|\.)linkedin\.com$/,
      title: [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"],
      company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"],
      location: [".job-details-jobs-unified-top-card__primary-description-container", ".jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
      desc: [".jobs-description__content", ".jobs-box__html-content", "#job-details", ".show-more-less-html__markup", ".description__text"],
    },
    {
      name: "indeed",
      host: /(^|\.)indeed\.com$/,
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1.jobsearch-JobInfoHeader-title", "h1"],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
      desc: ["#jobDescriptionText"],
    },
    {
      name: "greenhouse",
      host: /greenhouse\.io$/,
      title: [".app-title", ".job__title h1", "h1"],
      company: [".company-name"],
      location: [".location", ".job__location"],
      desc: ["#content", ".job__description", "#app_body"],
      companyFromPath: true,
    },
    {
      name: "lever",
      host: /(^|\.)lever\.co$/,
      title: [".posting-headline h2"],
      company: [".main-header-logo img[alt]"],
      location: [".posting-categories .location", ".sort-by-time.posting-category"],
      desc: [".posting-page .section-wrapper.page-full-width", ".content .section-wrapper"],
      companyFromPath: true,
    },
    {
      name: "workday",
      host: /myworkdayjobs\.com$/,
      title: ['[data-automation-id="jobPostingHeader"]'],
      company: [],
      location: ['[data-automation-id="locations"]'],
      desc: ['[data-automation-id="jobPostingDescription"]'],
    },
    {
      name: "internshala",
      host: /(^|\.)internshala\.com$/,
      title: [".profile_on_detail_page", ".heading_4_5.profile", "h1"],
      company: [".company_name a", ".company_name"],
      location: ["#location_names", ".location_link"],
      desc: [".internship_details", ".detail_view"],
    },
    {
      name: "naukri",
      host: /(^|\.)naukri\.com$/,
      title: ["h1"],
      company: ['[class*="jd-header-comp-name"] a', '[class*="comp-name"]'],
      location: ['[class*="location"] a'],
      desc: ['[class*="job-desc"]', '[class*="dang-inner-html"]'],
    },
  ];

  const host = location.hostname;
  const site = SITES.find((s) => s.host.test(host));
  if (site) {
    const desc = first(site.desc);
    if (desc.length > 150) {
      return {
        title: first(site.title) || metaTitle || null,
        company:
          first(site.company) ||
          (site.companyFromPath
            ? decodeURIComponent(location.pathname.split("/")[1] || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "") ||
          null,
        location: first(site.location).split("\n")[0] || null,
        url: location.href,
        text: desc.slice(0, MAX),
        source: `site:${site.name}`,
      };
    }
  }

  // 4. Generic: the largest content block that reads like a job description
  const JOB_WORDS = /(responsibilit|requirement|qualification|experience|skills|apply|you will|we are looking)/gi;
  const candidates = Array.from(document.querySelectorAll("main, article, [role='main'], section, div"))
    .filter((el) => (el as HTMLElement).offsetParent !== null || el.tagName === "MAIN")
    .map((el) => {
      const text = textOf(el);
      const hits = text.slice(0, 20000).match(JOB_WORDS)?.length ?? 0;
      // Prefer dense, job-like blocks over the whole page (which includes nav and footers)
      return { text, score: hits * 400 + Math.min(text.length, 8000) - Math.max(0, text.length - 12000) };
    })
    .filter((c) => c.text.length > 300);
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.text ?? textOf(document.body);
  return {
    title: clean(document.querySelector("h1")?.textContent) || metaTitle || null,
    company: clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")) || null,
    location: null,
    url: location.href,
    text: best.slice(0, MAX),
    source: "generic",
  };
}
