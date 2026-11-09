import type { FormField } from "@internova/core";

export type ScannedField = Omit<FormField, "frameId">;

/**
 * Runs INSIDE the page (every frame) via chrome.scripting.executeScript({ func, allFrames: true }).
 * Must be self-contained: no imports or outer references.
 * Tags each control with data-internova-id so fillFields can find it again.
 */
export function scanFormFields(): ScannedField[] {
  const clean = (s: string | null | undefined) =>
    (s ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").replace(/^\s*\*\s*/, "").trim().slice(0, 250);
  const textOf = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };

  function labelFor(el: HTMLElement): string {
    const byLabels = (el as HTMLInputElement).labels;
    if (byLabels?.length) {
      // Label text minus the control's own text (e.g. a select's options inside the label)
      const t = Array.from(byLabels).map((l) => {
        const copy = l.cloneNode(true) as HTMLElement;
        copy.querySelectorAll("input, select, textarea, option").forEach((n) => n.remove());
        return clean(copy.textContent);
      }).join(" ");
      if (t) return t;
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
      if (t) return t;
    }
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    // Google Forms / generic question containers
    const item = el.closest('[role="listitem"], [data-automation-id^="formField"], .application-question, .field, .form-group, fieldset');
    if (item) {
      const heading = item.querySelector('[role="heading"], legend, label, .application-label, .text, [data-automation-id="formLabel"]');
      const t = textOf(heading);
      if (t) return t;
    }
    // Nearest preceding text within a few ancestors
    let node: HTMLElement | null = el;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      let sib = node.previousElementSibling as HTMLElement | null;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 200 && !sib.querySelector("input, select, textarea")) return t;
        sib = sib.previousElementSibling as HTMLElement | null;
      }
    }
    return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title"));
  }

  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
  const fields: ScannedField[] = [];
  const radioGroups = new Map<string, ScannedField>();
  let counter = 0;

  for (const node of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const el = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const tag = el.tagName.toLowerCase() as "input" | "select" | "textarea";
    const type = tag === "input" ? ((el as HTMLInputElement).type || "text").toLowerCase() : tag;
    if (SKIP_TYPES.has(type) || el.disabled || (el as HTMLInputElement).readOnly) continue;
    // File inputs are often visually hidden behind a styled button; keep them
    if (type !== "file" && !visible(el)) continue;

    if (!el.dataset.internovaId) el.dataset.internovaId = `f${Date.now().toString(36)}${counter++}`;
    const base: ScannedField = {
      iid: el.dataset.internovaId,
      tag,
      type,
      label: labelFor(el),
      name: el.getAttribute("name") ?? "",
      id: el.id ?? "",
      placeholder: el.getAttribute("placeholder") ?? "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      required: el.required || el.getAttribute("aria-required") === "true",
      options: tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => clean(o.text)) : [],
      currentValue:
        tag === "select"
          ? (el as HTMLSelectElement).selectedIndex > 0 ? clean((el as HTMLSelectElement).selectedOptions[0]?.text) : ""
          : type === "file" ? "" : (el.value ?? ""),
    };

    if (type === "radio" || type === "checkbox") {
      // One entry per group; the question text is the group's label, options are each choice's label
      const groupKey = `${type}:${el.getAttribute("name") || base.iid}`;
      const choice = labelFor(el);
      const group = radioGroups.get(groupKey);
      if (group) {
        group.options.push(choice);
        continue;
      }
      const container = el.closest('fieldset, [role="radiogroup"], [role="group"], [role="listitem"], .application-question, .field');
      const question = textOf(container?.querySelector('legend, [role="heading"], .application-label, label:not(:has(input))')) || choice;
      const entry = { ...base, label: question, options: [choice] };
      radioGroups.set(groupKey, entry);
      fields.push(entry);
      continue;
    }
    fields.push(base);
  }
  return fields;
}

export interface FillItem {
  iid: string;
  value: string;
}
export interface FillResult {
  iid: string;
  ok: boolean;
  error?: string;
}

/**
 * Runs INSIDE the page. Writes approved values only; never clicks buttons or submits.
 * Uses the native value setter + input/change events so React/Vue-controlled inputs update their state.
 */
export function fillFields(items: FillItem[]): FillResult[] {
  const results: FillResult[] = [];
  for (const { iid, value } of items) {
    const el = document.querySelector(`[data-internova-id="${CSS.escape(iid)}"]`) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    if (!el) {
      results.push({ iid, ok: false, error: "Field no longer on the page" });
      continue;
    }
    try {
      el.focus({ preventScroll: true });
      if (el instanceof HTMLInputElement && el.type === "radio") {
        // Radio group: click the choice whose label matches (a click is what frameworks listen for)
        const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
        const scope = el.form ?? document;
        const group = Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
        const labelOf = (r: HTMLInputElement) => norm(r.labels?.[0]?.textContent || r.getAttribute("aria-label") || r.value);
        const choice = group.find((r) => labelOf(r) === norm(value)) ?? group.find((r) => norm(r.value) === norm(value));
        if (!choice) {
          results.push({ iid, ok: false, error: "Option not found" });
          continue;
        }
        if (!choice.checked) choice.click();
        const box = (choice.closest("label") ?? choice) as HTMLElement;
        box.style.outline = "2px solid #3355ff";
        box.style.outlineOffset = "1px";
        results.push({ iid, ok: true });
        continue;
      }
      if (el instanceof HTMLSelectElement) {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
        const opt = Array.from(el.options).find((o) => norm(o.text) === norm(value) || norm(o.value) === norm(value));
        if (!opt) {
          results.push({ iid, ok: false, error: "Option not found" });
          continue;
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
        setter.call(el, opt.value);
      } else {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
        setter.call(el, value);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      // Visible marker so the user can see what JobPilot filled
      el.style.outline = "2px solid #3355ff";
      el.style.outlineOffset = "1px";
      el.title = "Filled by JobPilot. Please review.";
      results.push({ iid, ok: true });
    } catch (e) {
      results.push({ iid, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
