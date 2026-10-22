import { executeApplication } from "../../../frontend/extension/lib/application-run.ts";
import { greenhouseProvider } from "../../../frontend/extension/lib/greenhouse/provider.ts";
import { inspectGreenhouseApplication } from "../../../frontend/extension/lib/greenhouse/inspect.ts";
import { AdapterRegistry } from "../../../packages/ats-sdk/src/registry.ts";

// Every gate/profile here is a generated-synthetic simulation, never accepted provider evidence.
window.runGreenhouseExecutionFixture = async (mode) => {
  document.body.innerHTML =
    '<form id="application_form"><label for="email">Email</label><input id="email" name="email" type="email" required><label for="resume">Resume</label><input id="resume" name="resume" type="file" accept=".pdf" required><label for="cover">Cover letter</label><input id="cover" name="cover_letter" type="file" accept=".pdf" required><label for="attestation">I certify this is accurate</label><input id="attestation" name="attestation" type="checkbox" required><button type="submit" id="submit_app">Submit</button></form>';
  const profile = {
    variantId: "synthetic-browser-only",
    adapterVersion: "0.1.0",
    implementationSha256: "c".repeat(64),
    submitSelector: "#submit_app",
    confirmationSelector: "#synthetic-confirmation",
    confirmationReferenceAttribute: "data-synthetic-reference",
  };
  if (mode.startsWith("confirmation-url")) {
    // A board that confirms by moving the same document to its confirmation URL (ADR-053).
    profile.confirmationSelector = "h1";
    profile.confirmationText = "thank you for applying";
    profile.confirmationReferenceAttribute = "";
  }
  const controls = {
    enabled: { "greenhouse-application-v1": mode !== "off" },
    liveEffectsApproved: true,
    fixtureEvidence: {
      "greenhouse-application-v1": {
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
  if (mode === "unbound-version")
    delete controls.fixtureEvidence["greenhouse-application-v1"].adapterVersion;
  if (mode === "unbound-implementation")
    controls.fixtureEvidence["greenhouse-application-v1"].implementationSha256 = "d".repeat(64);
  const registry = new AdapterRegistry(
    [
      {
        id: "greenhouse-application-v1",
        provider: "greenhouse",
        version: profile.adapterVersion,
        variants: [profile.variantId],
        capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
      },
    ],
    controls,
  );
  const email = document.querySelector("#email");
  const resume = document.querySelector("#resume");
  const cover = document.querySelector("#cover");
  // The candidate's own original resume: its format is kept, and there is no generated cover letter.
  const uploaded = mode.startsWith("uploaded-docx");
  if (uploaded) {
    document.querySelector('label[for="cover"]').remove();
    cover.remove();
    resume.setAttribute("accept", mode === "uploaded-docx" ? ".pdf,.doc,.docx" : ".pdf");
  }
  const attestation = document.querySelector("#attestation");
  attestation.checked = mode !== "candidate-incomplete";
  let effects = 0;
  let submits = 0;
  let claimed = false;
  const attached = [];
  const controller = new AbortController();
  const confirm = () =>
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="synthetic-confirmation" data-synthetic-reference="synthetic-receipt-123">Synthetic accepted fixture</p>',
    );
  const swap = (control) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(control.files[0].size).fill(88)], control.files[0].name, {
        type: control.files[0].type,
      }),
    );
    control.files = transfer.files;
  };
  for (const control of [email, resume, cover, attestation]) {
    control.addEventListener("input", () => effects++);
    control.addEventListener("change", () => effects++);
  }
  if (mode === "changed-structure")
    email.addEventListener("input", () =>
      document.querySelector("form").insertAdjacentHTML("beforeend", '<input id="new" name="new">'),
    );
  resume.addEventListener("input", () => {
    attached.push({ kind: "resume", size: resume.files[0]?.size, name: resume.files[0]?.name });
    if (mode === "same-size-swap") swap(resume);
    if (mode === "file-cleared") resume.value = "";
    if (mode === "ordinary-reverted") email.value = "different@example.invalid";
    if (mode === "kill-during-file") controls.enabled["greenhouse-application-v1"] = false;
    if (mode === "cancel-during-file") controller.abort();
    if (mode === "challenge-during-file")
      document.body.insertAdjacentHTML("beforeend", '<div class="g-recaptcha"></div>');
  });
  cover.addEventListener("input", () => {
    attached.push({ kind: "cover", size: cover.files[0]?.size, name: cover.files[0]?.name });
    if (mode === "cross-file-swap") swap(resume);
  });
  document.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    submits++;
    const moveTo = (path, heading) => {
      history.pushState(null, "", path);
      document.querySelector("form").remove();
      document.body.insertAdjacentHTML("beforeend", `<h1>${heading}</h1>`);
    };
    if (mode === "confirmation-url")
      moveTo("/synthetic/jobs/123/confirmation", "Thank you for applying");
    else if (mode === "confirmation-url-wrong-page")
      moveTo("/synthetic/jobs/123/other", "Thank you for applying");
    else if (mode === "confirmation-url-no-message")
      moveTo("/synthetic/jobs/123/confirmation", "Something else");
    else if (mode === "generic-thank-you")
      document.body.insertAdjacentHTML("beforeend", "<p>Thank you</p>");
    else if (mode === "navigation") history.pushState(null, "", "/synthetic/jobs/other");
    else confirm();
    if (mode === "confirmation-and-challenge")
      document.body.insertAdjacentHTML("beforeend", '<input type="password">');
  });
  if (mode === "preexisting-confirmation") confirm();
  // A challenge present from the start is prepared completely but never submitted.
  if (mode === "challenge-at-start")
    document.body.insertAdjacentHTML("beforeend", '<div class="g-recaptcha"></div>');
  const inspected = inspectGreenhouseApplication(document, location.href);
  const encoded = new TextEncoder().encode(inspected.structure);
  const formHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  inspected.dispose();
  encoded.fill(0);
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let digests = 0;
  let fingerprinted = false;
  crypto.subtle.digest = async (...arguments_) => {
    digests++;
    if (mode === "stalled-confirmation-hash" && digests === 2) {
      setTimeout(() => controller.abort(), 0);
      return new Promise(() => {});
    }
    const result = await originalDigest(...arguments_);
    if (digests === 2) fingerprinted = true;
    return result;
  };
  const bytes = new TextEncoder().encode("%PDF-SYNTHETIC ONLY");
  const files = uploaded
    ? [
        {
          kind: "uploaded_resume",
          format: "docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sha256: "e".repeat(64),
          bytes: new Uint8Array(new TextEncoder().encode("PK synthetic docx original")),
        },
      ]
    : ["tailored_resume", "cover_letter"].map((kind, index) => ({
        kind,
        generationId: `00000000-0000-7000-8000-00000000000${index + 4}`,
        format: "pdf",
        mediaType: "application/pdf",
        sha256: "e".repeat(64),
        bytes: new Uint8Array(bytes),
      }));
  try {
    const result = await executeApplication({
      provider: greenhouseProvider,
      document,
      employerUrl: "https://boards.greenhouse.io/synthetic/jobs/123",
      documentId: "00000000-0000-7000-8000-000000000007",
      formHash: mode === "wrong-form" ? "f".repeat(64) : formHash,
      packetHash: "a".repeat(64),
      attemptId: "00000000-0000-7000-8000-000000000008",
      packet: [
        { fieldKey: "contact.email", value: "synthetic@example.invalid", needsUserAction: false },
        { fieldKey: "attestation.truthful", value: false, needsUserAction: false },
      ],
      files,
      profile,
      registry,
      deadline:
        Date.now() +
        (["generic-thank-you", "confirmation-url-no-message"].includes(mode)
          ? 400
          : mode === "expired"
            ? -1
            : 5000),
      signal: controller.signal,
      claim() {
        if (mode === "claim-denied" || claimed) return false;
        claimed = true;
        return true;
      },
      async revalidateDispatched() {
        if (mode === "proof-failure") throw Error("Synthetic proof failed");
        if (mode === "challenge-during-final-proof" && fingerprinted)
          document.body.insertAdjacentHTML("beforeend", '<input autocomplete="one-time-code">');
      },
    });
    return {
      result,
      effects,
      submits,
      claimed,
      attached,
      attestation: attestation.checked,
      filesCleared: resume.files.length === 0 && cover.files.length === 0,
    };
  } finally {
    crypto.subtle.digest = originalDigest;
    for (const file of files) file.bytes.fill(0);
    bytes.fill(0);
  }
};
