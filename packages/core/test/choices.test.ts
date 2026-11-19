import { describe, expect, it } from "vitest";
import { naturalAnswer, valueAliases, bestOption, bestOptions, fitToField, isMultiChoice, isTypeahead, MULTI_SEP, planAutofill, profileFromResume, type FormField } from "../src";
import { RESUME } from "./fixtures";

const field = (label: string, extra: Partial<FormField> = {}): FormField => ({
  iid: "1", frameId: 0, tag: "input", type: "text", label, name: "", id: "", placeholder: "", autocomplete: "",
  required: false, options: [], currentValue: "", ...extra,
});

describe("option matching", () => {
  it("matches countries and cities by their other names", () => {
    expect(bestOption(["United States of America", "India", "United Kingdom"], "USA")).toBe("United States of America");
    expect(bestOption(["Bangalore", "Mumbai"], "Bengaluru")).toBe("Bangalore");
    expect(bestOption(["Bharat", "Nepal"], "India")).toBe("Bharat");
    expect(bestOption(["UK", "US", "IN"], "India")).toBe("IN");
  });

  it("lists other names to try when searching", () => {
    expect(valueAliases("Bengaluru")).toEqual(["bangalore"]);
    expect(valueAliases("USA")[0]).toBe("united states of america");
    expect(valueAliases("Pune")).toEqual([]);
  });

  it("ignores bracketed codes, apostrophes and accents", () => {
    expect(bestOption(["Nepal (+977)", "India (+91)"], "India")).toBe("India (+91)");
    expect(bestOption(["Bachelors", "Masters"], "Bachelor's")).toBe("Bachelors");
  });

  it("matches whole words only", () => {
    expect(bestOption(["British Indian Ocean Territory", "India"], "India")).toBe("India");
    expect(bestOption(["British Indian Ocean Territory", "Indonesia"], "India")).toBeNull();
    expect(bestOption(["India", "India - Remote"], "india")).toBe("India");
  });

  it("puts a number into the range that holds it", () => {
    const years = ["Less than 1 year", "1-2 years", "2-5 years", "5+ years"];
    expect(bestOption(years, "0")).toBe("Less than 1 year");
    expect(bestOption(years, "1.5")).toBe("1-2 years");
    expect(bestOption(years, "2")).toBe("2-5 years");
    expect(bestOption(years, "3 years")).toBe("2-5 years");
    expect(bestOption(years, "12")).toBe("5+ years");
    expect(bestOption(["0 to 3", "3 to 6", "More than 6"], "7")).toBe("More than 6");
  });

  it("keeps yes / no answers to the matching option", () => {
    expect(bestOption(["Yes, I am authorized", "No, I need sponsorship"], "Yes")).toBe("Yes, I am authorized");
  });

  it("picks every option an answer names for a checkbox group", () => {
    const opts = ["Python", "Java", "SQL", "Go"];
    expect(bestOptions(opts, "SQL, Python")).toBe(["Python", "SQL"].join(MULTI_SEP));
    expect(bestOptions(opts, "Python\nGo")).toBe(["Python", "Go"].join(MULTI_SEP));
    expect(bestOptions(opts, "Rust")).toBeNull();
    expect(bestOptions(["Yes, full time", "Part time"], "Yes, full time")).toBe("Yes, full time");
  });
});

describe("choice fields", () => {
  const profile = profileFromResume(RESUME);
  const checkboxes = field("Which teams would you like to join?", { type: "checkbox", options: ["Platform", "Data", "Search"] });
  const lone = field("I'm happy to work from the office", { type: "checkbox", options: ["Yes", "No"] });
  const typeahead = field("City", { tag: "select", type: "combobox" });

  it("fills a checkbox group from the profile when a saved question matches", () => {
    const [langs] = planAutofill([field("Which languages do you use?", { type: "checkbox", options: ["Python", "Cobol", "SQL"] })], profile);
    expect(langs.action).toBe("fill");
    expect(langs.value.split(MULTI_SEP)).not.toContain("Cobol");
  });

  it("tells the field types apart", () => {
    expect(isMultiChoice(checkboxes)).toBe(true);
    expect(isMultiChoice(lone)).toBe(false);
    expect(isTypeahead(typeahead)).toBe(true);
    expect(isTypeahead({ ...typeahead, options: ["Pune"] })).toBe(false);
  });

  it("fits answers to each kind of field", () => {
    expect(fitToField(checkboxes, "Search and Platform")).toBe(`Platform${MULTI_SEP}Search`);
    expect(fitToField(lone, "Yes")).toBe("Yes");
    expect(fitToField(typeahead, "Bengaluru")).toBe("Bengaluru");
    expect(fitToField(field("Country", { tag: "select", type: "combobox", options: ["India", "Nepal"] }), "IN")).toBe("India");
  });

  it("fills profile details asked as radio buttons or dropdowns", () => {
    const p = { ...profile, city: "Bengaluru", country: "India" };
    const [country, city, cityList] = planAutofill([
      field("Country", { type: "radio", options: ["India", "Other"] }),
      field("City", { tag: "select", type: "combobox" }),
      field("Current location", { tag: "select", type: "combobox", options: ["Bangalore", "Pune"] }),
    ], p);
    expect([country.action, country.value]).toEqual(["fill", "India"]);
    expect([city.action, city.value, city.selected]).toEqual(["fill", "Bengaluru", true]);
    expect(cityList.value).toBe("Bangalore");
  });

  it("lets AI choose for checkbox groups and lone checkboxes", () => {
    const [many, one] = planAutofill([checkboxes, lone], profile);
    expect([many.reason, many.aiDraftable]).toEqual(["choice", true]);
    expect(many.note).toContain("all that apply");
    expect(one.aiDraftable).toBe(true);
  });

  it("never fills consent checkboxes", () => {
    const [consent] = planAutofill([field("I agree to the privacy policy", { type: "checkbox", options: ["Yes", "No"] })], profile);
    expect([consent.action, consent.reason]).toEqual(["ask", "sensitive"]);
  });
});

describe("natural AI answers", () => {
  it("drops notes about the profile and bracketed placeholders", () => {
    expect(naturalAnswer("I have built production services in Python for 2 years. The profile does not specify the number of years of production experience I have writing Go or Ruby. [Please indicate those years]"))
      .toBe("I have built production services in Python for 2 years.");
    expect(naturalAnswer("The profile does not specify the number of years of production experience I have writing Go or Ruby. [Please indicate those years]")).toBe("");
    expect(naturalAnswer("My resume doesn't mention Kubernetes, but I deployed apps with Docker.")).toBe("");
    expect(naturalAnswer("Years: not specified.")).toBe("");
    expect(naturalAnswer("Please fill in your notice period.")).toBe("");
  });

  it("keeps real answers, including ones that mention a resume project", () => {
    const real = "I built a resume parser that does not need templates. It uses FastAPI and spaCy.";
    expect(naturalAnswer(real)).toBe(real);
    expect(naturalAnswer("Yes")).toBe("Yes");
    expect(naturalAnswer("Python\nSQL")).toBe("Python\nSQL");
    expect(naturalAnswer("No, I don't need sponsorship.")).toBe("No, I don't need sponsorship.");
  });
});
