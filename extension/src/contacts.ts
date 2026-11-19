import { contactsForCompany, STARTER_LISTS, type Contact, type ContactStatus } from "@internova/core";
import { cloudConfigured, currentUser, supabase } from "./cloud";

/**
 * Recruiter / HR emails for a company: the user's own contact list (Supabase, the website's Outreach page) when
 * signed in, then the shared HR starter lists bundled with JobPilot. Read only: nothing is ever emailed from here.
 */
export interface CompanyContact {
  email: string;
  name: string;
  title: string;
  status: ContactStatus;
  /** yours: in your JobPilot contact list; list: from a shared HR list (generic careers mailbox, unverified) */
  origin: "yours" | "list";
  notes: string;
}

type Row = Pick<Contact, "company" | "email" | "name" | "title" | "department" | "status" | "notes">;

let cache: { userId: string; at: number; rows: Row[] } | null = null;
const CACHE_MS = 10 * 60e3;

/** The signed-in user's contacts (cached for a few minutes; the list rarely changes while applying). */
async function myContacts(): Promise<Row[] | null> {
  if (!cloudConfigured) return null;
  const user = await currentUser();
  if (!user) return null;
  if (cache && cache.userId === user.id && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows: Row[] = [];
  // PostgREST returns at most 1000 rows per request
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase().from("contacts").select("company, email, name, title, department, status, notes").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  cache = { userId: user.id, at: Date.now(), rows };
  return rows;
}

export async function companyContacts(company: string): Promise<{ contacts: CompanyContact[]; signedIn: boolean }> {
  if (!company.trim()) return { contacts: [], signedIn: false };
  const mine = await myContacts().catch(() => null);
  const out: CompanyContact[] = [];
  const seen = new Set<string>();
  const add = (c: Row, origin: CompanyContact["origin"]) => {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ email: c.email.trim(), name: c.name ?? "", title: c.title ?? "", status: c.status, origin, notes: c.notes ?? "" });
  };
  for (const c of contactsForCompany(company, mine ?? [])) add(c, "yours");
  const shared: Row[] = STARTER_LISTS.flatMap((l) => l.contacts.map((c) => ({
    company: c.company, email: c.email, name: c.name, title: c.title, department: c.department,
    status: c.status ?? "unverified", notes: c.notes ?? "",
  })));
  for (const c of contactsForCompany(company, shared)) add(c, "list");
  return { contacts: out, signedIn: mine !== null };
}

