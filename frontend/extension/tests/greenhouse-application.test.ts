// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://boards.greenhouse.io/synthetic/jobs/123"}
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillGreenhouseFields } from "../lib/greenhouse/fill";
import {
  greenhouseApplicationIdentity,
  greenhouseChallengePresent,
  inspectGreenhouseApplication,
} from "../lib/greenhouse/inspect";
import { greenhouseProvider } from "../lib/greenhouse/provider";

const URL = "https://boards.greenhouse.io/synthetic/jobs/123";
const EMAIL =
  '<label for="email">Email</label><input id="email" name="email" type="email" required>';
const page = (extra = "") => {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = `<form id="application_form">${EMAIL}${extra}</form>`;
  return {
    window,
    reconfigure: ({ url }: { url: string }) => window.history.replaceState(null, "", url),
  };
};
const packet = [
  { fieldKey: "contact.email", value: "synthetic@example.invalid", needsUserAction: false },
];
// Unit-only simulated gate; no provider evidence or live approval is created by this fixture.
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
afterEach(() => vi.useRealTimers());

describe("Greenhouse local adapter primitives", () => {
  it.each([
    "http://boards.greenhouse.io/synthetic/jobs/123",
    "https://boards.greenhouse.io.evil.invalid/synthetic/jobs/123",
    "https://user@boards.greenhouse.io/synthetic/jobs/123",
    "https://boards.greenhouse.io:444/synthetic/jobs/123",
    "https://boards.greenhouse.io/synthetic/jobs/not-a-job",
    "https://boards.greenhouse.io/embed/job_app?for=one&for=two&token=123",
  ])("refuses an unsupported identity %s", (url) =>
    expect(greenhouseApplicationIdentity(url)).toBeUndefined(),
  );
  it("recognizes exact supported host paths without inferring fixture acceptance", () => {
    expect(greenhouseApplicationIdentity(URL)).toEqual({ tenant: "synthetic", jobId: "123" });
    expect(
      greenhouseApplicationIdentity(
        "https://job-boards.greenhouse.io/embed/job_app?for=synthetic&token=123",
      ),
    ).toEqual({ tenant: "synthetic", jobId: "123" });
  });
  it("never reads entered values during inspection", () => {
    const dom = page();
    const input = dom.window.document.querySelector("input");
    Object.defineProperty(input, "value", {
      get() {
        throw Error("must not read");
      },
    });
    const inspected = inspectGreenhouseApplication(dom.window.document, URL);
    expect(inspected.form.fields[0]?.name).toBe("email");
    expect(inspected.resolve("f0")[0]).toBe(input);
    inspected.dispose();
    expect(() => inspected.resolve("f0")).toThrow("GreenhouseInspectionUnavailable");
  });
  it.each([
    '<input name="email">',
    '<span id="email"></span>',
    '<iframe src="https://unknown.invalid"></iframe>',
  ])("refuses ambiguous control or iframe markup %s", (extra) => {
    expect(() => inspectGreenhouseApplication(page(extra).window.document, URL)).toThrow();
  });
  it.each(["replace", "rename", "challenge", "navigate"])(
    "invalidates %s after inspection",
    (kind) => {
      const dom = page();
      const document = dom.window.document;
      const inspected = inspectGreenhouseApplication(document, URL);
      if (kind === "replace")
        document.querySelector("input")?.replaceWith(document.createElement("input"));
      if (kind === "rename") document.querySelector("input")?.setAttribute("name", "different");
      if (kind === "challenge")
        document.body.insertAdjacentHTML("beforeend", '<div class="g-recaptcha"></div>');
      if (kind === "navigate") dom.reconfigure({ url: `${URL}?changed=true` });
      expect(() => inspected.resolve("f0")).toThrow();
    },
  );
  it("default registry prevents every effect and approval read", async () => {
    const dom = page();
    const auth = { ...authority(), registry: new AdapterRegistry() };
    expect(
      await fillGreenhouseFields(
        inspectGreenhouseApplication(dom.window.document, URL),
        packet,
        auth,
      ),
    ).toEqual({ filled: [], reviewRequired: true });
    expect(auth.revalidateApproval).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector("input")?.value).toBe("");
  });
  it("fills only an approved ordinary field and never submits", async () => {
    const dom = page();
    const document = dom.window.document;
    const submit = vi.fn();
    document.querySelector("form")?.addEventListener("submit", submit);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet,
      authority(),
    );
    expect(result).toEqual({ filled: ["f0"], reviewRequired: false });
    expect(document.querySelector("input")?.value).toBe("synthetic@example.invalid");
    expect(submit).not.toHaveBeenCalled();
  });
  it("scrolls to each field before it fills it", async () => {
    const dom = page();
    const document = dom.window.document;
    const order: string[] = [];
    const reveal = vi.fn(async (control: Element) => {
      order.push(`reveal:${(control as HTMLInputElement).value === "" ? "empty" : "filled"}`);
    });
    await fillGreenhouseFields(inspectGreenhouseApplication(document, URL), packet, {
      ...authority(),
      reveal,
    });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["reveal:empty"]);
    expect(document.querySelector("input")?.value).toBe("synthetic@example.invalid");
  });
  it("sets a framework-controlled field through the native setter", async () => {
    const dom = page();
    const document = dom.window.document;
    const input = document.querySelector("input") as HTMLInputElement;
    const native = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value");
    // A controlled field discards a plain assignment, as a React-controlled input does.
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => native?.get?.call(input) ?? "",
      set: () => undefined,
    });
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      packet,
      authority(),
    );
    expect(result).toEqual({ filled: ["f0"], reviewRequired: false });
    expect(native?.get?.call(input)).toBe("synthetic@example.invalid");
  });
  it("finds a control by its name after the board replaces an upload control", () => {
    const dom = page(
      '<label for="resume">Resume</label><input id="resume" name="resume" type="file"><label for="school">School</label><input id="school" name="school" type="text">',
    );
    const document = dom.window.document;
    const inspection = inspectGreenhouseApplication(document, URL);
    const school = document.querySelector("#school");
    const ref = inspection.form.fields.find((field) => field.name === "school")?.ref ?? "";
    // The board swaps the upload for its own attached display; positions after it shift.
    const upload = document.querySelector("#resume");
    upload?.parentElement?.querySelector('label[for="resume"]')?.remove();
    upload?.replaceWith(
      Object.assign(document.createElement("div"), {
        className: "file-upload__filename",
        textContent: "tailored_resume.pdf",
      }),
    );
    expect(inspection.resolve(ref)).toEqual([school]);
    expect(
      greenhouseProvider.attachmentAccepted?.(
        document.querySelector("form") as Element,
        "tailored_resume.pdf",
      ),
    ).toBe(true);
    expect(
      greenhouseProvider.attachmentAccepted?.(
        document.querySelector("form") as Element,
        "other.pdf",
      ),
    ).toBe(false);
  });
  it("stops after synchronous challenge insertion without emitting change or touching the next field", async () => {
    const dom = page('<label for="last">Last name</label><input id="last" name="last">');
    const document = dom.window.document;
    const change = vi.fn();
    document
      .querySelector("input")
      ?.addEventListener("input", () =>
        document.body.insertAdjacentHTML("beforeend", '<div class="h-captcha"></div>'),
      );
    document.querySelector("input")?.addEventListener("change", change);
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      [
        ...packet,
        { fieldKey: "identity.legal_name.last", value: "Synthetic", needsUserAction: false },
      ],
      authority(),
    );
    expect(result).toEqual({ filled: ["f0"], reviewRequired: true });
    expect(change).not.toHaveBeenCalled();
    expect((document.querySelector("#last") as HTMLInputElement).value).toBe("");
  });
  it("leaves restricted answers, attestations and file controls untouched", async () => {
    const dom = page(
      '<label for="auth">Are you authorized to work in the United States?</label><input id="auth" name="authorization" required><label for="signature">Signature</label><input id="signature" name="signature" required><label for="resume">Resume</label><input id="resume" name="resume" type="file" required>',
    );
    const document = dom.window.document;
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(document, URL),
      [
        ...packet,
        { fieldKey: "authorization.work_authorized", value: true, needsUserAction: false },
        { fieldKey: "signature.name", value: "Synthetic", needsUserAction: false },
      ],
      authority(),
    );
    expect(result.reviewRequired).toBe(true);
    for (const id of ["auth", "signature", "resume"])
      expect((document.getElementById(id) as HTMLInputElement).value).toBe("");
  });
  it("bounds a hung approval read by the fixed admission deadline", async () => {
    vi.useFakeTimers();
    const dom = page();
    const auth = authority();
    auth.deadline = Date.now() + 100;
    auth.revalidateApproval = vi.fn(() => new Promise<undefined>(() => undefined));
    const result = fillGreenhouseFields(
      inspectGreenhouseApplication(dom.window.document, URL),
      packet,
      auth,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ filled: [], reviewRequired: true });
    expect(dom.window.document.querySelector("input")?.value).toBe("");
  });
  it("aborts a hung approval read without late effects", async () => {
    const dom = page();
    const controller = new AbortController();
    const auth = authority();
    auth.signal = controller.signal;
    let settle: ((value: undefined) => void) | undefined;
    auth.revalidateApproval = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          settle = resolve;
        }),
    );
    const work = fillGreenhouseFields(
      inspectGreenhouseApplication(dom.window.document, URL),
      packet,
      auth,
    );
    controller.abort();
    expect(await work).toEqual({ filled: [], reviewRequired: true });
    settle?.(undefined);
    await Promise.resolve();
    expect(dom.window.document.querySelector("input")?.value).toBe("");
  });
  it.each([
    "hidden",
    "inert",
    'aria-hidden="true"',
    'style="display:none"',
    'style="visibility:hidden"',
    'style="opacity:0"',
  ])("does not fill a concealed ancestor %s", async (attribute) => {
    const dom = page();
    const form = dom.window.document.querySelector("form");
    if (!form) throw Error("missing fixture form");
    form.outerHTML = `<section ${attribute}>${form.outerHTML}</section>`;
    const result = await fillGreenhouseFields(
      inspectGreenhouseApplication(dom.window.document, URL),
      packet,
      authority(),
    );
    expect(result).toEqual({ filled: [], reviewRequired: true });
    expect(dom.window.document.querySelector("input")?.value).toBe("");
  });
  it("does not fill controls disabled by a fieldset", async () => {
    const dom = page();
    const form = dom.window.document.querySelector("form");
    if (!form) throw Error("missing fixture form");
    form.innerHTML = `<fieldset disabled>${EMAIL}</fieldset>`;
    expect(
      await fillGreenhouseFields(
        inspectGreenhouseApplication(dom.window.document, URL),
        packet,
        authority(),
      ),
    ).toEqual({ filled: [], reviewRequired: true });
  });
  it.each(["missing", "duplicate", "disabled"])(
    "refuses %s options without nearest matching",
    async (kind) => {
      const dom = page();
      const form = dom.window.document.querySelector("form");
      if (!form) throw Error("missing fixture form");
      const option =
        kind === "missing" ? "synthetic@example.invalid-near" : "synthetic@example.invalid";
      form.innerHTML = `<label for="email">Email</label><select id="email" name="email"><option value="untouched">Choose</option><option value="exact" ${kind === "disabled" ? "disabled" : ""}>${option}</option>${kind === "duplicate" ? `<option value="second">${option}</option>` : ""}</select>`;
      expect(
        (
          await fillGreenhouseFields(
            inspectGreenhouseApplication(dom.window.document, URL),
            packet,
            authority(),
          )
        ).filled,
      ).toEqual([]);
      expect((dom.window.document.getElementById("email") as HTMLSelectElement).value).toBe(
        "untouched",
      );
    },
  );
  it("rejects oversized documents before extracting a prefix", () => {
    const dom = page();
    dom.window.document.body.insertAdjacentHTML("beforeend", "<span></span>".repeat(10_001));
    expect(() => inspectGreenhouseApplication(dom.window.document, URL)).toThrow(
      "GreenhouseInspectionUnavailable",
    );
  });
  it.each(["hidden", "readonly", "inert", "revert"])(
    "fences change after an input handler applies %s",
    async (mode) => {
      const dom = page();
      const document = dom.window.document;
      const input = document.querySelector("input");
      if (!input) throw Error("missing fixture input");
      const change = vi.fn();
      input.addEventListener("change", change);
      input.addEventListener("input", () => {
        if (mode === "revert") input.value = "";
        else input.setAttribute(mode, "");
      });
      expect(
        await fillGreenhouseFields(
          inspectGreenhouseApplication(document, URL),
          packet,
          authority(),
        ),
      ).toEqual({ filled: ["f0"], reviewRequired: true });
      expect(change).not.toHaveBeenCalled();
    },
  );
  it("does not report success when an optional numeric input sanitizes the approved value", async () => {
    const dom = page();
    const input = dom.window.document.querySelector("input");
    if (!input) throw Error("missing fixture input");
    input.type = "number";
    input.required = false;
    expect(
      await fillGreenhouseFields(
        inspectGreenhouseApplication(dom.window.document, URL),
        packet,
        authority(),
      ),
    ).toEqual({ filled: ["f0"], reviewRequired: true });
    expect(input.value).toBe("");
  });
  it.each(["invalid", "pattern", "invalid-change"])(
    "requires review for handler validation mutation %s",
    async (mode) => {
      const dom = page();
      const document = dom.window.document;
      const input = document.querySelector("input");
      if (!input) throw Error("missing fixture input");
      let changes = 0;
      input.addEventListener("change", () => changes++);
      input.addEventListener(mode === "invalid-change" ? "change" : "input", () => {
        if (mode === "pattern") input.pattern = "never-matches";
        else input.setCustomValidity("Synthetic invalid fixture");
      });
      expect(
        await fillGreenhouseFields(
          inspectGreenhouseApplication(document, URL),
          packet,
          authority(),
        ),
      ).toEqual({ filled: ["f0"], reviewRequired: true });
      expect(changes).toBe(mode === "invalid-change" ? 1 : 0);
    },
  );
  it.each(["option", "optgroup"])(
    "fences change when the selected %s becomes disabled",
    async (mode) => {
      const dom = page();
      const document = dom.window.document;
      const form = document.querySelector("form");
      if (!form) throw Error("missing fixture form");
      form.innerHTML =
        '<label for="email">Email</label><select name="email" id="email"><option>Choose</option><optgroup label="Synthetic"><option value="approved">synthetic@example.invalid</option></optgroup></select>';
      const select = document.querySelector("select");
      if (!select) throw Error("missing fixture select");
      const change = vi.fn();
      select.addEventListener("change", change);
      if (mode === "optgroup")
        select.addEventListener("input", () =>
          document.querySelector("optgroup")?.setAttribute("disabled", ""),
        );
      // Select the intended option explicitly rather than the unrelated first placeholder.
      if (mode === "option")
        select.addEventListener("input", () =>
          select.selectedOptions[0]?.setAttribute("disabled", ""),
        );
      expect(
        await fillGreenhouseFields(
          inspectGreenhouseApplication(document, URL),
          packet,
          authority(),
        ),
      ).toEqual({ filled: ["f0"], reviewRequired: true });
      expect(change).not.toHaveBeenCalled();
    },
  );
});

