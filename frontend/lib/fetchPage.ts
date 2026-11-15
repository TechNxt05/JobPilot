import { isPublicHttpUrl } from "@internova/core";

const MAX_BYTES = 2_000_000;

/**
 * Fetch a public web page's HTML on the server. Every redirect hop is re-checked, so a page can't bounce the
 * request to localhost or a private address. Responses are capped at 2 MB and cached for 30 minutes.
 */
export async function fetchPublicHtml(url: string, timeoutMs = 15_000): Promise<{ html: string; finalUrl: string }> {
  let current = url;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error("Only public http(s) web addresses can be read.");
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobPilot/1.0; careers page reader)", Accept: "text/html,application/xhtml+xml" },
      next: { revalidate: 1800 },
    } as RequestInit);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`The page redirected without an address (${res.status}).`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The page answered ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) throw new Error("That address isn't a web page.");
    const reader = res.body?.getReader();
    if (!reader) return { html: await res.text(), finalUrl: current };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? chunks.reduce((n, c) => n + c.length, 0) : size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return { html: new TextDecoder().decode(buf), finalUrl: current };
  }
  throw new Error("Too many redirects.");
}
