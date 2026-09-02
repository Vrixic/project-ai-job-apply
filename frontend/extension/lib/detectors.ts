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

function exactHost(urlValue: string, domains: readonly string[]): boolean {
  try {
    const url = new URL(urlValue);
    return url.protocol === "https:" && domains.includes(url.hostname.toLowerCase());
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
      return exactHost(snapshot.canonicalUrl, domains)
        ? sanitizeSnapshot(snapshot, provider, variant, capturedAt)
        : undefined;
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
