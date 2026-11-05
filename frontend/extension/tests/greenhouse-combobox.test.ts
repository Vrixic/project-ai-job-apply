// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://boards.greenhouse.io/synthetic/jobs/123"}
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commandFieldsFromPacket } from "../lib/command-fields";
import { acceptableLabels, exactOption } from "../lib/greenhouse/combobox";
import { fillGreenhouseFields } from "../lib/greenhouse/fill";
import { inspectGreenhouseApplication } from "../lib/greenhouse/inspect";

const URL = "https://boards.greenhouse.io/synthetic/jobs/123";
const options = (...labels: string[]) =>
  labels.map((label) => Object.assign(document.createElement("div"), { textContent: label }));

describe("acceptableLabels", () => {
  it("accepts the value itself for any field", () => {
    expect(acceptableLabels("education.school", "Stanford University")).toEqual([
      "Stanford University",
    ]);
  });
  it.each([
    ["Bachelor of Science", "Bachelor's Degree"],
    ["B.S. in Computer Science", "Bachelor's Degree"],
    ["BA", "Bachelor's Degree"],
    ["Master of Science", "Master's Degree"],
    ["M.S.", "Master's Degree"],
    ["MBA", "Master of Business Administration (M.B.A.)"],
    ["PhD", "Doctor of Philosophy (Ph.D.)"],
    ["Associate of Arts", "Associate's Degree"],
    ["Juris Doctor", "Juris Doctor (J.D.)"],
    ["High School Diploma", "High School"],
  ])("maps the degree %s to its listed level", (value, label) => {
    expect(acceptableLabels("education.degree", value)).toContain(label);
  });
  it("does not guess a level for an unrelated or non-degree value", () => {
    expect(acceptableLabels("education.degree", "Certificate")).toEqual(["Certificate"]);
    expect(acceptableLabels("education.field", "Bachelor of Science")).toEqual([
      "Bachelor of Science",
    ]);
  });
});

describe("exactOption", () => {
  it("finds the one option whose text is exactly the value, ignoring case and spacing", () => {
    const list = options("Computer Science", "Computer Engineering", "Economics");
    expect(exactOption(list, "education.field", "  computer   science ")).toBe(list[0]);
  });
  it("never settles for a nearest or partial option", () => {
    const list = options("Computer Science and Engineering", "Computer Engineering");
    expect(exactOption(list, "education.field", "Computer Science")).toBeUndefined();
  });
  it("refuses when two options are the same text", () => {
    expect(exactOption(options("Other", "Other"), "education.field", "Other")).toBeUndefined();
  });
});

describe("preferred first name", () => {
  const field = (fieldKey: string, value: string, extra = {}) => ({
    fieldKey,
    value,
    origin: "confirmed_fact",
    reasons: [],
    disposition: "automatic",
    ...extra,
  });
  it("defaults to the approved first name and never replaces a saved one", () => {
    const derived = commandFieldsFromPacket({
      fields: [field("identity.legal_name.first", " Pat ")],
    } as never);
    expect(derived.find((entry) => entry.fieldKey === "identity.preferred_name")?.value).toBe(
      "Pat",
    );
    const saved = commandFieldsFromPacket({
      fields: [
        field("identity.legal_name.first", "Patricia"),
        field("identity.preferred_name", "Pat"),
      ],
    } as never);
    expect(
      saved.filter((entry) => entry.fieldKey === "identity.preferred_name").map((e) => e.value),
    ).toEqual(["Pat"]);
    const needsUser = commandFieldsFromPacket({
      fields: [field("identity.legal_name.first", "Pat", { disposition: "user_action" })],
    } as never);
    expect(needsUser.some((entry) => entry.fieldKey === "identity.preferred_name")).toBe(false);
  });
});

