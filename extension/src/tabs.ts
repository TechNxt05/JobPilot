/** Helpers for running injected functions in the job tab (the tab next to the side panel). */

export const ALL_SITES = ["https://*/*", "http://*/*"];

export class NoAccessError extends Error {
  constructor() {
    super("JobPilot can't read this page yet.");
    this.name = "NoAccessError";
  }
}

export async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  return tab.id;
}

/** Run a self-contained function in the active tab's top frame. Throws NoAccessError without host permission. */
export async function runInPage<R>(func: () => R): Promise<R | undefined> {
  const tabId = await activeTabId();
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func });
    return res?.result as R | undefined;
  } catch {
    throw new NoAccessError();
  }
}

/** Run in every frame we may access (application forms are often embedded iframes). */
export async function runInAllFrames<R>(func: () => R): Promise<{ frameId: number; result: R }[]> {
  const tabId = await activeTabId();
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func });
    return res.filter((r) => r.result !== undefined && r.result !== null).map((r) => ({ frameId: r.frameId, result: r.result as R }));
  } catch {
    throw new NoAccessError();
  }
}

export async function runInFrame<A, R>(frameId: number, func: (arg: A) => R, arg: A): Promise<R | undefined> {
  const tabId = await activeTabId();
  const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args: [arg] });
  return res?.result as R | undefined;
}

/** Must be called directly from a click handler (user gesture). */
export function requestAllSites(): Promise<boolean> {
  return chrome.permissions.request({ origins: ALL_SITES });
}
