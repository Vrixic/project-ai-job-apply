// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://boards.greenhouse.io/synthetic/jobs/123"}
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillGreenhouseFields } from "../lib/greenhouse/fill";
import {
  greenhouseApplicationIdentity,
  inspectGreenhouseApplication,
} from "../lib/greenhouse/inspect";

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
