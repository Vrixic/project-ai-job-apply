import { applicationImplementationSha256 } from "../providers/implementation";
import type { ExecutionProfile } from "../providers/types";

export const ashbyAdapterVersion = "1.0.0";
export const ashbyVariantId = "ashby-standard-v1";

// Selectors come from read-only inspection of a public hosted Ashby posting on 2026-10-22
// (ADR-053). The post-submit message was not observed live: the first real submission is its
// evidence, and an unrecognized result is reported as ambiguous for the candidate to settle.
const acceptedProfiles: readonly Readonly<ExecutionProfile>[] = [
  {
    variantId: ashbyVariantId,
    adapterVersion: ashbyAdapterVersion,
    implementationSha256: applicationImplementationSha256,
    submitSelector: "button.ashby-application-form-submit-button",
    confirmationSelector: "h1, h2, h3, h4, p, span, div, [role='alert'], [role='status']",
    confirmationText:
      "(?:your )?application (?:was |has been )?(?:successfully )?submitted|thank(?:s| you) for (?:applying|your application)|we(?:'|\\u2019)?ve received your application",
    confirmationLeafOnly: true,
    confirmationReferenceAttribute: "",
  },
];
export function ashbyExecutionProfile(variantId: string, adapterVersion: string) {
  return acceptedProfiles.find(
    (profile) => profile.variantId === variantId && profile.adapterVersion === adapterVersion,
  );
}
