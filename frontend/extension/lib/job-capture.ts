export const CAPTURE_FIELDS = [
  "title",
  "company",
  "location",
  "description",
  "externalJobId",
] as const;

export type CaptureField = (typeof CAPTURE_FIELDS)[number];
export type AtsProvider = "ashby" | "greenhouse" | "lever";
export type JobPageVariant = "ashby-job-board-v1" | "greenhouse-board-v1" | "lever-posting-v1";

export interface RawPageSnapshot {
  canonicalUrl: string;
  company?: string;
  description?: string;
  externalJobId?: string;
  location?: string;
  title?: string;
}

export interface SanitizedJobCapture {
  adapterVersion: "d2-job-page-v1";
  capturedAt: string;
  company?: string;
  description?: string;
  externalJobId?: string;
  location?: string;
  pageVariant: JobPageVariant;
  provider: AtsProvider;
  sourceUrl: string;
  title: string;
}

const LIMITS: Record<CaptureField, number> = {
  company: 240,
  description: 12_000,
  externalJobId: 200,
  location: 500,
  title: 240,
};

export function sanitizeText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const withoutControls = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        (code >= 127 && code <= 159) ||
        (code >= 0x200b && code <= 0x200f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2060 && code <= 0x206f) ||
        code === 0xfeff
        ? " "
        : character;
    })
    .join("");
  const normalized = withoutControls
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length > 0 ? normalized.slice(0, maximum) : undefined;
}

export function canonicalizePublicJobUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return undefined;
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^(?:10|127)\./u.test(hostname) ||
    /^169\.254\./u.test(hostname) ||
    /^192\.168\./u.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname)
  ) {
    return undefined;
  }
  url.hash = "";
  url.search = "";
  url.hostname = hostname;
  return url.href;
}

export function sanitizeSnapshot(
  snapshot: RawPageSnapshot,
  provider: AtsProvider,
  pageVariant: JobPageVariant,
  capturedAt = new Date().toISOString(),
): SanitizedJobCapture | undefined {
  const sourceUrl = canonicalizePublicJobUrl(snapshot.canonicalUrl);
  const title = sanitizeText(snapshot.title, LIMITS.title);
  if (!sourceUrl || !title || !Number.isFinite(Date.parse(capturedAt))) {
    return undefined;
  }
  const optional = Object.fromEntries(
    CAPTURE_FIELDS.filter((field) => field !== "title")
      .map((field) => [field, sanitizeText(snapshot[field], LIMITS[field])])
      .filter((entry): entry is [CaptureField, string] => typeof entry[1] === "string"),
  );
  return {
    adapterVersion: "d2-job-page-v1",
    capturedAt,
    pageVariant,
    provider,
    sourceUrl,
    title,
    ...optional,
  };
}

export function selectContributionFields(
  capture: SanitizedJobCapture,
  selectedFields: readonly CaptureField[],
): SanitizedJobCapture {
  const selected = new Set(selectedFields);
  const result: SanitizedJobCapture = {
    adapterVersion: capture.adapterVersion,
    capturedAt: capture.capturedAt,
    pageVariant: capture.pageVariant,
    provider: capture.provider,
    sourceUrl: capture.sourceUrl,
    title: capture.title,
  };
  for (const field of CAPTURE_FIELDS) {
    if (field === "title" || !selected.has(field)) {
      continue;
    }
    const value = capture[field];
    if (value) {
      result[field] = value;
    }
  }
  return result;
}
