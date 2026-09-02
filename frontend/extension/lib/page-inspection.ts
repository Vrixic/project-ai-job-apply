import type { RawPageSnapshot } from "./job-capture";

// This function is serialized by chrome.scripting and therefore must remain self-contained.
// It reads a strict public-job allowlist only after the user invokes the extension action.
export function captureCurrentPublicJobPage(): RawPageSnapshot {
  const text = (...selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.replace(/\s+/gu, " ").trim();
      if (value) {
        return value.slice(0, 50_000);
      }
    }
    return undefined;
  };
  let structured: Record<string, unknown> | undefined;
  for (const node of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const source = node.textContent ?? "";
      if (source.length > 200_000) continue;
      const parsed = JSON.parse(source) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      structured = candidates.find((candidate): candidate is Record<string, unknown> =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            (candidate as { "@type"?: unknown })["@type"] === "JobPosting",
        ),
      );
      if (structured) break;
    } catch {
      // Malformed page-owned structured data is ignored, never reported.
    }
  }
  const organization = structured?.hiringOrganization;
  const organizationName =
    organization && typeof organization === "object" && !Array.isArray(organization)
      ? (organization as { name?: unknown }).name
      : undefined;
  const jobLocation = structured?.jobLocation;
  const locationValue = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address =
    locationValue && typeof locationValue === "object" && !Array.isArray(locationValue)
      ? (locationValue as { address?: unknown }).address
      : undefined;
  const addressRecord =
    address && typeof address === "object" && !Array.isArray(address)
      ? (address as Record<string, unknown>)
      : undefined;
  const structuredLocation = addressRecord
    ? [addressRecord.addressLocality, addressRecord.addressRegion, addressRecord.addressCountry]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(", ")
    : undefined;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const description =
    typeof structured?.description === "string"
      ? (new DOMParser()
          .parseFromString(structured.description.slice(0, 200_000), "text/html")
          .body.textContent?.slice(0, 50_000) ?? undefined)
      : text("[data-job-description]", ".job__description", ".content", "main article");
  const result: RawPageSnapshot = { canonicalUrl: canonical || location.href };
  const company =
    typeof organizationName === "string"
      ? organizationName
      : text("[data-company-name]", ".company-name", ".posting-categories + h2");
  const externalJobId =
    typeof structured?.identifier === "string"
      ? structured.identifier
      : text("[data-job-id]", "[data-requisition-id]");
  const publicLocation =
    structuredLocation || text("[data-job-location]", ".location", ".posting-categories .location");
  const title =
    typeof structured?.title === "string"
      ? structured.title
      : text("h1", "[data-job-title]", ".posting-headline h2");
  if (company) result.company = company;
  if (description) result.description = description;
  if (externalJobId) result.externalJobId = externalJobId;
  if (publicLocation) result.location = publicLocation;
  if (title) result.title = title;
  return result;
}
