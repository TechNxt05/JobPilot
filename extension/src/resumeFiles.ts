/**
 * Original resume PDFs (for attaching to application forms) and the latest tailored PDF from the Apply kit.
 * Kept in chrome.storage.local; when signed in, a resume uploaded on the website is fetched from your private
 * Supabase storage folder the first time it's needed. Files never go anywhere else.
 */
import { cloudConfigured, currentUser, supabase } from "./cloud";

const key = (id: string) => `pdf:${id}`;
const TAILORED = "tailoredPdf";

export interface PdfFile { name: string; bytes: Uint8Array }
export interface TailoredPdf extends PdfFile { jobUrl: string; jobTitle: string; company: string; at: number }

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function putResumePdf(id: string, bytes: Uint8Array): Promise<void> {
  await chrome.storage.local.set({ [key(id)]: toB64(bytes) });
  // Best effort: also keep a copy in your private cloud folder so the website and other browsers have it
  try {
    if (cloudConfigured) {
      const user = await currentUser();
      if (user) await supabase().storage.from("resumes").upload(`${user.id}/${id}.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    }
  } catch { /* offline or bucket missing: the local copy is enough */ }
}

export async function removeResumePdf(id: string): Promise<void> {
  await chrome.storage.local.remove(key(id));
}

/** The original PDF of a saved resume: local copy, else your cloud copy (cached locally), else null. */
export async function getResumePdf(id: string): Promise<Uint8Array | null> {
  const local = (await chrome.storage.local.get(key(id)))[key(id)];
  if (typeof local === "string") return fromB64(local);
  if (!cloudConfigured) return null;
  try {
    const user = await currentUser();
    if (!user) return null;
    const { data } = await supabase().storage.from("resumes").download(`${user.id}/${id}.pdf`);
    if (!data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    await chrome.storage.local.set({ [key(id)]: toB64(bytes) });
    return bytes;
  } catch {
    return null;
  }
}

export async function setTailoredPdf(t: TailoredPdf): Promise<void> {
  await chrome.storage.local.set({ [TAILORED]: { ...t, bytes: toB64(t.bytes) } });
}

export async function getTailoredPdf(): Promise<TailoredPdf | null> {
  const v = (await chrome.storage.local.get(TAILORED))[TAILORED] as (Omit<TailoredPdf, "bytes"> & { bytes: string }) | undefined;
  return v?.bytes ? { ...v, bytes: fromB64(v.bytes) } : null;
}

/** "Asha_Verma_Resume.pdf" style file name. */
export function resumeFileName(first: string, last: string, fallback = "Resume"): string {
  const n = [first, last].map((s) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "_")).filter(Boolean).join("_");
  return `${n ? `${n}_Resume` : fallback}.pdf`;
}
