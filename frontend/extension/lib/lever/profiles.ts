import { applicationImplementationSha256 } from "../providers/implementation";
import type { ExecutionProfile } from "../providers/types";

export const leverAdapterVersion = "1.0.0";
export const leverVariantId = "lever-standard-v1";

// Selectors come from read-only inspection of a public hosted Lever posting on 2026-11-24 (ADR-053
// amendment). The submit control is named only so the run can prove the page is the form it
// inspected: the extension never presses it on Lever, because it starts the page's hCaptcha. The
// candidate submits, and the confirmation is a new page the extension does not follow.
const acceptedProfiles: readonly Readonly<ExecutionProfile>[] = [
  {
    variantId: leverVariantId,
    adapterVersion: leverAdapterVersion,
    implementationSha256: applicationImplementationSha256,
    submitSelector: "button#btn-submit",
    confirmationSelector: "h1, h2, h3",
    confirmationText: "application submitted|thank(?:s| you) for (?:applying|your application)",
    confirmationLeafOnly: true,
    confirmationReferenceAttribute: "",
  },
];
export function leverExecutionProfile(variantId: string, adapterVersion: string) {
  return acceptedProfiles.find(
    (profile) => profile.variantId === variantId && profile.adapterVersion === adapterVersion,
  );
}
