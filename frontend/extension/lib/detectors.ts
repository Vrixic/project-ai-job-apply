import {
  type AtsProvider,
  type JobPageVariant,
  type RawPageSnapshot,
  type SanitizedJobCapture,
  sanitizeSnapshot,
} from "./job-capture";

export interface ProviderDetector {
  domains: readonly string[];
  provider: AtsProvider;
  variant: JobPageVariant;
  detect(snapshot: RawPageSnapshot, capturedAt?: string): SanitizedJobCapture | undefined;
}

function exactProviderPage(
  urlValue: string,
  provider: AtsProvider,
  domains: readonly string[],
): boolean {
  try {
    const url = new URL(urlValue);
    const pathMatches =
      provider === "greenhouse"
        ? /^\/[A-Za-z0-9._~-]+\/jobs\/[A-Za-z0-9._~-]+\/?$/u.test(url.pathname)
        : /^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/?$/u.test(url.pathname);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      domains.includes(url.hostname.toLowerCase()) &&
      pathMatches
    );
  } catch {
    return false;
  }
}

function detector(
  provider: AtsProvider,
  variant: JobPageVariant,
  domains: readonly string[],
): ProviderDetector {
  return {
    domains,
    provider,
    variant,
    detect(snapshot, capturedAt) {
      if (!exactProviderPage(snapshot.canonicalUrl, provider, domains)) {
        return undefined;
      }
      // A page-owned identifier can be an employer requisition number, not the provider's
      // posting identity. The exact validated active-tab path is authoritative for this field.
      const url = new URL(snapshot.canonicalUrl);
      // Supported provider APIs identify the posting without a trailing slash. Normalize only
      // this already-validated provider path; arbitrary URL canonicalization stays unchanged.
      url.pathname = url.pathname.replace(/\/$/u, "");
      const segments = url.pathname.split("/").filter(Boolean);
      const externalJobId = segments.at(-1);
      return sanitizeSnapshot(
        { ...snapshot, canonicalUrl: url.href, ...(externalJobId ? { externalJobId } : {}) },
        provider,
        variant,
        capturedAt,
      );
    },
  };
}

export const PROVIDER_DETECTORS: readonly ProviderDetector[] = [
  detector("greenhouse", "greenhouse-board-v1", [
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
  ]),
  detector("lever", "lever-posting-v1", ["jobs.lever.co", "jobs.eu.lever.co"]),
  detector("ashby", "ashby-job-board-v1", ["jobs.ashbyhq.com"]),
];

export function detectPublicJob(
  snapshot: RawPageSnapshot,
  capturedAt?: string,
): SanitizedJobCapture | undefined {
  for (const adapter of PROVIDER_DETECTORS) {
    const result = adapter.detect(snapshot, capturedAt);
    if (result) {
      return result;
    }
  }
  return undefined;
}