// Synthetic page whose structure follows a public job-boards.greenhouse.io board inspected read-only
// on 2026-10-22 (ADR-053): id-only controls, a custom combobox with a hidden required shim, and an
// invisible reCAPTCHA badge outside the form. It is not provider evidence.
const BOARD = `
  <form id="application-form" class="application--form" method="get">
    <div><label id="first_name-label" for="first_name">First Name<span aria-hidden="true">*</span></label>
      <input id="first_name" class="input" aria-label="First Name" aria-required="true" type="text"></div>
    <div><label id="email-label" for="email">Email<span aria-hidden="true">*</span></label>
      <input id="email" class="input" aria-label="Email" aria-required="true" type="text" autocomplete="email"></div>
    <div><label id="question_1-label" for="question_1">Do you require visa sponsorship? *</label>
      <input id="question_1" class="select__input" type="text" role="combobox" aria-haspopup="true"
        aria-autocomplete="list" aria-required="true">
      <input required tabindex="-1" aria-hidden="true" value=""></div>
    <div><label id="website-label" for="website">Website</label>
      <input id="website" class="input" aria-label="Website" aria-required="false" type="text"></div>
    <button type="submit">Submit application</button>
  </form>
  <div class="grecaptcha-badge"><iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor"></iframe></div>`;
