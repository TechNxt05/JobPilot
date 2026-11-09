import { useEffect, useState } from "react";
import { APPLICATION_STATUSES, jobKey, newApplication, type Application, type JobPosting } from "@internova/core";
import { getApplications, saveApplication } from "../storage";

interface Props {
  job: JobPosting | null;
  score?: number | null;
  resumeName?: string;
  deadline?: string | null;
  /** Autofill flow: offer "Track as applied" instead of "Save job" */
  applied?: boolean;
}

/** Save the current job to the tracker, or show its status if it's already tracked. */
export function TrackButton({ job, score = null, resumeName = "", deadline = null, applied }: Props) {
  const [existing, setExisting] = useState<Application | null>(null);
  const [page, setPage] = useState<{ title: string; url: string } | null>(null);

  useEffect(() => {
    // Without an extracted job (e.g. on an application form), fall back to the tab's title and URL
    if (!job) chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t?.url && setPage({ title: t.title ?? "", url: t.url }));
  }, [job]);

  const url = job?.url ?? page?.url ?? "";
  useEffect(() => {
    if (!url) return;
    const key = jobKey(url);
    const find = () => getApplications().then((all) => setExisting(all.find((a) => jobKey(a.url) === key) ?? null));
    find();
    const onChange = (c: Record<string, chrome.storage.StorageChange>) => c.applications && find();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [url]);

  if (!url) return null;

  if (existing) {
    const label = APPLICATION_STATUSES.find((s) => s.id === existing.status)?.label;
    return (
      <div className="row gap track">
        <span className="chip ok">Tracked: {label}</span>
        {applied && existing.status === "saved" && (
          <button className="btn small" onClick={() => saveApplication({ ...existing, status: "applied", appliedAt: Date.now() })}>Mark applied</button>
        )}
      </div>
    );
  }

  const add = () =>
    saveApplication(
      newApplication({
        title: job?.title ?? page?.title.replace(/\s*[|–—-]\s*[^|–—-]+$/, "") ?? "Untitled job",
        company: job?.company ?? "",
        location: job?.location ?? "",
        url,
        score,
        resumeName,
        deadline: deadline ?? "",
        status: applied ? "applied" : "saved",
        appliedAt: applied ? Date.now() : null,
      }),
    );

  return (
    <div className="row gap track">
      <button className="btn small" onClick={add}>{applied ? "Track as applied" : "Save job"}</button>
    </div>
  );
}
