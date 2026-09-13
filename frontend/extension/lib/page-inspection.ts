import type { RawPageSnapshot } from "./job-capture";

// This function is serialized by chrome.scripting and therefore must remain self-contained.
// It reads a strict public-job allowlist only after the user invokes the extension action.
export function captureCurrentPublicJobPage(): RawPageSnapshot {
  let descriptionUnavailableReason: "too_long" | "source_too_large" | undefined;
  const normalize = (value: string | null | undefined): string | undefined => {
    const normalized = value?.replace(/\s+/gu, " ").trim();
    return normalized ? normalized.slice(0, 50_000) : undefined;
  };
  const normalizedWorkMode = (value: unknown): "hybrid" | "on_site" | "remote" | undefined => {
    if (typeof value !== "string") return undefined;
    const token = value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/gu, "_");
    if (token === "remote" || token === "telecommute") return "remote";
    if (token === "hybrid") return "hybrid";
    if (token === "on_site" || token === "onsite") return "on_site";
    return undefined;
  };
  const splitLocation = (
    value: string | undefined,
    explicitWorkMode: "hybrid" | "on_site" | "remote" | undefined,
  ): { location?: string; workMode?: "hybrid" | "on_site" | "remote" } => {
    if (!value) return explicitWorkMode ? { workMode: explicitWorkMode } : {};
    const combined = value.match(/^(remote|hybrid|on[\s_-]?site)\s*(?:[-–—|·]|,)\s*(\S.*)$/iu);
    const prefixMode = normalizedWorkMode(combined?.[1]);
    const location = normalize(combined?.[2] ?? value);
    const workMode = explicitWorkMode ?? prefixMode;
    return {
      ...(location ? { location } : {}),
      ...(workMode ? { workMode } : {}),
    };
  };
  const text = (...selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const value = normalize(document.querySelector(selector)?.textContent);
      if (value) {
        return value;
      }
    }
    return undefined;
  };
  const attribute = (name: string, ...selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const value = normalize(document.querySelector(selector)?.getAttribute(name));
      if (value) {
        return value;
      }
    }
    return undefined;
  };
  const descriptionText = (
    root: Pick<Element, "firstElementChild" | "textContent">,
  ): string | undefined => {
    // Never present a truncated prefix as the complete selected description. Check the full
    // normalized text before the optional duplicate-heading adjustment below.
    const fullText = root.textContent?.replace(/\s+/gu, " ").trim();
    if (fullText && fullText.length > 50_000) {
      descriptionUnavailableReason = "too_long";
      return undefined;
    }
    const firstElement = root.firstElementChild;
    if (!fullText || !firstElement || !/^H[1-6]$/u.test(firstElement.tagName)) {
      return fullText;
    }
    const heading = normalize(firstElement.textContent);
    if (!heading || !fullText.toLowerCase().startsWith(heading.toLowerCase())) {
      return fullText;
    }
    const afterHeading = fullText.slice(heading.length).trimStart();
    const repeatedPrefix = afterHeading.slice(0, heading.length);
    const boundary = afterHeading.at(heading.length);
    return repeatedPrefix.toLowerCase() === heading.toLowerCase() &&
      (!boundary || /[\s.,:;!?—–-]/u.test(boundary))
      ? afterHeading || undefined
      : fullText;
  };
  let structured: Record<string, unknown> | undefined;
  let oversizedStructuredSource = false;
  for (const node of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    try {
      const source = node.textContent ?? "";
      if (source.length > 200_000) {
        oversizedStructuredSource = true;
        continue;
      }
      const parsed = JSON.parse(source) as unknown;
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      const candidates = roots.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          return [candidate];
        }
        const graph = (candidate as { "@graph"?: unknown })["@graph"];
        return Array.isArray(graph) ? [candidate, ...graph] : [candidate];
      });
      structured = candidates.find((candidate): candidate is Record<string, unknown> =>
        Boolean(
          candidate &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            ((candidate as { "@type"?: unknown })["@type"] === "JobPosting" ||
              (Array.isArray((candidate as { "@type"?: unknown })["@type"]) &&
                ((candidate as { "@type": unknown[] })["@type"] as unknown[]).includes(
                  "JobPosting",
                ))),
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
  const identifier = structured?.identifier;
  const identifierValue = Array.isArray(identifier)
    ? identifier.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          typeof (candidate as { value?: unknown }).value === "string",
      )
    : identifier;
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
  const structuredDescription = structured?.description;
  const description =
    typeof structuredDescription === "string"
      ? (() => {
          if (structuredDescription.length > 200_000) {
            descriptionUnavailableReason = "source_too_large";
            return undefined;
          }
          return descriptionText(
            new DOMParser().parseFromString(structuredDescription, "text/html").body,
          );
        })()
      : (() => {
          for (const selector of [
            "[data-job-description]",
            ".job__description",
            ".content",
            "main article",
          ]) {
            const node = document.querySelector(selector);
            if (node) return descriptionText(node);
          }
          return undefined;
        })();
  if (!description && !descriptionUnavailableReason && !structured && oversizedStructuredSource) {
    descriptionUnavailableReason = "source_too_large";
  }
  // The already-authorized active tab is the source identity. Page-owned canonical links are
  // untrusted input and can incorrectly downgrade HTTPS or point at another origin.
  const result: RawPageSnapshot = { canonicalUrl: location.href };
  let activeHostname: string | undefined;
  try {
    activeHostname = new URL(location.href).hostname.toLowerCase();
  } catch {
    // The detector will reject malformed active-tab URLs.
  }
  const visibleCompany =
    activeHostname === "boards.greenhouse.io" || activeHostname === "job-boards.greenhouse.io"
      ? text("[data-company-name]", ".company-name") ||
        attribute("alt", "#logo img[alt]", ".logo img[alt]", ".company-logo img[alt]")
      : activeHostname === "jobs.lever.co" || activeHostname === "jobs.eu.lever.co"
        ? text("[data-company-name]", '[data-qa="company-name"]', ".company-name") ||
          attribute("alt", ".main-header-logo img[alt]", ".company-logo img[alt]")
        : activeHostname === "jobs.ashbyhq.com"
          ? text(
              '[data-testid="company-name"]',
              ".ashby-job-posting-heading__company-name",
              "[data-company-name]",
            ) || attribute("alt", '[data-testid="job-posting-header"] img[alt]')
          : undefined;
  const company = typeof organizationName === "string" ? organizationName : visibleCompany;
  const externalJobId =
    typeof structured?.identifier === "string"
      ? structured.identifier
      : identifierValue && typeof identifierValue === "object" && !Array.isArray(identifierValue)
        ? (identifierValue as { value?: unknown }).value
        : text("[data-job-id]", "[data-requisition-id]");
  const publicLocation =
    structuredLocation ||
    text("[data-job-location]", ".job__location", ".location", ".posting-categories .location");
  const explicitWorkMode =
    normalizedWorkMode(structured?.jobLocationType) ??
    normalizedWorkMode(text("[data-job-work-mode]", "[data-workplace-type]", ".workplace-type")) ??
    normalizedWorkMode(
      activeHostname === "jobs.lever.co" || activeHostname === "jobs.eu.lever.co"
        ? text(".posting-categories .workplaceTypes")
        : undefined,
    );
  const separatedLocation = splitLocation(publicLocation, explicitWorkMode);
  const title =
    typeof structured?.title === "string"
      ? structured.title
      : text("h1", "[data-job-title]", ".posting-headline h2");
  if (company) result.company = company;
  if (description) result.description = description;
  if (descriptionUnavailableReason)
    result.descriptionUnavailableReason = descriptionUnavailableReason;
  if (typeof externalJobId === "string" && externalJobId) result.externalJobId = externalJobId;
  if (separatedLocation.location) result.location = separatedLocation.location;
  if (separatedLocation.workMode) result.workMode = separatedLocation.workMode;
  if (title) result.title = title;
  return result;
}