/** A small stand-in for the board's dropdown: opens on mouse release, lists options, shows the pick. */
function dropdownPage(labels: string[]) {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = `<form id="application_form">
    <label for="degree--0">Degree</label>
    <div class="select__control"><div class="select__value-container">
      <input id="degree--0" type="text" role="combobox" aria-expanded="false" aria-haspopup="true">
    </div></div>
  </form>`;
  const input = document.querySelector("#degree--0") as HTMLInputElement;
  const control = document.querySelector(".select__control") as HTMLElement;
  control.addEventListener("mouseup", () => {
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "react-select-degree--0-listbox");
    const list = document.createElement("div");
    list.id = "react-select-degree--0-listbox";
    for (const label of labels) {
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.textContent = label;
      option.addEventListener("click", () => {
        list.remove();
        input.setAttribute("aria-expanded", "false");
        const shown = document.createElement("div");
        shown.className = "select__single-value";
        shown.textContent = label;
        control.querySelector(".select__value-container")?.prepend(shown);
      });
      list.append(option);
    }
    document.body.append(list);
  });
  return { input, control };
}

const registry = () =>
  new AdapterRegistry(
    [
      {
        id: "greenhouse-application-v1",
        provider: "greenhouse",
        version: "0.1.0",
        variants: ["synthetic-unit-only"],
        capabilities: { autofill: true, fileAttach: false, confirmationDetection: false },
      },
    ],
    {
      enabled: { "greenhouse-application-v1": true },
      liveEffectsApproved: true,
      fixtureEvidence: {
        "greenhouse-application-v1": {
          kind: "provider_derived",
          authorizationRecordId: "SIMULATED-NOT-PROVIDER-EVIDENCE",
          sanitizationScanPassedAt: new Date().toISOString(),
          qaRepresentativenessAcceptedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          variantIds: ["synthetic-unit-only"],
        },
      },
    },
  );
const authority = () => ({
  registry: registry(),
  variantId: "synthetic-unit-only",
  deadline: Date.now() + 30_000,
  signal: new AbortController().signal,
  revalidateApproval: vi.fn(async () => undefined),
});
const packet = (degree: string) => [
  { fieldKey: "education.degree", value: degree, needsUserAction: false },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("filling a custom dropdown", () => {
  it("chooses the listed level for the approved degree", async () => {
    const { input, control } = dropdownPage(["Associate's Degree", "Bachelor's Degree", "Other"]);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet("Bachelor of Science"),
      authority(),
    );
    expect(result.selected).toEqual(["f0"]);
    expect(result.filled).toEqual([]);
    expect(control.querySelector(".select__single-value")?.textContent).toBe("Bachelor's Degree");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
  it("chooses the board's Other, and says so, when an education value is not listed", async () => {
    const { control } = dropdownPage(["Associate's Degree", "Other"]);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet("Certificate"),
      authority(),
    );
    expect(result.selected).toEqual(["f0"]);
    expect(result.notes).toEqual(["other:education.degree"]);
    expect(control.querySelector(".select__single-value")?.textContent).toBe("Other");
  });
  it("does not report a fallback when the exact option was chosen", async () => {
    dropdownPage(["Bachelor's Degree", "Other"]);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet("Bachelor of Science"),
      authority(),
    );
    expect(result.notes).toBeUndefined();
  });
  it("leaves the dropdown untouched when the board lists neither the value nor Other", async () => {
    const { input, control } = dropdownPage(["Associate's Degree", "Master's Degree"]);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet("Certificate"),
      authority(),
    );
    expect(result.selected).toEqual([]);
    expect(result.notes).toBeUndefined();
    expect(control.querySelector(".select__single-value")).toBeNull();
    expect(input.value).toBe("");
  });
  it("does not touch a dropdown the candidate already answered", async () => {
    const { control } = dropdownPage(["Bachelor's Degree", "Other"]);
    const answered = document.createElement("div");
    answered.className = "select__single-value";
    answered.textContent = "Other";
    control.querySelector(".select__value-container")?.prepend(answered);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet("Bachelor of Science"),
      authority(),
    );
    expect(result.selected).toEqual([]);
    expect(control.querySelector(".select__single-value")?.textContent).toBe("Other");
  });
});