const board = () => {
  window.history.replaceState(null, "", URL);
  document.body.innerHTML = BOARD;
  return document;
};

describe("modern Greenhouse board page (ADR-053)", () => {
  it("inspects despite the invisible reCAPTCHA badge and the combobox shim", () => {
    const doc = board();
    expect(greenhouseChallengePresent(doc)).toBe(false);
    const inspected = inspectGreenhouseApplication(doc, URL);
    expect(inspected.form.challengePresent).toBe(false);
    expect(inspected.form.fields.map((field) => [field.name, field.type, field.required])).toEqual([
      ["first_name", "text", true],
      ["email", "text", true],
      ["question_1", "unknown", true],
      ["website", "text", false],
    ]);
    inspected.dispose();
  });

  it("treats a visible challenge frame or a credential prompt as a challenge", () => {
    const doc = board();
    doc.body.insertAdjacentHTML(
      "beforeend",
      '<div><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>',
    );
    expect(greenhouseChallengePresent(doc)).toBe(true);
    board();
    document.body.insertAdjacentHTML("beforeend", '<input type="password">');
    expect(greenhouseChallengePresent(document)).toBe(true);
  });

  it("asks a required control to be completed by the candidate before any click", () => {
    const doc = board();
    const inspected = inspectGreenhouseApplication(doc, URL);
    const email = inspected.resolve("f1");
    const website = inspected.resolve("f3");
    expect(greenhouseProvider.controlsSatisfied(email, true)).toBe(false);
    // An optional empty control does not block.
    expect(greenhouseProvider.controlsSatisfied(website, false)).toBe(true);
    (email[0] as HTMLInputElement).value = "candidate@example.invalid";
    expect(greenhouseProvider.controlsSatisfied(email, true)).toBe(true);
    // A combobox is judged by the form's own required shim at submit time.
    expect(greenhouseProvider.controlsSatisfied(inspected.resolve("f2"), true)).toBe(true);
    expect(greenhouseProvider.rootValid(greenhouseProvider.root(doc))).toBe(false);
    inspected.dispose();
  });
});

