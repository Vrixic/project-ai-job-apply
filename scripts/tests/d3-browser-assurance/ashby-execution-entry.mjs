import { executeApplication } from "../../../frontend/extension/lib/application-run.ts";
import { ashbyProvider } from "../../../frontend/extension/lib/ashby/provider.ts";
import { inspectAshbyApplication } from "../../../frontend/extension/lib/ashby/inspect.ts";
import { AdapterRegistry } from "../../../packages/ats-sdk/src/registry.ts";

// Every gate/profile here is a generated-synthetic simulation, never accepted provider evidence.
// The page follows the structure of a public hosted Ashby posting read on 2026-10-22: no form
// element, field-entry blocks, a Yes/No button pair, a sibling submit button and an invisible
// reCAPTCHA badge.
const PAGE = `
<div class="ashby-job-posting-right-pane">
  <div class="ashby-application-form-container"><div class="ashby-application-form-section-container">
    <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
      <label class="_required_x" for="_systemfield_name">Name</label>
      <input name="_systemfield_name" id="_systemfield_name" required type="text"></div>
    <div class="ashby-application-form-field-entry" data-field-path="_systemfield_email">
      <label class="_required_x" for="_systemfield_email">Email</label>
      <input name="_systemfield_email" id="_systemfield_email" required type="email"></div>
    <div class="ashby-application-form-field-entry" data-field-path="_systemfield_resume">
      <label class="_required_x" for="_systemfield_resume">Resume</label>
      <input type="file" tabindex="-1" id="_systemfield_resume" required accept="application/pdf,.pdf"></div>
    <div class="ashby-application-form-field-entry" data-field-path="onsite">
      <label class="_required_x" for="onsite">Are you willing to work in our office?</label>
      <div><button aria-pressed="false" data-option="yes">Yes</button>
        <button aria-pressed="false" data-option="no">No</button>
        <input type="checkbox" tabindex="-1" name="onsite"></div></div>
    <div class="ashby-application-form-field-entry" data-field-path="linkedin">
      <label for="linkedin">LinkedIn URL</label>
      <input name="linkedin" id="linkedin" type="text"></div>
  </div></div>
  <button class="ashby-application-form-submit-button">Submit Application</button>
</div>
<div class="grecaptcha-badge"><iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor"></iframe></div>`;

window.runAshbyExecutionFixture = async (mode) => {
  document.body.innerHTML = PAGE;
  const profile = {
    variantId: "synthetic-browser-only",
    adapterVersion: "0.1.0",
    implementationSha256: "c".repeat(64),
    submitSelector: "button.ashby-application-form-submit-button",
    confirmationSelector: "p",
    confirmationText: "application (?:was )?(?:successfully )?submitted",
    confirmationLeafOnly: true,
    confirmationReferenceAttribute: "",
  };
  const controls = {
    enabled: { "ashby-application-v1": mode !== "off" },
    liveEffectsApproved: true,
    fixtureEvidence: {
      "ashby-application-v1": {
        kind: "provider_derived",
        authorizationRecordId: "SIMULATED-NOT-PROVIDER-EVIDENCE",
        sanitizationScanPassedAt: new Date().toISOString(),
        qaRepresentativenessAcceptedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        variantIds: [profile.variantId],
        adapterVersion: profile.adapterVersion,
        implementationSha256: profile.implementationSha256,
      },
    },
  };
  const registry = new AdapterRegistry(
    [
      {
        id: "ashby-application-v1",
        provider: "ashby",
        version: profile.adapterVersion,
        variants: [profile.variantId],
        capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
      },
    ],
    controls,
  );
  // The candidate answers the question the extension may not answer for them.
  if (mode !== "candidate-incomplete")
    document.querySelector('button[data-option="yes"]').setAttribute("aria-pressed", "true");
  if (mode === "challenge-at-start")
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>',
    );
  let effects = 0;
  let submits = 0;
  let claimed = false;
  const attached = [];
  const controller = new AbortController();
  for (const id of ["_systemfield_name", "_systemfield_email", "linkedin", "_systemfield_resume"]) {
    const element = document.getElementById(id);
    element.addEventListener("input", () => effects++);
    element.addEventListener("change", () => effects++);
  }
  document.getElementById("_systemfield_resume").addEventListener("input", () => {
    const file = document.getElementById("_systemfield_resume").files[0];
    attached.push({ size: file?.size, name: file?.name });
  });
  document.querySelector(".ashby-application-form-submit-button").addEventListener("click", () => {
    submits++;
    if (mode === "success") {
      document.querySelector(".ashby-application-form-container").remove();
      document.querySelector(".ashby-application-form-submit-button").remove();
      document
        .querySelector(".ashby-job-posting-right-pane")
        .insertAdjacentHTML("beforeend", "<p>Your application was successfully submitted.</p>");
    } else if (mode === "challenge-after-click") {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div><iframe src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>',
      );
    } else if (mode === "navigation") {
      history.pushState(null, "", "/synthetic/00000000-0000-4000-8000-000000000001/other");
    }
  });
  const inspected = inspectAshbyApplication(document, location.href);
  const encoded = new TextEncoder().encode(inspected.structure);
  const formHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  inspected.dispose();
  const bytes = new TextEncoder().encode("%PDF-SYNTHETIC ONLY");
  const files = [
    {
      kind: "tailored_resume",
      generationId: "00000000-0000-7000-8000-000000000004",
      format: "pdf",
      mediaType: "application/pdf",
      sha256: "e".repeat(64),
      bytes: new Uint8Array(bytes),
    },
  ];
  try {
    const result = await executeApplication({
      provider: ashbyProvider,
      document,
      employerUrl: location.href,
      documentId: "00000000-0000-7000-8000-000000000007",
      formHash: mode === "wrong-form" ? "f".repeat(64) : formHash,
      packetHash: "a".repeat(64),
      attemptId: "00000000-0000-7000-8000-000000000008",
      packet: [
        { fieldKey: "identity.legal_name.full", value: "Pat Candidate", needsUserAction: false },
        { fieldKey: "contact.email", value: "pat@example.invalid", needsUserAction: false },
        {
          fieldKey: "links.linkedin",
          value: "https://linkedin.example/pat",
          needsUserAction: false,
        },
      ],
      files,
      profile,
      registry,
      deadline: Date.now() + (["no-message", "challenge-after-click"].includes(mode) ? 600 : 5000),
      signal: controller.signal,
      claim() {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      async revalidateDispatched() {},
    });
    return {
      result,
      effects,
      submits,
      claimed,
      attached,
      name: document.getElementById("_systemfield_name")?.value,
      resumeCleared: (document.getElementById("_systemfield_resume")?.files.length ?? 0) === 0,
    };
  } finally {
    for (const file of files) file.bytes.fill(0);
    bytes.fill(0);
  }
};
