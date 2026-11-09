import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredResume } from "@internova/core";
import { getResumes, getSettings, hasApiKey, type AISettings } from "../storage";
import { AnalyzeView } from "./AnalyzeView";
import { AutofillView } from "./AutofillView";
import { ProfileView } from "./ProfileView";
import { JobsView } from "./JobsView";
import { startAutoSync } from "../cloud";
import { SettingsView } from "./SettingsView";

type Tab = "analyze" | "autofill" | "jobs" | "profile" | "settings";

const TAB_LABEL: Record<Tab, string> = { analyze: "Analyze", autofill: "Autofill", jobs: "Jobs", profile: "Profile", settings: "Settings" };

export function App() {
  const [tab, setTab] = useState<Tab>("analyze");
  const [resumes, setResumes] = useState<StoredResume[]>([]);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [keySet, setKeySet] = useState(false);
  const firstLoad = useRef(true);

  const refresh = useCallback(async () => {
    const [r, s, k] = await Promise.all([getResumes(), getSettings(), hasApiKey()]);
    setResumes(r);
    setSettings(s);
    setKeySet(k);
    // First open with no resumes: start on the Resumes tab
    if (firstLoad.current) {
      firstLoad.current = false;
      if (!r.length) setTab("profile");
    }
  }, []);

  // Cloud sync (only when this build has Supabase configured and the user is signed in)
  useEffect(() => startAutoSync((r) => { if (r instanceof Error) console.error("Auto-sync failed:", r.message); }), []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◆</span> JobPilot
        </div>
        <nav className="tabs" role="tablist">
          {(["analyze", "autofill", "jobs", "profile", "settings"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>
      <main className="content">
        {tab === "analyze" && <AnalyzeView resumes={resumes} keySet={keySet} goTo={setTab} />}
        {tab === "autofill" && <AutofillView resumes={resumes} keySet={keySet} goTo={setTab} />}
        {tab === "jobs" && <JobsView />}
        {tab === "profile" && <ProfileView resumes={resumes} keySet={keySet} />}
        {tab === "settings" && settings && <SettingsView settings={settings} keySet={keySet} />}
      </main>
    </div>
  );
}
