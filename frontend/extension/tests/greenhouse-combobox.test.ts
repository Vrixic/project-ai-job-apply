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
function dropdownPage(labels: string[], id = "degree--0", question = "Degree") {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = `<form id="application_form">
    <label for="${id}">${question}</label>
    <div class="select__control"><div class="select__value-container">
      <input id="${id}" type="text" role="combobox" aria-expanded="false" aria-haspopup="true">
    </div></div>
  </form>`;
  const input = document.querySelector(`#${id}`) as HTMLInputElement;
  const control = document.querySelector(".select__control") as HTMLElement;
  control.addEventListener("mouseup", () => {
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", `react-select-${id}-listbox`);
    const list = document.createElement("div");
    list.id = `react-select-${id}-listbox`;
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
  it("says an education dropdown has no saved value to fill", async () => {
    const { control } = dropdownPage(["Bachelor's Degree", "Other"]);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      [{ fieldKey: "contact.email", value: "pat@example.invalid", needsUserAction: false }],
      authority(),
    );
    expect(result.selected).toEqual([]);
    expect(result.notes).toEqual(["empty:education.degree"]);
    expect(control.querySelector(".select__single-value")).toBeNull();
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

describe("a Yes/No question the candidate answered", () => {
  const ask = (
    answer: boolean | string,
    question: string,
    fieldKey = "authorization.us_authorized",
  ) => {
    const page = dropdownPage(["Yes", "No"], "question_1", question);
    return fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      [{ fieldKey, value: answer, needsUserAction: false }],
      authority(),
    ).then((result) => ({ result, page }));
  };
  it("chooses Yes for true and No for false", async () => {
    const yes = await ask(true, "Are you legally authorized to work in the United States?");
    expect(yes.result.selected).toEqual(["f0"]);
    expect(yes.page.control.querySelector(".select__single-value")?.textContent).toBe("Yes");
    document.body.innerHTML = "";
    const no = await ask(false, "Are you legally authorized to work in the United States?");
    expect(no.page.control.querySelector(".select__single-value")?.textContent).toBe("No");
  });
  it("answers a sponsorship question from the sponsorship answer", async () => {
    const page = await ask(
      true,
      "Do you require or will you require a work authorization?",
      "authorization.sponsorship_required",
    );
    expect(page.page.control.querySelector(".select__single-value")?.textContent).toBe("Yes");
  });
  it("does not answer No for a question that also names another country", async () => {
    const { result, page } = await ask(false, "Are you eligible to work in the U.S. or Canada?");
    expect(result.selected).toEqual([]);
    expect(result.notes).toEqual(["check:authorization.us_authorized"]);
    expect(page.control.querySelector(".select__single-value")).toBeNull();
  });
  it("still answers Yes for a question that names another country", async () => {
    const { result } = await ask(true, "Are you eligible to work in the U.S. or Canada?");
    expect(result.selected).toEqual(["f0"]);
  });
});

describe("a salary question the candidate's desired salary answers", () => {
  const RANGES = ["$80,000 - $100,000", "$100,000 - $120,000", "$120,000 - $140,000", "$140,000+"];
  const salary = (value: number | null) => [
    { fieldKey: "job.salary_expectation", value, needsUserAction: value === null },
  ];
  const run = (labels: string[], question: string, value: number | null) => {
    const page = dropdownPage(labels, "question_9", question);
    return fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      salary(value),
      authority(),
    ).then((result) => ({ result, page }));
  };
  const shown = (page: { control: HTMLElement }) =>
    page.control.querySelector(".select__single-value")?.textContent;

  it("chooses the range that holds the salary", async () => {
    const { result, page } = await run(RANGES, "Salary expectations", 130_000);
    expect(shown(page)).toBe("$120,000 - $140,000");
    expect(result.selected).toEqual(["f0"]);
    expect(result.notes).toBeUndefined();
  });

  it("chooses the highest range, and says it was the closest, when none holds it", async () => {
    const closed = ["$50,000 - $75,000", "$75,000 - $100,000"];
    const { result, page } = await run(closed, "Desired salary", 180_000);
    expect(shown(page)).toBe("$75,000 - $100,000");
    expect(result.notes).toEqual(["near:job.salary_expectation"]);
  });

  it("chooses the lowest range when the salary is below them all", async () => {
    const closed = ["$50,000 - $75,000", "$75,000 - $100,000"];
    const { result, page } = await run(closed, "Desired salary", 30_000);
    expect(shown(page)).toBe("$50,000 - $75,000");
    expect(result.notes).toEqual(["near:job.salary_expectation"]);
  });

  it("leaves a list that holds no annual dollar range to the candidate", async () => {
    const { result, page } = await run(
      ["Negotiable", "Prefer not to say"],
      "Salary expectations",
      120_000,
    );
    expect(result.selected).toEqual([]);
    expect(shown(page)).toBeUndefined();
  });

  it("leaves an hourly question and a missing salary to the candidate", async () => {
    expect(
      (await run(["$20/hour", "$30/hour"], "Desired hourly salary", 120_000)).result.selected,
    ).toEqual([]);
    document.body.innerHTML = "";
    expect((await run(RANGES, "Salary expectations", null)).result.selected).toEqual([]);
  });

  it("fills a plain dropdown of ranges too, with the closest-range note when none holds it", async () => {
    window.history.replaceState(null, "", URL);
    const list = (labels: string[]) =>
      `<form id="application_form"><label for="s">Salary expectations</label><select id="s" name="s">${labels.map((l) => `<option>${l}</option>`).join("")}</select></form>`;
    document.body.innerHTML = list([
      "$50,000 - $75,000",
      "$75,000 - $100,000",
      "$100,000 - $125,000",
    ]);
    const held = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      salary(90_000),
      authority(),
    );
    expect((document.querySelector("#s") as HTMLSelectElement).value).toBe("$75,000 - $100,000");
    expect(held.filled).toEqual(["f0"]);
    expect(held.notes).toBeUndefined();
    document.body.innerHTML = list(["$50,000 - $75,000", "$75,000 - $100,000"]);
    const closest = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      salary(250_000),
      authority(),
    );
    expect((document.querySelector("#s") as HTMLSelectElement).value).toBe("$75,000 - $100,000");
    expect(closest.notes).toEqual(["near:job.salary_expectation"]);
  });

  it("answers Yes when the posted range can pay the salary, No when it cannot", async () => {
    const ask = "Does our posted annual salary of $100,000-$150,000 meet your salary expectations?";
    const yes = await run(["Yes", "No"], ask, 120_000);
    expect(shown(yes.page)).toBe("Yes");
    document.body.innerHTML = "";
    const no = await run(["Yes", "No"], ask, 200_000);
    expect(shown(no.page)).toBe("No");
    document.body.innerHTML = "";
    // Above what the employer posts is a no; below it is still a yes: the range meets it.
    const below = await run(["Yes", "No"], ask, 90_000);
    expect(shown(below.page)).toBe("Yes");
  });

  it("does not answer the posted-salary question when it posts no range or no salary is set", async () => {
    const noRange = await run(["Yes", "No"], "Does the salary meet your expectations?", 120_000);
    expect(noRange.result.selected).toEqual([]);
    document.body.innerHTML = "";
    const noSalary = await run(
      ["Yes", "No"],
      "Does our posted salary of $100,000-$150,000 meet your salary expectations?",
      null,
    );
    expect(noSalary.result.selected).toEqual([]);
  });
});
