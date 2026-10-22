import type { ExecutionProfile } from "../providers/types";

/** The Greenhouse profile type predates the second provider and stays as a name for it. */
export type GreenhouseExecutionProfile = ExecutionProfile;

declare const __APPLICATION_IMPLEMENTATION_SHA256__: string | undefined;

/** The build binds the registry evidence to the exact provider code it was built from. */
export const applicationImplementationSha256 =
  typeof __APPLICATION_IMPLEMENTATION_SHA256__ === "string" &&
  /^[a-f0-9]{64}$/u.test(__APPLICATION_IMPLEMENTATION_SHA256__)
    ? __APPLICATION_IMPLEMENTATION_SHA256__
    : "0".repeat(64);

export const greenhouseAdapterVersion = "1.0.0";
export const greenhouseVariantId = "greenhouse-standard-v1";

// Selectors come from read-only inspection of public job-boards.greenhouse.io pages on 2026-10-22
// (ADR-053). The confirmation message was not observed live: the first real submission is its
// evidence, and an unrecognized result is reported as ambiguous for the candidate to settle.
const acceptedProfiles: readonly Readonly<GreenhouseExecutionProfile>[] = [
  {
    variantId: greenhouseVariantId,
    adapterVersion: greenhouseAdapterVersion,
    implementationSha256: applicationImplementationSha256,
    submitSelector: 'button[type="submit"]',
    confirmationSelector: "h1, h2, h3",
    confirmationText:
      "thank you for applying|your application (has been |was )?(received|submitted)|we(?:'|’)?ve received your application",
    confirmationReferenceAttribute: "",
  },
];
export function greenhouseExecutionProfile(variantId: string, adapterVersion: string) {
  return acceptedProfiles.find(
    (profile) => profile.variantId === variantId && profile.adapterVersion === adapterVersion,
  );
}
