import type { FormField } from "@internova/core";

export type ScannedField = Omit<FormField, "frameId">;

/*
 * Page-side functions. Each runs INSIDE the page (every frame) via chrome.scripting.executeScript, so each must be
 * self-contained: no imports and no references to anything outside its own body. Small helpers are repeated on purpose.
 *
 * Kinds of controls (data-internova-kind on the control JobPilot fills):
 *   text   input / textarea              select  native <select>
 *   choice one of several (native radios, role=radio, Yes/No buttons); each choice carries data-internova-choice
 *   multi  checkbox group (native or role=checkbox)    bool  a lone checkbox (options Yes / No)
 *   combo  custom dropdown: role=combobox (React-Select, Ashby), button[aria-haspopup=listbox] (Workday),
 *          collapsible role=listbox (Google Forms). Options are read by opening it; typeaheads have none until you type.
 */

/** Scans the frame's form controls and tags each with data-internova-id so fillFields can find it again. */
export async function scanFormFields(): Promise<ScannedField[]> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const clean = (s: string | null | undefined) =>
    (s ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").replace(/^\s*\*\s*/, "").trim().slice(0, 250);
  const textOf = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  /** Not a real choice: "Select…", "No options", "Type to search" */
  const PLACEHOLDER = /^(select|choose|please (select|choose)|--|search|type to search|start typing|type to|no (options|results|matches)|loading|none selected)\b/i;
  // Fresh tags on every scan (ids stay stable): the page may have changed since the last one
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-internova-choice]"))) {
    delete el.dataset.internovaChoice;
    delete el.dataset.internovaLabel;
  }
  const claimed = new Set<Element>();
  const tagged = (el: Element) => claimed.has(el);

  function labelFor(el: HTMLElement): string {
    const byLabels = (el as HTMLInputElement).labels;
    if (byLabels?.length) {
      // Label text minus the control's own text (e.g. a select's options inside the label)
      const t = Array.from(byLabels).map((l) => {
        const copy = l.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input, select, textarea, option, button, [role=listbox]").forEach((n) => n.remove());
        return clean(copy.textContent);
      }).join(" ");
      if (t) return t;
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).filter((id) => id !== el.id).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
      if (t) return t;
    }
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    // Google Forms / Workday / Greenhouse question containers
    const item = el.closest('[role="listitem"], [data-automation-id^="formField"], .application-question, .field, .form-group, fieldset, [role="group"], [role="radiogroup"]');
    if (item) {
      const heading = item.querySelector('[role="heading"], legend, label, .application-label, .text, [data-automation-id="formLabel"]');
      if (heading && !heading.contains(el)) {
        const t = textOf(heading);
        if (t) return t;
      }
    }
    // Nearest preceding text within a few ancestors
    let node: HTMLElement | null = el;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      let sib = node.previousElementSibling as HTMLElement | null;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 200 && !sib.querySelector("input, select, textarea, [role=combobox], [role=radio]")) return t;
        sib = sib.previousElementSibling as HTMLElement | null;
      }
    }
    return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title"));
  }

  /** The question a group of choices answers. */
  function groupQuestion(container: Element | null, fallback: string): string {
    if (container) {
      const own = container.getAttribute("aria-labelledby");
      if (own) {
        const t = own.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
        if (t) return t;
      }
      const aria = clean(container.getAttribute("aria-label"));
      if (aria) return aria;
      const head = container.querySelector('legend, [role="heading"], .application-label, [data-automation-id="formLabel"], label:not(:has(input))');
      const t = textOf(head);
      if (t) return t;
      return labelFor(container as HTMLElement) || fallback;
    }
    return fallback;
  }

  /** Text that labels one choice (radio, checkbox, option button). */
  function choiceLabel(el: HTMLElement): string {
    if (el instanceof HTMLInputElement) {
      const l = el.labels?.[0];
      if (l) {
        const copy = l.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input").forEach((n) => n.remove());
        const t = clean(copy.textContent);
        if (t) return t;
      }
      return clean(el.getAttribute("aria-label")) || (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => textOf(document.getElementById(id))).join(" ").trim() || clean(el.value);
    }
    return clean(el.getAttribute("aria-label")) || textOf(el) || clean(el.getAttribute("data-value"));
  }

  const isChecked = (el: HTMLElement) =>
    el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true" ||
      el.getAttribute("aria-selected") === "true" || (el instanceof HTMLButtonElement && /(^|[\s_-])(selected|active|checked|is-selected)($|[\s_-])/i.test(el.className));

  /** A styled radio / checkbox hides the real input: it still counts when its label (or wrapper) is visible. */
  const choiceVisible = (el: HTMLInputElement) => visible(el) || Array.from(el.labels ?? []).some(visible) || (!!el.parentElement && visible(el.parentElement));

  let counter = 0;
  const newId = () => `f${Date.now().toString(36)}${counter++}`;
  const fields: ScannedField[] = [];
  const base = (el: HTMLElement, tag: ScannedField["tag"], type: string): ScannedField => {
    if (!el.dataset.internovaId) el.dataset.internovaId = newId();
    return {
      iid: el.dataset.internovaId,
      tag,
      type,
      label: labelFor(el),
      name: el.getAttribute("name") ?? "",
      id: el.id ?? "",
      placeholder: el.getAttribute("placeholder") ?? "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      required: (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true",
      options: [],
      currentValue: "",
    };
  };

  /* ---------- groups of choices: radios and checkboxes, native or ARIA ---------- */
  interface Group { anchor: HTMLElement; type: "radio" | "checkbox"; container: Element | null; choices: HTMLElement[] }
  const groups = new Map<string | Element, Group>();
  const order: (ScannedField | Group)[] = [];
  const groupContainer = (el: Element) =>
    el.closest('fieldset, [role="radiogroup"], [role="group"], [role="list"], [role="listitem"], .application-question, [data-automation-id^="formField"], .field, .form-group');
  function addChoice(el: HTMLElement, type: "radio" | "checkbox", groupKey?: Element) {
    const container = groupContainer(el);
    const name = el instanceof HTMLInputElement ? el.name : "";
    const key: string | Element = groupKey ?? (name ? `${type}:${el.closest("form")?.getAttribute("id") ?? ""}:${name}` : container ?? el);
    let g = groups.get(key);
    if (!g) {
      g = { anchor: el, type, container, choices: [] };
      groups.set(key, g);
      order.push(g);
    }
    g.choices.push(el);
    claimed.add(el);
  }

  /* ---------- custom dropdowns ---------- */
  const combos: HTMLElement[] = [];
  const isComboInput = (el: HTMLInputElement) =>
    el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox" ||
    (/^(list|both)$/.test(el.getAttribute("aria-autocomplete") ?? "") && !!(el.getAttribute("aria-controls") || el.getAttribute("aria-owns")));

  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
  for (const node of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const el = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const tag = el.tagName.toLowerCase() as "input" | "select" | "textarea";
    const type = tag === "input" ? ((el as HTMLInputElement).type || "text").toLowerCase() : tag;
    if (SKIP_TYPES.has(type) || el.disabled || (el as HTMLInputElement).readOnly && !isComboInput(el as HTMLInputElement)) continue;

    if (type === "radio" || type === "checkbox") {
      if (choiceVisible(el as HTMLInputElement)) addChoice(el, type);
      continue;
    }
    // File inputs are often visually hidden behind a styled button; keep them
    if (type !== "file" && !visible(el)) continue;
    if (tag === "input" && isComboInput(el as HTMLInputElement)) {
      combos.push(el);
      continue;
    }
    const f = base(el, tag, type);
    el.dataset.internovaKind = tag === "select" ? "select" : "text";
    if (tag === "select") {
      const s = el as HTMLSelectElement;
      f.options = Array.from(s.options).map((o) => clean(o.text));
      f.currentValue = s.selectedIndex > 0 || (s.selectedIndex === 0 && !PLACEHOLDER.test(clean(s.options[0]?.text)) && !!s.options[0]?.value)
        ? clean(s.selectedOptions[0]?.text) : "";
    } else if (type !== "file") f.currentValue = el.value ?? "";
    order.push(f);
  }

  // ARIA radios / checkboxes (Google Forms, design-system components)
  for (const node of Array.from(document.querySelectorAll('[role="radio"], [role="checkbox"], [role="switch"]'))) {
    const el = node as HTMLElement;
    if (el instanceof HTMLInputElement || tagged(el) || !visible(el) || el.getAttribute("aria-disabled") === "true") continue;
    // A styled wrapper around a native radio / checkbox (already counted)
    if (el.querySelector('input[type="radio"], input[type="checkbox"]') || el.closest("label")?.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
    addChoice(el, el.getAttribute("role") === "radio" ? "radio" : "checkbox");
  }

  // Yes / No answered with two buttons (Ashby and similar)
  const YES_NO = /^(yes|no|not sure|maybe|n\/a)$/i;
  for (const parent of new Set(Array.from(document.querySelectorAll("button")).map((b) => b.parentElement).filter((p): p is HTMLElement => !!p))) {
    const buttons = Array.from(parent.children).filter((c): c is HTMLButtonElement => c instanceof HTMLButtonElement);
    if (buttons.length < 2 || buttons.length > 4 || buttons.length !== parent.querySelectorAll("button").length) continue;
    const texts = buttons.map((b) => textOf(b));
    if (!texts.every((t) => YES_NO.test(t)) || !texts.some((t) => /^yes$/i.test(t)) || !buttons.every((b) => visible(b) && b.type !== "submit" && !tagged(b))) continue;
    for (const b of buttons) addChoice(b, "radio", parent);
    // No question container: the question is the label nearest the buttons
    const g = groups.get(parent);
    if (g && !g.container) g.container = parent;
  }

  // Custom dropdowns that aren't inputs
  for (const node of Array.from(document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [role="listbox"][aria-expanded]'))) {
    const el = node as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || !visible(el) || el.getAttribute("aria-disabled") === "true") continue;
    combos.push(el);
  }

  /* ---------- turn the choice groups into fields ---------- */
  const groupFields = new Map<Group, ScannedField>();
  for (const g of groups.values()) {
    const labels = g.choices.map(choiceLabel);
    const first = labels[0] ?? "";
    const question = groupQuestion(g.container, first);
    const f = base(g.anchor, "input", g.type);
    const lone = g.type === "checkbox" && g.choices.length === 1;
    g.choices.forEach((c, i) => {
      c.dataset.internovaChoice = f.iid;
      c.dataset.internovaLabel = lone ? "Yes" : labels[i];
    });
    g.anchor.dataset.internovaKind = lone ? "bool" : g.type === "radio" ? "choice" : "multi";
    if (lone) {
      // "I'm willing to relocate", "I agree to the privacy policy": a yes / no question
      f.label = question && question !== first ? `${question}: ${first}` : first;
      f.options = ["Yes", "No"];
      f.currentValue = isChecked(g.choices[0]) ? "Yes" : "";
    } else {
      f.label = question;
      f.options = labels;
      f.currentValue = g.choices.filter(isChecked).map(choiceLabel).join("\n");
    }
    f.name = g.anchor instanceof HTMLInputElement ? g.anchor.name : "";
    f.required = g.choices.some((c) => (c as HTMLInputElement).required || c.getAttribute("aria-required") === "true") ||
      g.container?.getAttribute("aria-required") === "true";
    groupFields.set(g, f);
  }

  /* ---------- custom dropdowns: read their options by opening them ---------- */
  const listboxOf = (el: HTMLElement): HTMLElement | null => {
    for (const attr of ["aria-controls", "aria-owns"]) {
      for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
        const lb = document.getElementById(id);
        if (lb && (lb.getAttribute("role") === "listbox" || lb.querySelector('[role="option"]'))) return lb;
      }
    }
    if (el.getAttribute("role") === "listbox") return el;
    return menuNear(el);
  };
  /** React-Select without ARIA ids: its menu ("…-menu" / "…__menu") inside the dropdown's own wrapper. */
  function menuNear(el: HTMLElement): HTMLElement | null {
    for (let i = 0, p = el.parentElement; p && i < 6; i++, p = p.parentElement) {
      if (p.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) return null;
      const menu = p.querySelector<HTMLElement>('[class*="-menu"], [class*="__menu"]');
      if (menu && !menu.contains(el) && menu.querySelector('[role="option"], [class*="-option"], [class*="__option"], [id*="-option-"]')) return menu;
    }
    return null;
  }
  const optionsIn = (lb: Element) => {
    const opts = Array.from(lb.querySelectorAll('[role="option"]'));
    return (opts.length ? opts : Array.from(lb.querySelectorAll('[class*="-option"], [class*="__option"], [id*="-option-"]')))
      .map((o) => clean(o.getAttribute("aria-label")) || textOf(o) || clean(o.getAttribute("data-value")))
      .filter((t) => t && !PLACEHOLDER.test(t));
  };
  const key = (el: HTMLElement, k: string, code: number) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true } as KeyboardEventInit));
  const press = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", at));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.dispatchEvent(new PointerEvent("pointerup", at));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.dispatchEvent(new MouseEvent("click", at));
  };
  /** Text the dropdown shows as its value ("" when it shows a placeholder). */
  const shownValue = (el: HTMLElement): string => {
    if (!(el instanceof HTMLInputElement)) {
      const t = textOf(el.querySelector('[aria-selected="true"]') ?? el);
      return PLACEHOLDER.test(t) ? "" : t.split(" ").length > 12 ? "" : t;
    }
    let box: HTMLElement = el;
    for (let i = 0, p = el.parentElement; p && i < 4; i++, p = p.parentElement) {
      if (p.querySelector("label, select, textarea") || p.querySelectorAll("input:not([type=hidden])").length > 1) break;
      box = p;
    }
    const t = clean(box === el ? el.value : (box.innerText || "").replace(el.value, ""));
    return PLACEHOLDER.test(t) || t === clean(el.placeholder) ? "" : t;
  };

  const seenCombo = new Set<HTMLElement>();
  let opened = 0;
  for (const el of combos) {
    if (seenCombo.has(el) || tagged(el) || el.closest("[data-internova-choice]")) continue;
    // One control per dropdown: skip a wrapper of an input we already have, or a part inside one
    if ([...seenCombo].some((s) => s.contains(el) || el.contains(s))) continue;
    seenCombo.add(el);
    const f = base(el, "select", "combobox");
    el.dataset.internovaKind = "combo";
    f.label = f.label.replace(/\s*\b(select one|required)\b\s*/gi, " ").replace(/\s+/g, " ").trim();
    f.currentValue = shownValue(el);
    if (f.currentValue && f.label.endsWith(f.currentValue)) f.label = f.label.slice(0, -f.currentValue.length).trim();

    let options = (() => {
      const lb = listboxOf(el);
      return lb ? optionsIn(lb) : [];
    })();
    if (!options.length && opened < 40) {
      opened++;
      const before = new Set(Array.from(document.querySelectorAll('[role="listbox"]')).filter(visible));
      el.scrollIntoView({ block: "center" });
      if (el instanceof HTMLInputElement) {
        el.focus();
        press(el);
        key(el, "ArrowDown", 40);
      } else press(el);
      let shown: string | null = null;
      for (let t = 0, steady = 0; t < 10 && !options.length && steady < 3; t++) {
        await sleep(80);
        const lb = listboxOf(el) ?? (Array.from(document.querySelectorAll('[role="listbox"]')).find((x) => !before.has(x) && visible(x)) as HTMLElement | undefined) ?? null;
        if (lb) options = optionsIn(lb);
        // "Type to search" / "No options" and not changing: a search-as-you-type dropdown
        const now = lb?.textContent ?? null;
        steady = now !== null && now === shown && !/loading/i.test(now) ? steady + 1 : 0;
        shown = now;
      }
      key(el, "Escape", 27);
      if (document.activeElement && document.activeElement !== document.body) key(document.activeElement as HTMLElement, "Escape", 27);
      (el as HTMLElement).blur();
      await sleep(40);
    }
    f.options = [...new Set(options)].slice(0, 400);
    // Google Forms / Workday keep a "Choose" option first
    order.push(f);
  }

  // Page order, as the person reads the form
  const elOf = (f: ScannedField) => document.querySelector(`[data-internova-id="${CSS.escape(f.iid)}"]`);
  const all = order.map((item) => ("anchor" in item ? groupFields.get(item)! : item));
  all.sort((a, b) => {
    const ea = elOf(a), eb = elOf(b);
    return !ea || !eb || ea === eb ? 0 : ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  fields.push(...all);
  return fields;
}

export interface FillItem {
  iid: string;
  /** Text, option text, or (checkbox groups) option texts joined by "\n" */
  value: string;
  /** Other names for the value, tried in search-as-you-type dropdowns ("Bangalore" for "Bengaluru") */
  alts?: string[];
}
export interface FillResult {
  iid: string;
  ok: boolean;
  error?: string;
}

/**
 * Runs INSIDE the page. Writes approved values only; never clicks Submit. Text goes in through the native value setter
 * plus input/change events (so React/Vue state updates); choices are clicked the way a person would.
 */
export async function fillFields(items: FillItem[]): Promise<FillResult[]> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const loose = (s: string | null | undefined) => norm((s ?? "").replace(/\([^)]*\)/g, " ")).replace(/['’`.]/g, "");
  const textOf = (el: Element | null | undefined) => norm((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const PLACEHOLDER = /^(select|choose|please (select|choose)|--|search|type to search|start typing|type to|no (options|results|matches)|loading)\b/i;
  const mark = (el: HTMLElement) => {
    el.style.outline = "2px solid #3355ff";
    el.style.outlineOffset = "1px";
    el.title = "Filled by JobPilot. Please review.";
  };
  const key = (el: HTMLElement, k: string, code: number) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true } as KeyboardEventInit));
  const press = (el: HTMLElement) => {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", at));
    el.dispatchEvent(new MouseEvent("mousedown", at));
    el.dispatchEvent(new PointerEvent("pointerup", at));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.dispatchEvent(new MouseEvent("click", at));
  };
  const isChecked = (el: HTMLElement) =>
    el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true";
  /** Click a choice like a person: native inputs via click() (also works when the input is visually hidden). */
  const choose = (el: HTMLElement) => (el instanceof HTMLInputElement ? el.click() : press(el));
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  /** Best option element for a value: exact, then without brackets, then starts with, then a single one containing it. */
  function pickOption(opts: HTMLElement[], value: string): HTMLElement | null {
    const label = (o: HTMLElement) => (o.getAttribute("aria-label") || (o as HTMLElement).innerText || o.textContent || "").trim();
    const real = opts.filter((o) => !PLACEHOLDER.test(label(o)) && o.getAttribute("aria-disabled") !== "true");
    const v = norm(value);
    const lv = loose(value);
    return real.find((o) => norm(label(o)) === v)
      ?? real.find((o) => loose(label(o)) === lv)
      ?? (() => {
        // "Bengaluru, Karnataka, India" for "Bengaluru", but not "Bengaluru Rural"
        const qualified = real.filter((o) => {
          const t = loose(label(o));
          return t.startsWith(lv) && /^\s*[,(/|–—-]/.test(t.slice(lv.length));
        });
        return qualified.sort((a, b) => label(a).length - label(b).length)[0] ?? null;
      })();
  }

  function listboxOf(el: HTMLElement, before: Set<Element>): HTMLElement | null {
    for (const attr of ["aria-controls", "aria-owns"]) {
      for (const id of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
        const lb = document.getElementById(id);
        if (lb && (lb.getAttribute("role") === "listbox" || lb.querySelector('[role="option"]'))) return lb;
      }
    }
    if (el.getAttribute("role") === "listbox" && el.querySelector('[role="option"]')) return el;
    for (let i = 0, p = el.parentElement; p && i < 6; i++, p = p.parentElement) {
      if (p.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) break;
      const menu = p.querySelector<HTMLElement>('[class*="-menu"], [class*="__menu"]');
      if (menu && !menu.contains(el) && menu.querySelector('[role="option"], [class*="-option"], [class*="__option"], [id*="-option-"]')) return menu;
    }
    return (Array.from(document.querySelectorAll('[role="listbox"]')).find((x) => !before.has(x) && visible(x) && x !== el) as HTMLElement | undefined) ?? null;
  }
  const optionEls = (lb: HTMLElement) => {
    const opts = Array.from(lb.querySelectorAll<HTMLElement>('[role="option"]'));
    return (opts.length ? opts : Array.from(lb.querySelectorAll<HTMLElement>('[class*="-option"], [class*="__option"], [id*="-option-"]'))).filter((o) => visible(o) || lb.getAttribute("role") === "listbox");
  };

  /** Open a custom dropdown, type to filter when it's a search box, click the matching option, check it took. */
  async function pickCombo(el: HTMLElement, value: string, alts: string[]): Promise<string | null> {
    const before = new Set(Array.from(document.querySelectorAll('[role="listbox"]')).filter(visible));
    const typeable = el instanceof HTMLInputElement;
    el.scrollIntoView({ block: "center" });
    if (typeable) {
      el.focus();
      press(el);
      key(el, "ArrowDown", 40);
    } else press(el);

    const names = [value, ...alts];
    const findOption = async (wait: number) => {
      let shown = "";
      let steady = 0;
      for (let t = 0; t < wait / 100; t++) {
        await sleep(100);
        const lb = listboxOf(el, before);
        if (!lb) continue;
        const opts = optionEls(lb);
        for (const n of names) {
          const opt = pickOption(opts, n);
          if (opt) return opt;
        }
        // Results came back without a match and stopped changing: no point waiting longer
        const now = lb.textContent ?? "";
        steady = now === shown ? steady + 1 : 0;
        shown = now;
        if (steady >= 4 && !/loading|searching/i.test(now)) return null;
      }
      return null;
    };
    let opt = await findOption(typeable ? 400 : 1500);
    if (!opt && typeable) {
      // Search box: type the value (suggestions often load from the server), then a shorter form of it
      const tried = new Set<string>();
      for (const q of [value, ...alts, value.split(/[,(]/)[0].trim()]) {
        if (!q || tried.has(norm(q))) continue;
        tried.add(norm(q));
        setValue(el as HTMLInputElement, q);
        opt = await findOption(2500);
        if (opt) break;
      }
    }
    if (!opt) {
      if (typeable) setValue(el as HTMLInputElement, "");
      key(el, "Escape", 27);
      return `No option matches “${value}”. Pick it yourself`;
    }
    opt.scrollIntoView({ block: "nearest" });
    press(opt);
    const want = loose((opt.getAttribute("aria-label") || opt.innerText || "").trim());
    for (let t = 0; t < 8; t++) {
      await sleep(80);
      const shown = loose(textOf(el instanceof HTMLInputElement ? el.closest('[class*="control"], [class*="container"]') ?? el.parentElement : el)) +
        " " + loose(typeable ? (el as HTMLInputElement).value : "");
      if (shown.includes(want) || opt.getAttribute("aria-selected") === "true" || !opt.isConnected) return null;
    }
    // Some menus close and show the value in a sibling: an open menu means the click didn't land
    return listboxOf(el, before) && visible(listboxOf(el, before)!) ? `Couldn't pick “${value}”. Pick it yourself` : null;
  }

  const results: FillResult[] = [];
  for (const { iid, value, alts = [] } of items) {
    const el = document.querySelector(`[data-internova-id="${CSS.escape(iid)}"]`) as HTMLElement | null;
    if (!el) {
      results.push({ iid, ok: false, error: "Field no longer on the page" });
      continue;
    }
    try {
      const kind = el.dataset.internovaKind ?? (el instanceof HTMLSelectElement ? "select" : "text");
      const choices = Array.from(document.querySelectorAll<HTMLElement>(`[data-internova-choice="${CSS.escape(iid)}"]`));
      const labelOf = (c: HTMLElement) => c.dataset.internovaLabel ?? "";

      if (kind === "choice") {
        const c = choices.find((x) => norm(labelOf(x)) === norm(value)) ?? choices.find((x) => loose(labelOf(x)) === loose(value));
        if (!c) { results.push({ iid, ok: false, error: "Option not found" }); continue; }
        if (!isChecked(c)) choose(c);
        await sleep(30);
        mark((c.closest("label") ?? c) as HTMLElement);
        results.push({ iid, ok: c instanceof HTMLInputElement ? c.checked : true });
        continue;
      }
      if (kind === "multi" || kind === "bool") {
        const want = new Set(value.split("\n").map(norm).filter(Boolean));
        let bad = 0;
        for (const c of choices) {
          const on = kind === "bool" ? want.has("yes") : want.has(norm(labelOf(c)));
          if (on !== isChecked(c)) choose(c);
          await sleep(20);
          if (c instanceof HTMLInputElement && c.checked !== on) bad++;
          if (on) mark((c.closest("label") ?? c) as HTMLElement);
        }
        results.push(bad ? { iid, ok: false, error: "Some boxes didn't change" } : { iid, ok: true });
        continue;
      }
      if (kind === "combo") {
        const err = await pickCombo(el, value, alts);
        mark((el.closest('[class*="control"]') as HTMLElement | null) ?? el);
        results.push(err ? { iid, ok: false, error: err } : { iid, ok: true });
        continue;
      }

      el.focus({ preventScroll: true });
      if (el instanceof HTMLSelectElement) {
        const opt = Array.from(el.options).find((o) => norm(o.text) === norm(value) || norm(o.value) === norm(value))
          ?? Array.from(el.options).find((o) => loose(o.text) === loose(value));
        if (!opt) { results.push({ iid, ok: false, error: "Option not found" }); continue; }
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, opt.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        setValue(el as HTMLInputElement | HTMLTextAreaElement, value);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      mark(el);
      results.push({ iid, ok: true });
    } catch (e) {
      results.push({ iid, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

export interface AttachItem {
  iid: string;
  /** File contents, base64 */
  b64: string;
  name: string;
}

/**
 * Runs INSIDE the page. Puts a PDF into a file upload field (the same as choosing it in the file picker), then
 * fires input/change so the site uploads or shows it. Self-contained: no outer references.
 */
export function attachFile(item: AttachItem): FillResult {
  const el = document.querySelector(`[data-internova-id="${CSS.escape(item.iid)}"]`) as HTMLInputElement | null;
  if (!el || el.type !== "file") return { iid: item.iid, ok: false, error: "Upload field no longer on the page" };
  try {
    const raw = atob(item.b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], item.name, { type: "application/pdf", lastModified: Date.now() });
    const accept = (el.accept || "").toLowerCase();
    if (accept && !/pdf|application\/\*|\*\/\*/.test(accept)) return { iid: item.iid, ok: false, error: `This field accepts ${el.accept}, not PDF` };
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const box = (el.closest("label, .field, .form-group, [class*='upload'], [class*='Upload']") ?? el.parentElement ?? el) as HTMLElement;
    box.style.outline = "2px solid #3355ff";
    box.style.outlineOffset = "2px";
    return { iid: item.iid, ok: el.files?.length === 1 };
  } catch (e) {
    return { iid: item.iid, ok: false, error: (e as Error).message };
  }
}
