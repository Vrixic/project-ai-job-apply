import { capabilityForPage, type ExtensionDetectorActivationPolicy } from "./capability-policy";
import type { SanitizedJobCapture } from "./job-capture";
import type { ExtensionContributionCapabilityDecision } from "./signed-capability-policy";

/** An unpacked-only client boundary, not a server authorization or publication decision. */
export class DevelopmentContributionRuntime {
  constructor(private readonly detectorPolicy: ExtensionDetectorActivationPolicy | undefined) {}

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
    if (capture.provider !== "greenhouse") return { allowed: false, reason: "provider_disabled" };
    if (capture.pageVariant !== "greenhouse-board-v1")
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
      !["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)
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
    return { allowed: true, policyRevision: "d2-development-greenhouse-persistent-v1" };
  }
}
