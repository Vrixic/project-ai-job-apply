import type { ExecutionProfile } from "../providers/types";

/** The Greenhouse profile type predates the second provider and stays as a name for it. */
export type GreenhouseExecutionProfile = ExecutionProfile;

// D2 job detection evidence contains no accepted application/confirmation selectors.
// Add only reviewed, version-bound provider profiles in reviewed source.
const acceptedProfiles: readonly Readonly<GreenhouseExecutionProfile>[] = [];
export function greenhouseExecutionProfile(variantId: string, adapterVersion: string) {
  return acceptedProfiles.find(
    (profile) => profile.variantId === variantId && profile.adapterVersion === adapterVersion,
  );
}
