import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import type { GreenhouseExecutionProfile } from "./execute";

// D2 job detection evidence contains no accepted application/confirmation selectors.
// Add only independently accepted, version-bound provider profiles in reviewed source.
const acceptedProfiles: readonly Readonly<GreenhouseExecutionProfile>[] = [];
export function greenhouseExecutionProfile(variantId: string, adapterVersion: string) {
  return acceptedProfiles.find(
    (profile) => profile.variantId === variantId && profile.adapterVersion === adapterVersion,
  );
}
export const greenhouseExecutionRegistry = new AdapterRegistry();