describe("Greenhouse confirmation navigation (ADR-053)", () => {
  const employer = "https://job-boards.greenhouse.io/acme/jobs/42?jr_id=abc";
  it.each([
    ["https://job-boards.greenhouse.io/acme/jobs/42/confirmation", true],
    ["https://job-boards.greenhouse.io/acme/jobs/42/confirmation?x=1", true],
    ["https://job-boards.greenhouse.io/acme/jobs/43/confirmation", false],
    ["https://job-boards.greenhouse.io/other/jobs/42/confirmation", false],
    ["https://job-boards.greenhouse.io/acme/jobs/42/confirmation/extra", false],
    ["https://boards.greenhouse.io/acme/jobs/42/confirmation", false],
    ["https://job-boards.greenhouse.io.evil.invalid/acme/jobs/42/confirmation", false],
    ["https://user@job-boards.greenhouse.io/acme/jobs/42/confirmation", false],
    ["https://job-boards.greenhouse.io/acme/jobs/42", false],
  ])("treats %s as the confirmation page: %s", (current, expected) => {
    expect(greenhouseProvider.isConfirmationUrl?.(employer, current)).toBe(expected);
  });
  it("expects no navigation for an embedded application", () => {
    expect(
      greenhouseProvider.isConfirmationUrl?.(
        "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=42",
        "https://job-boards.greenhouse.io/acme/jobs/42/confirmation",
      ),
    ).toBe(false);
  });
});
