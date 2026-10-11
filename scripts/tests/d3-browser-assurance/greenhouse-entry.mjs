import { fillGreenhouseFields } from "../../../frontend/extension/lib/greenhouse/fill.ts";
import { inspectGreenhouseApplication } from "../../../frontend/extension/lib/greenhouse/inspect.ts";
import { AdapterRegistry } from "../../../packages/ats-sdk/src/registry.ts";

// Generated-synthetic evidence simulation for this intercepted browser fixture only.
const simulatedRegistry = () =>
  new AdapterRegistry(
    [
      {
        id: "greenhouse-application-v1",
        provider: "greenhouse",
        version: "0.1.0",
        variants: ["synthetic-browser-only"],
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
          variantIds: ["synthetic-browser-only"],
        },
      },
    },
  );
window.runGreenhousePrimitiveFixture = async (mode) => {
  if (["select-disabled", "optgroup-disabled"].includes(mode))
    document.querySelector("form").innerHTML =
      '<label for="email">Email</label><select name="email" id="email"><option>Choose</option><optgroup label="Synthetic"><option value="approved">synthetic@example.invalid</option></optgroup></select>';
  if (mode === "number") {
    document.querySelector("#email").type = "number";
    document.querySelector("#email").required = false;
  }
  const inspected = inspectGreenhouseApplication(document, location.href);
  const input = document.querySelector("#email");
  let changes = 0;
  let submits = 0;
  input.addEventListener("change", () => changes++);
  document.querySelector("form").addEventListener("submit", () => submits++);
  if (mode === "challenge")
    input.addEventListener("input", () =>
      document.body.insertAdjacentHTML("beforeend", '<div class="g-recaptcha"></div>'),
    );
  if (mode === "replace")
    input.addEventListener("input", () => input.replaceWith(input.cloneNode()));
  if (["hidden", "readonly", "inert", "revert"].includes(mode))
    input.addEventListener("input", () => {
      if (mode === "revert") input.value = "";
      else input.setAttribute(mode, "");
    });
  if (
    ["invalid", "pattern", "invalid-change", "select-disabled", "optgroup-disabled"].includes(mode)
  )
    input.addEventListener(mode === "invalid-change" ? "change" : "input", () => {
      if (mode === "pattern") input.pattern = "never-matches";
      else if (mode === "select-disabled") input.selectedOptions[0].disabled = true;
      else if (mode === "optgroup-disabled") document.querySelector("optgroup").disabled = true;
      else input.setCustomValidity("Synthetic invalid fixture");
    });
  const controller = new AbortController();
  try {
    const result = await fillGreenhouseFields(
      inspected,
      [{ fieldKey: "contact.email", value: "synthetic@example.invalid", needsUserAction: false }],
      {
        registry: mode === "off" ? new AdapterRegistry() : simulatedRegistry(),
        variantId: "synthetic-browser-only",
        deadline: Date.now() + 10_000,
        signal: controller.signal,
        async revalidateApproval() {
          if (mode === "cancel") controller.abort();
        },
      },
    );
    return { ...result, changes, submits, value: document.querySelector("#email").value };
  } finally {
    inspected.dispose();
  }
};
