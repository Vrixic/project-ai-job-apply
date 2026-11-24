// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001/apply"}
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { describe, expect, it, vi } from "vitest";
import { isActionable } from "../lib/actionable";
import {
  inspectLeverApplication,
  leverApplicationIdentity,
  leverChallengePresent,
} from "../lib/lever/inspect";
import { leverExecutionProfile } from "../lib/lever/profiles";
import { leverProvider } from "../lib/lever/provider";
import { providerForUrl } from "../lib/providers";

const URL = "https://jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001/apply";

// Synthetic page whose structure follows a public hosted Lever posting inspected read-only on
// 2026-11-24 (ADR-053 amendment): one form, question blocks with a label and a field, a transparent
// resume input over a visible button, a location autocomplete, custom-question cards, the idle
// hCaptcha (frames hidden by style) and a submit button of type "button". Not provider evidence.
const PAGE = `
<form id="application-form" enctype="multipart/form-data" method="POST">
  <ul>
    <li class="application-question resume"><label>
      <div class="application-label">Resume/CV <span class="required">✱</span></div>
      <div class="application-field"><a href="#" class="postings-btn">
        <span class="default-label">ATTACH RESUME/CV</span>
        <input class="application-file-input" id="resume-upload-input" name="resume" type="file" style="opacity:0"></a></div>
    </label></li>
    <li class="application-question"><label>
      <div class="application-label">Full name<span class="required">✱</span></div>
      <div class="application-field"><input type="text" name="name" required></div></label></li>
    <li class="application-question"><label>
      <div class="application-label">Email<span class="required">✱</span></div>
      <div class="application-field"><input name="email" type="email" required></div></label></li>
    <li class="application-question"><label>
      <div class="application-label">Phone </div>
      <div class="application-field"><input type="text" name="phone"></div></label></li>
    <li class="application-question"><label>
      <div class="application-label">Current location </div>
      <div class="application-field"><input class="location-input" id="location-input" type="text" name="location">
        <input id="selected-location" type="hidden" name="selectedLocation"></div></label></li>
    <li class="application-question"><label>
      <div class="application-label">LinkedIn URL</div>
      <div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label></li>
  </ul>
  <input type="hidden" name="cards[c1][baseTemplate]" value="{}">
  <ul>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width"><div class="text">Will you require visa sponsorship?<span class="required">✱</span></div></div>
      <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
        <li><label><input type="radio" name="cards[c1][field0]" value="No"><span class="application-answer-alternative">No</span></label></li>
        <li><label><input type="radio" name="cards[c1][field0]" value="Yes"><span class="application-answer-alternative">Yes</span></label></li>
      </ul></div></div></li>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width"><div class="text">Are you open to relocation?</div></div>
      <div class="application-field full-width"><select name="cards[c1][field1]">
        <option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option>
      </select></div></div></li>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width textarea"><div class="text">Why this position?<span class="required">✱</span></div></div>
      <div class="application-field full-width required-field"><textarea name="cards[c1][field2]" required="required"></textarea></div></div></li>
    <li class="application-question custom-question"><div>
      <div class="application-label full-width"><div class="text">Which tools do you use?</div></div>
      <div class="application-field full-width"><ul>
        <li><label><input type="checkbox" name="cards[c1][field3]" value="A"><span>A</span></label></li>
        <li><label><input type="checkbox" name="cards[c1][field3]" value="B"><span>B</span></label></li>
      </ul></div></div></li>
  </ul>
  <input id="hcaptchaResponseInput" type="hidden" name="h-captcha-response" value="">
  <button id="hcaptchaSubmitBtn" type="submit" class="hidden" style="display:none"></button>
  <div id="h-captcha" class="h-captcha" data-sitekey="synthetic">
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/synthetic" title="Widget containing checkbox for hCaptcha security challenge" style="visibility:hidden"></iframe>
  </div>
  <div class="last-section-apply"><button id="btn-submit" type="button" class="postings-btn template-btn-submit">Submit application</button></div>
</form>`;

const mount = () => {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = PAGE;
  return document;
};
const authority = () => ({
  registry: new AdapterRegistry(
    [
      {
        id: "lever-application-v1",
        provider: "lever",
        version: "0.1.0",
        variants: ["synthetic-unit-only"],
        capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
      },
    ],
    {
      enabled: { "lever-application-v1": true },
      liveEffectsApproved: true,
      fixtureEvidence: {
        "lever-application-v1": {
          kind: "provider_derived",
          authorizationRecordId: "SIMULATED-NOT-PROVIDER-EVIDENCE",
          sanitizationScanPassedAt: new Date().toISOString(),
          qaRepresentativenessAcceptedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          variantIds: ["synthetic-unit-only"],
        },
      },
    },
  ),
  variantId: "synthetic-unit-only",
  deadline: Date.now() + 30_000,
  signal: new AbortController().signal,
  revalidateApproval: vi.fn(async () => undefined),
  throwOnFailure: true,
});

