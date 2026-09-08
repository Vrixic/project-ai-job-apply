import { capabilityForPage, type ExtensionDetectorActivationPolicy } from "./capability-policy";
import {
  DEVELOPMENT_CONTRIBUTION_PROVIDERS,
  parseDevelopmentContributionProviders,
} from "./development-contribution-providers";
import type { AtsProvider, SanitizedJobCapture } from "./job-capture";
import type { ExtensionContributionCapabilityDecision } from "./signed-capability-policy";

/** An unpacked-only client boundary, not a server authorization or publication decision. */
export class DevelopmentContributionRuntime {
  private readonly enabledProviders: readonly AtsProvider[];

  constructor(
    private readonly detectorPolicy: ExtensionDetectorActivationPolicy | undefined,
    enabledProviders: readonly AtsProvider[] = ["greenhouse"],
  ) {
    this.enabledProviders = parseDevelopmentContributionProviders(enabledProviders);
  }

  async start(): Promise<boolean> {
    return true;
  }
  async refresh(): Promise<boolean> {
    return true;
  }
  async refreshForReadiness(): Promise<boolean> {
    return true;
  }

  decision(
    capture: SanitizedJobCapture,
    clientVersion: string,
    _now?: Date,
  ): ExtensionContributionCapabilityDecision {
    if (clientVersion !== "0.2.0") return { allowed: false, reason: "client_disabled" };
    if (!this.enabledProviders.includes(capture.provider))
      return { allowed: false, reason: "provider_disabled" };
    const descriptor = DEVELOPMENT_CONTRIBUTION_PROVIDERS[capture.provider];
    if (capture.pageVariant !== descriptor.variant)
      return { allowed: false, reason: "variant_disabled" };
    let url: URL;
    try {
      url = new URL(capture.sourceUrl);
    } catch {
      return { allowed: false, reason: "domain_disabled" };
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !descriptor.domains.includes(url.hostname)
    ) {
      return { allowed: false, reason: "domain_disabled" };
    }
    const detector = capabilityForPage(capture.sourceUrl, clientVersion, this.detectorPolicy);
    if (
      !this.detectorPolicy ||
      !detector.allowed ||
      detector.provider !== capture.provider ||
      detector.variant !== capture.pageVariant
    ) {
      return { allowed: false, reason: "global_disabled" };
    }
    return { allowed: true, policyRevision: descriptor.revision };
  }
}
