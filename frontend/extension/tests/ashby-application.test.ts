// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application"}
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ashbyApplicationIdentity,
  ashbyChallengePresent,
  inspectAshbyApplication,
} from "../lib/ashby/inspect";
import { ashbyProvider } from "../lib/ashby/provider";
import { ashbyExecutionProfile } from "../lib/ashby/profiles";
import { commandFieldsFromPacket } from "../lib/command-fields";
import { providerForUrl } from "../lib/providers";

const URL = "https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application";

// Synthetic page whose structure follows a public hosted Ashby posting inspected read-only on
// 2026-10-22 (ADR-053): no <form>, field-entry blocks, a Yes/No button pair backed by a hidden
// checkbox, an autofill upload outside the field container, and the submit button in the pane.
// It is not provider evidence.
const PAGE = `
<div class="ashby-job-posting-right-pane">
  <div class="ashby-application-form-autofill-pane"><input type="file"></div>
  <div class="ashby-application-form-container">
    <div class="ashby-application-form-section-container">
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="_systemfield_name">
        <label class="_heading_x _required_x" for="_systemfield_name">Name</label>
        <div><input name="_systemfield_name" id="_systemfield_name" required type="text"></div></div>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="_systemfield_email">
        <label class="_heading_x _required_x" for="_systemfield_email">Email</label>
        <div><input name="_systemfield_email" id="_systemfield_email" required type="email"></div></div>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="_systemfield_resume">
        <label class="_heading_x _required_x" for="_systemfield_resume">Resume</label>
        <div><input type="file" tabindex="-1" id="_systemfield_resume" required accept="application/pdf,.pdf"></div></div>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="onsite">
        <label class="_heading_x _required_x" for="onsite">Are you willing to work in our office?</label>
        <div class="_yesno_x"><button aria-pressed="false" data-option="yes">Yes</button>
          <button aria-pressed="false" data-option="no">No</button>
          <input type="checkbox" tabindex="-1" name="onsite"></div></div>
      <fieldset class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="visa">
        <label class="_heading_x _required_x" for="visa-group">Will you require visa sponsorship?</label>
        <div><input type="radio" id="visa-0" name="visa"><label for="visa-0">No</label></div>
        <div><input type="radio" id="visa-1" name="visa"><label for="visa-1">Yes</label></div></fieldset>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="linkedin">
        <label class="_heading_x" for="linkedin">LinkedIn URL</label>
        <div><input name="linkedin" id="linkedin" type="text"></div></div>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="why">
        <label class="_heading_x" for="why">Why are you interested in this company?</label>
        <div><textarea name="why" id="why"></textarea></div></div>
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="priorities">
        <label class="_heading_x" for="priorities">What matters most? (Select 3)</label>
        <div><input type="checkbox" name="Pay" id="p1"><label for="p1">Pay</label>
          <input type="checkbox" name="Balance" id="p2"><label for="p2">Balance</label></div></div>
    </div>
  </div>
  <button class="_button_x ashby-application-form-submit-button">Submit Application</button>
</div>
<div class="grecaptcha-badge"><iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor"></iframe></div>
<textarea id="g-recaptcha-response-100000" class="g-recaptcha-response"></textarea>`;

