import { normalizeProfile, type Application, type CandidateProfile, type ProviderConfig, type ProviderId, type SavedAnswer, type StoredResume } from "@internova/core";

/**
 * Storage layout
 *  - chrome.storage.local  : resumes, AI settings (fallback order/models/persist flag), keys only if the user opted in
 *  - chrome.storage.session: API keys (one per provider) by default. In memory only, cleared when the browser closes, and
 *                            (by Chrome's default access level) unreadable from content scripts.
 *
 * Nothing here is encrypted. chrome.storage is not a secrets vault: anyone with access to this
 * browser profile can read a persisted key. The Settings screen says so.
 */

export interface AISettings {
  /** Providers in fallback order: the first with a key is tried first, then the next… */
  order: ProviderId[];
  /** Optional model override per provider (empty → provider default) */
  models: Partial<Record<ProviderId, string>>;
  persistKey: boolean;
}

export type ApiKeys = Partial<Record<ProviderId, string>>;

export const ALL_PROVIDERS: ProviderId[] = ["groq", "gemini", "openrouter", "openai"];
const DEFAULT_SETTINGS: AISettings = { order: [...ALL_PROVIDERS], models: {}, persistKey: false };
const KEYS = "apiKeys";
const LEGACY_KEY = "apiKey";

export async function getResumes(): Promise<StoredResume[]> {
  const { resumes } = await chrome.storage.local.get("resumes");
  return Array.isArray(resumes) ? resumes : [];
}

export async function saveResume(resume: StoredResume): Promise<void> {
  resume = { ...resume, updatedAt: Date.now() };
  const all = await getResumes();
  const i = all.findIndex((r) => r.id === resume.id);
  if (i >= 0) all[i] = resume;
  else all.push(resume);
  await chrome.storage.local.set({ resumes: all });
}

export async function deleteResume(id: string): Promise<void> {
  const all = await getResumes();
  await chrome.storage.local.set({ resumes: all.filter((r) => r.id !== id) });
  await addTombstone("resumes", id);
}

// ---- Deletion records, so deletes sync across devices ----

export type TombstoneCollection = "resumes" | "answers" | "applications";

export async function getTombstones(c: TombstoneCollection): Promise<Record<string, number>> {
  const { tombstones } = await chrome.storage.local.get("tombstones");
  return tombstones?.[c] ?? {};
}

export async function setTombstones(c: TombstoneCollection, value: Record<string, number>): Promise<void> {
  const { tombstones } = await chrome.storage.local.get("tombstones");
  await chrome.storage.local.set({ tombstones: { ...(tombstones ?? {}), [c]: value } });
}

async function addTombstone(c: TombstoneCollection, id: string) {
  await setTombstones(c, { ...(await getTombstones(c)), [id]: Date.now() });
}

// ---- Application tracker ----

export async function getApplications(): Promise<Application[]> {
  const { applications } = await chrome.storage.local.get("applications");
  return Array.isArray(applications) ? applications : [];
}

export async function saveApplication(app: Application): Promise<Application> {
  const saved = { ...app, updatedAt: Date.now() };
  const all = await getApplications();
  const i = all.findIndex((a) => a.id === app.id);
  if (i >= 0) all[i] = saved;
  else all.unshift(saved);
  await chrome.storage.local.set({ applications: all });
  return saved;
}

export async function deleteApplication(id: string): Promise<void> {
  await chrome.storage.local.set({ applications: (await getApplications()).filter((a) => a.id !== id) });
  await addTombstone("applications", id);
}

export async function getSettings(): Promise<AISettings> {
  const { aiSettings } = await chrome.storage.local.get("aiSettings");
  const raw = (aiSettings ?? {}) as Partial<AISettings> & { provider?: ProviderId; model?: string };
  // v0.3 single-provider settings → ordered list with that provider first
  const order = Array.isArray(raw.order) && raw.order.length
    ? [...raw.order.filter((p) => ALL_PROVIDERS.includes(p)), ...ALL_PROVIDERS.filter((p) => !raw.order!.includes(p))]
    : raw.provider ? [raw.provider, ...ALL_PROVIDERS.filter((p) => p !== raw.provider)] : [...ALL_PROVIDERS];
  const models = { ...(raw.models ?? {}), ...(raw.provider && raw.model ? { [raw.provider]: raw.model } : {}) };
  return { ...DEFAULT_SETTINGS, order, models, persistKey: !!raw.persistKey };
}