describe("Lever identity", () => {
  it.each([URL, `${URL}?lever-source=x`, `${URL}/`])("recognizes %s", (url) => {
    expect(leverApplicationIdentity(url)).toEqual({
      tenant: "synthetic",
      jobId: "00000000-0000-4000-8000-000000000001",
    });
    expect(providerForUrl(url)?.id).toBe("lever");
  });
  it.each([
    "http://jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001/apply",
    "https://jobs.lever.co.evil.invalid/synthetic/00000000-0000-4000-8000-000000000001/apply",
    "https://user@jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001/apply",
    "https://jobs.lever.co:444/synthetic/00000000-0000-4000-8000-000000000001/apply",
    // The posting overview and the confirmation page are not the form.
    "https://jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001",
    "https://jobs.lever.co/synthetic/00000000-0000-4000-8000-000000000001/thanks",
    "https://jobs.lever.co/synthetic/not-a-posting/apply",
  ])("refuses %s", (url) => {
    expect(leverApplicationIdentity(url)).toBeUndefined();
    expect(providerForUrl(url)).toBeUndefined();
  });
});

describe("Lever inspection", () => {
  it("reads each question, leaving the location box and checkbox groups to the candidate", () => {
    const doc = mount();
    const inspected = inspectLeverApplication(doc, URL);
    expect(inspected.form.challengePresent).toBe(false);
    expect(
      inspected.form.fields.map((field) => [field.name, field.label, field.type, field.required]),
    ).toEqual([
      ["resume", "Resume/CV", "file", true],
      ["name", "Full name", "text", true],
      ["email", "Email", "text", true],
      ["phone", "Phone", "text", false],
      ["location", "Current location", "unknown", false],
      ["urls[LinkedIn]", "LinkedIn URL", "text", false],
      ["cards[c1][field0]", "Will you require visa sponsorship?", "radio", true],
      ["cards[c1][field1]", "Are you open to relocation?", "select", false],
      ["cards[c1][field2]", "Why this position?", "textarea", true],
      ["cards[c1][field3]", "Which tools do you use?", "unknown", false],
    ]);
    expect(inspected.form.fields[6]?.options).toEqual(["No", "Yes"]);
    // The placeholder option is not an answer.
    expect(inspected.form.fields[7]?.options).toEqual(["Yes", "No"]);
    inspected.dispose();
    expect(() => inspected.resolve("f1")).toThrow("LeverInspectionUnavailable");
  });

  it("treats the idle hCaptcha as no challenge, and a shown one or a credential prompt as one", () => {
    const doc = mount();
    expect(leverChallengePresent(doc)).toBe(false);
    doc.body.insertAdjacentHTML(
      "beforeend",
      '<div><iframe src="https://newassets.hcaptcha.com/captcha/v1/challenge" title="Main content of the hCaptcha challenge"></iframe></div>',
    );
    expect(leverChallengePresent(doc)).toBe(true);
    expect(leverChallengePresent(mount())).toBe(false);
    document.body.insertAdjacentHTML("beforeend", '<input type="password">');
    expect(leverChallengePresent(document)).toBe(true);
  });

  it.each(["replace", "navigate", "shown-challenge"])("invalidates handles after %s", (kind) => {
    const doc = mount();
    const inspected = inspectLeverApplication(doc, URL);
    if (kind === "replace")
      doc.querySelector('input[name="phone"]')?.replaceWith(doc.createElement("input"));
    if (kind === "navigate") window.history.replaceState(null, "", `${URL}?changed=1`);
    if (kind === "shown-challenge")
      doc.body.insertAdjacentHTML(
        "beforeend",
        '<iframe src="https://newassets.hcaptcha.com/captcha/v1/challenge"></iframe>',
      );
    expect(() => inspected.resolve("f3")).toThrow();
  });

  it("refuses a page with two forms or a duplicate field name", () => {
    const doc = mount();
    doc.body.insertAdjacentHTML("beforeend", '<form id="application-form"></form>');
    expect(() => inspectLeverApplication(doc, URL)).toThrow();
    const dup = mount();
    dup.querySelector('input[name="phone"]')?.setAttribute("name", "email");
    expect(() => inspectLeverApplication(dup, URL)).toThrow();
  });
});