const mount = () => {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = PAGE;
  return document;
};
const registry = () =>
  new AdapterRegistry(
    [
      {
        id: "ashby-application-v1",
        provider: "ashby",
        version: "0.1.0",
        variants: ["synthetic-unit-only"],
        capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
      },
    ],
    {
      enabled: { "ashby-application-v1": true },
      liveEffectsApproved: true,
      fixtureEvidence: {
        "ashby-application-v1": {
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
  throwOnFailure: true,
});
afterEach(() => vi.useRealTimers());

describe("Ashby identity", () => {
  it.each([
    URL,
    "https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001",
    `${URL}?jr_id=abc`,
  ])("recognizes %s", (url) => {
    expect(ashbyApplicationIdentity(url)).toEqual({
      tenant: "synthetic",
      jobId: "00000000-0000-4000-8000-000000000001",
    });
    expect(providerForUrl(url)?.id).toBe("ashby");
  });
  it.each([
    "http://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application",
    "https://jobs.ashbyhq.com.evil.invalid/synthetic/00000000-0000-4000-8000-000000000001",
    "https://user@jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001",
    "https://jobs.ashbyhq.com:444/synthetic/00000000-0000-4000-8000-000000000001",
    "https://jobs.ashbyhq.com/synthetic/not-a-job/application",
    "https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/other",
    "https://jobs.ashbyhq.com/synthetic",
  ])("refuses %s", (url) => {
    expect(ashbyApplicationIdentity(url)).toBeUndefined();
    expect(providerForUrl(url)).toBeUndefined();
  });
  it("keeps Greenhouse pages with Greenhouse", () => {
    expect(providerForUrl("https://job-boards.greenhouse.io/acme/jobs/42")?.id).toBe("greenhouse");
  });
});

describe("Ashby inspection", () => {
  it("reads structure without a form element, excluding the autofill upload", () => {
    const doc = mount();
    expect(doc.querySelector("form")).toBeNull();
    expect(ashbyChallengePresent(doc)).toBe(false);
    const inspected = inspectAshbyApplication(doc, URL);
    expect(inspected.form.challengePresent).toBe(false);
    expect(
      inspected.form.fields.map((field) => [field.name, field.label, field.type, field.required]),
    ).toEqual([
      ["_systemfield_name", "Name", "text", true],
      ["_systemfield_email", "Email", "text", true],
      ["_systemfield_resume", "Resume", "file", true],
      ["onsite", "Are you willing to work in our office?", "radio", true],
      ["visa", "Will you require visa sponsorship?", "radio", true],
      ["linkedin", "LinkedIn URL", "text", false],
      ["why", "Why are you interested in this company?", "textarea", false],
      ["priorities", "What matters most? (Select 3)", "unknown", false],
    ]);
    expect(inspected.form.fields[3]?.options).toEqual(["Yes", "No"]);
    expect(inspected.form.fields[4]?.options).toEqual(["No", "Yes"]);
    inspected.dispose();
  });

  it("never reads entered values during inspection", () => {
    const doc = mount();
    const email = doc.querySelector("#_systemfield_email");
    Object.defineProperty(email, "value", {
      get() {
        throw Error("must not read");
      },
    });
    const inspected = inspectAshbyApplication(doc, URL);
    expect(inspected.resolve("f1")[0]).toBe(email);
    inspected.dispose();
    expect(() => inspected.resolve("f1")).toThrow("AshbyInspectionUnavailable");
  });

  it.each(["replace", "rename", "navigate", "visible-challenge", "credential"])(
    "invalidates handles after %s",
    (kind) => {
      const doc = mount();
      const inspected = inspectAshbyApplication(doc, URL);
      if (kind === "replace")
        doc.querySelector("#linkedin")?.replaceWith(doc.createElement("input"));
      if (kind === "rename")
        doc
          .querySelector("#_systemfield_email")
          ?.closest("[data-field-path]")
          ?.setAttribute("data-field-path", "different");
      if (kind === "navigate") window.history.replaceState(null, "", `${URL}?changed=1`);
      if (kind === "visible-challenge")
        doc.body.insertAdjacentHTML(
          "beforeend",
          '<div><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>',
        );
      if (kind === "credential")
        doc.body.insertAdjacentHTML("beforeend", '<input type="password">');
      expect(() => inspected.resolve(kind === "replace" ? "f5" : "f1")).toThrow();
    },
  );

  it.each([["an iframe inside the container", '<iframe src="https://unknown.invalid"></iframe>']])(
    "refuses %s",
    (_name, extra) => {
      const doc = mount();
      doc
        .querySelector(".ashby-application-form-section-container")
        ?.insertAdjacentHTML("beforeend", extra);
      expect(() => inspectAshbyApplication(doc, URL)).toThrow();
    },
  );

  it("refuses a page with two field containers or duplicate field names", () => {
    const doc = mount();
    doc
      .querySelector(".ashby-job-posting-right-pane")
      ?.insertAdjacentHTML("beforeend", '<div class="ashby-application-form-container"></div>');
    expect(() => inspectAshbyApplication(doc, URL)).toThrow();
    const dup = mount();
    dup
      .querySelector("#linkedin")
      ?.closest("[data-field-path]")
      ?.setAttribute("data-field-path", "why");
    expect(() => inspectAshbyApplication(dup, URL)).toThrow();
  });
});

describe("Ashby execution surface", () => {
  it("finds the pane root and the one submit control outside the field container", () => {
    const doc = mount();
    const profile = ashbyExecutionProfile("ashby-standard-v1", "1.0.0");
    if (!profile) throw Error("missing profile");
    const root = ashbyProvider.root(doc);
    expect(ashbyProvider.submitControl(root, profile).textContent).toBe("Submit Application");
    root.insertAdjacentHTML(
      "beforeend",
      '<button class="ashby-application-form-submit-button">Again</button>',
    );
    expect(() => ashbyProvider.submitControl(root, profile)).toThrow();
    const inside = mount();
    inside
      .querySelector(".ashby-application-form-container")
      ?.insertAdjacentHTML(
        "beforeend",
        '<button class="ashby-application-form-submit-button">x</button>',
      );
    inside.querySelector("button.ashby-application-form-submit-button:not(:last-child)")?.remove();
    expect(() => ashbyProvider.submitControl(ashbyProvider.root(inside), profile)).toThrow();
  });

  it("judges required entries, including Yes/No buttons and radios, by what the candidate chose", () => {
    const doc = mount();
    const root = ashbyProvider.root(doc);
    expect(ashbyProvider.rootValid(root)).toBe(false);
    const inspected = inspectAshbyApplication(doc, URL);
    const yesNo = inspected.resolve("f3");
    expect(ashbyProvider.controlsSatisfied(yesNo, true)).toBe(false);
    yesNo[0]?.setAttribute("aria-pressed", "true");
    expect(ashbyProvider.controlsSatisfied(yesNo, true)).toBe(true);
    const radios = inspected.resolve("f4");
    expect(ashbyProvider.controlsSatisfied(radios, true)).toBe(false);
    (radios[1] as HTMLInputElement).checked = true;
    expect(ashbyProvider.controlsSatisfied(radios, true)).toBe(true);
    // An empty optional text field never blocks.
    expect(ashbyProvider.controlsSatisfied(inspected.resolve("f5"), false)).toBe(true);
    inspected.dispose();
  });

  it("fills ordinary fields and a Yes/No choice with the page's own events, nothing else", async () => {
    const doc = mount();
    const inspected = inspectAshbyApplication(doc, URL);
    const events: string[] = [];
    for (const id of ["_systemfield_name", "_systemfield_email", "linkedin", "why"])
      for (const type of ["input", "change"])
        doc.getElementById(id)?.addEventListener(type, () => events.push(`${id}:${type}`));
    const [yes, no] = Array.from(doc.querySelectorAll("button[data-option]"));
    // The page records a choice on click, as its framework would.
    for (const button of [yes, no])
      button?.addEventListener("click", () => {
        yes?.setAttribute("aria-pressed", button === yes ? "true" : "false");
        no?.setAttribute("aria-pressed", button === no ? "true" : "false");
      });
    const submit = vi.fn();
    doc.querySelector(".ashby-application-form-submit-button")?.addEventListener("click", submit);
    const result = await ashbyProvider.fill(
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
    expect((doc.getElementById("_systemfield_name") as HTMLInputElement).value).toBe(
      "Pat Candidate",
    );
    expect((doc.getElementById("_systemfield_email") as HTMLInputElement).value).toBe(
      "pat@example.invalid",
    );
    expect((doc.getElementById("linkedin") as HTMLInputElement).value).toBe(
      "https://linkedin.example/pat",
    );
    // The office question has no packet value in this page's mapping, so it is left alone.
    expect(yes?.getAttribute("aria-pressed")).toBe("false");
    // Sponsorship is a direct-action field: never filled even when the packet carries a value.
    expect((doc.getElementById("visa-0") as HTMLInputElement).checked).toBe(false);
    expect(events).toContain("_systemfield_name:input");
    expect(events).toContain("_systemfield_email:change");
    expect(submit).not.toHaveBeenCalled();
    expect(result.reviewRequired).toBe(true);
    inspected.dispose();
  });

  it("does nothing under the default registry", async () => {
    const doc = mount();
    const auth = { ...authority(), registry: new AdapterRegistry() };
    const result = await ashbyProvider.fill(inspectAshbyApplication(doc, URL), [], auth);
    expect(result).toEqual({ filled: [], reviewRequired: true });
    expect(auth.revalidateApproval).not.toHaveBeenCalled();
  });
});

describe("full name for pages with a single Name field (ADR-053)", () => {
  const field = (fieldKey: string, value: string, extra = {}) => ({
    fieldKey,
    value,
    origin: "confirmed_fact",
    reasons: [],
    disposition: "automatic",
    ...extra,
  });
  it("composes it from the approved first and last name only", () => {
    const fields = commandFieldsFromPacket({
      fields: [
        field("identity.legal_name.first", " Pat "),
        field("identity.legal_name.last", "Candidate"),
      ],
    } as never);
    expect(fields.map((entry) => [entry.fieldKey, entry.value])).toContainEqual([
      "identity.legal_name.full",
      "Pat Candidate",
    ]);
    const needsUser = commandFieldsFromPacket({
      fields: [
        field("identity.legal_name.first", "Pat", { disposition: "user_action" }),
        field("identity.legal_name.last", "Candidate"),
      ],
    } as never);
    expect(needsUser.some((entry) => entry.fieldKey === "identity.legal_name.full")).toBe(false);
    const onlyFirst = commandFieldsFromPacket({
      fields: [field("identity.legal_name.first", "Pat")],
    } as never);
    expect(onlyFirst.some((entry) => entry.fieldKey === "identity.legal_name.full")).toBe(false);
  });
  it("never forwards restricted, vault or document fields", () => {
    const fields = commandFieldsFromPacket({
      fields: [
        field("authorization.us_authorized", "Yes"),
        field("contact.email", "a@example.invalid", { origin: "answer_vault" }),
        field("documents.resume", "x"),
        field("links.github", "https://example.invalid", { reasons: ["restricted_answer"] }),
        field("contact.phone", "555"),
      ],
    } as never);
    expect(fields.map((entry) => entry.fieldKey)).toEqual(["contact.phone"]);
  });
});