async function migrateLegacyKey(): Promise<void> {
  const { aiSettings } = await chrome.storage.local.get("aiSettings");
  const provider = (aiSettings?.provider as ProviderId | undefined) ?? "groq";
  for (const area of [chrome.storage.session, chrome.storage.local]) {
    const { [LEGACY_KEY]: legacy } = await area.get(LEGACY_KEY);
    if (legacy) {
      const { [KEYS]: existing } = await area.get(KEYS);
      await area.set({ [KEYS]: { ...(existing ?? {}), [provider]: legacy } });
      await area.remove(LEGACY_KEY);
    }
  }
}

/** All saved keys (session first, then persisted). Only the service worker and Settings should call this. */
export async function readApiKeys(): Promise<ApiKeys> {
  await migrateLegacyKey();
  const [{ [KEYS]: local }, { [KEYS]: session }] = await Promise.all([chrome.storage.local.get(KEYS), chrome.storage.session.get(KEYS)]);
  return { ...(local ?? {}), ...(session ?? {}) };
}

/**
 * Save settings and (optionally) keys. In `keys`, a provider set to "" deletes its key and a provider
 * that's absent keeps its current key. Keys live in session storage unless persistKey is on.
 */
export async function saveSettings(settings: AISettings, keys: ApiKeys = {}): Promise<void> {
  const current = await readApiKeys();
  const next: ApiKeys = { ...current };
  for (const [p, k] of Object.entries(keys) as [ProviderId, string][]) {
    if (k === "") delete next[p];
    else if (k) next[p] = k.trim();
  }
  await chrome.storage.local.set({ aiSettings: { order: settings.order, models: settings.models, persistKey: settings.persistKey } });
  await chrome.storage.session.remove(KEYS);
  await chrome.storage.local.remove(KEYS);
  if (Object.keys(next).length) await (settings.persistKey ? chrome.storage.local : chrome.storage.session).set({ [KEYS]: next });
}

export async function configuredProviders(): Promise<ProviderId[]> {
  const [settings, keys] = await Promise.all([getSettings(), readApiKeys()]);
  return settings.order.filter((p) => keys[p]);
}

export async function hasApiKey(): Promise<boolean> {
  return (await configuredProviders()).length > 0;
}

export async function clearApiKey(provider?: ProviderId): Promise<void> {
  if (!provider) {
    await chrome.storage.session.remove([KEYS, LEGACY_KEY]);
    await chrome.storage.local.remove([KEYS, LEGACY_KEY]);
    return;
  }
  await saveSettings(await getSettings(), { [provider]: "" });
}

/** Providers with keys, in fallback order. Null when none is configured. */
export async function getProviderConfig(): Promise<ProviderConfig[] | null> {
  const [settings, keys] = await Promise.all([getSettings(), readApiKeys()]);
  const configs = settings.order.filter((p) => keys[p]).map((p) => ({ provider: p, apiKey: keys[p]!, model: settings.models[p] ?? "" }));
  return configs.length ? configs : null;
}

// ---- Autofill profile + answer library (Phase 3) ----

/** Stored profile, migrated to the current shape (v0.2 flat profiles are upgraded). */
export async function getProfile(): Promise<CandidateProfile | null> {
  const { profile } = await chrome.storage.local.get("profile");
  return profile ? normalizeProfile(profile) : null;
}

export async function saveProfile(profile: CandidateProfile): Promise<CandidateProfile> {
  const saved = { ...profile, updatedAt: Date.now() };
  await chrome.storage.local.set({ profile: saved });
  return saved;
}

export async function getAnswers(): Promise<SavedAnswer[]> {
  const { answers } = await chrome.storage.local.get("answers");
  return Array.isArray(answers) ? answers : [];
}

/** Insert or update; an answer to the same question (case-insensitive) is replaced. */
export async function saveAnswer(question: string, answer: string): Promise<void> {
  const all = await getAnswers();
  const q = question.trim();
  const i = all.findIndex((a) => a.question.trim().toLowerCase() === q.toLowerCase());
  const entry: SavedAnswer = { id: i >= 0 ? all[i].id : crypto.randomUUID(), question: q, answer: answer.trim(), updatedAt: Date.now() };
  if (i >= 0) all[i] = entry;
  else all.push(entry);
  await chrome.storage.local.set({ answers: all });
}

export async function deleteAnswer(id: string): Promise<void> {
  await chrome.storage.local.set({ answers: (await getAnswers()).filter((a) => a.id !== id) });
  await addTombstone("answers", id);
}