describe("Lever execution surface", () => {
  it("always leaves the submit button to the candidate", () => {
    expect(leverProvider.candidateSubmits).toBe(true);
    const doc = mount();
    const profile = leverExecutionProfile("lever-standard-v1", "1.0.0");
    if (!profile) throw Error("missing profile");
    const root = leverProvider.root(doc);
    expect(leverProvider.submitControl(root, profile).id).toBe("btn-submit");
  });

  it("accepts the transparent resume input laid over the visible attach button", () => {
    const doc = mount();
    const input = doc.querySelector("#resume-upload-input");
    if (!input) throw Error("missing input");
    for (const [name, value] of [
      ["offsetWidth", 230],
      ["offsetHeight", 40],
    ] as const)
      Object.defineProperty(input, name, { value });
    expect(isActionable(input, window)).toBe(true);
  });

  it("judges required questions by what the candidate entered or chose", () => {
    const doc = mount();
    const root = leverProvider.root(doc);
    expect(leverProvider.rootValid(root)).toBe(false);
    (doc.querySelector('input[name="name"]') as HTMLInputElement).value = "Pat Candidate";
    (doc.querySelector('input[name="email"]') as HTMLInputElement).value = "pat@example.invalid";
    (doc.querySelector("textarea") as HTMLTextAreaElement).value = "Because.";
    (doc.querySelector('input[type="radio"]') as HTMLInputElement).checked = true;
    // The resume is still missing.
    expect(leverProvider.rootValid(root)).toBe(false);
  });

  it("fills text, a radio choice and a native select with the page's own events, and never submits", async () => {
    const doc = mount();
    const inspected = inspectLeverApplication(doc, URL);
    const events: string[] = [];
    for (const name of ["name", "email"])
      for (const type of ["input", "change"])
        doc
          .querySelector(`input[name="${name}"]`)
          ?.addEventListener(type, () => events.push(`${name}:${type}`));
    const submit = vi.fn();
    doc.querySelector("#btn-submit")?.addEventListener("click", submit);
    doc.querySelector("form")?.addEventListener("submit", submit);
    const result = await leverProvider.fill(
      inspected,
      [
        { fieldKey: "identity.legal_name.full", value: "Pat Candidate", needsUserAction: false },
        { fieldKey: "contact.email", value: "pat@example.invalid", needsUserAction: false },
        {
          fieldKey: "links.linkedin",
          value: "https://linkedin.example/pat",
          needsUserAction: false,
        },
        { fieldKey: "job.relocation", value: "Yes", needsUserAction: false },
        { fieldKey: "authorization.sponsorship_required", value: "No", needsUserAction: false },
      ],
      authority(),
    );
    const value = (selector: string) => (doc.querySelector(selector) as HTMLInputElement).value;
    expect(value('input[name="name"]')).toBe("Pat Candidate");
    expect(value('input[name="email"]')).toBe("pat@example.invalid");
    expect(value('input[name="urls[LinkedIn]"]')).toBe("https://linkedin.example/pat");
    const radios = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(value("select")).toBe("Yes");
    // The location box and the candidate's own text stay untouched.
    expect(value("#location-input")).toBe("");
    expect(value("textarea")).toBe("");
    expect(events).toEqual(expect.arrayContaining(["name:input", "name:change", "email:change"]));
    expect(submit).not.toHaveBeenCalled();
    expect(result.reviewRequired).toBe(true);
    expect(leverProvider.selectionWritten?.(inspected.resolve("f6"), "No")).toBe(true);
    expect(leverProvider.selectionWritten?.(inspected.resolve("f7"), "Yes")).toBe(true);
    expect(leverProvider.selectionWritten?.(inspected.resolve("f7"), "No")).toBe(false);
    inspected.dispose();
  });

  it("chooses an option only on a question the candidate has not answered", async () => {
    const doc = mount();
    const inspected = inspectLeverApplication(doc, URL);
    const scope = { signal: new AbortController().signal, deadline: Date.now() + 5_000 };
    expect(await leverProvider.chooseOption?.(inspected, "f7", "No", scope)).toBe(true);
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("No");
    // Already answered: never changed.
    expect(await leverProvider.chooseOption?.(inspected, "f7", "Yes", scope)).toBe(false);
    expect((doc.querySelector("select") as HTMLSelectElement).value).toBe("No");
    expect(await leverProvider.chooseOption?.(inspected, "f6", "Maybe", scope)).toBe(false);
    inspected.dispose();
  });
});
