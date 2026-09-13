import { createHash } from "node:crypto";
import { normalizeText } from "@ai-job-apply/jobs-service";

// Frozen d2-job-page-v1 sanitizer. Never use this to replace provider catalog text.
export function legacyPreviewDescription(value: string): string {
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
  return withoutControls
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 12_000);
}

function comparatorPreservingDescription(value: string): string | undefined {
  const markup = /<(?:\/?[a-z]|[!?])/iu;
  if (markup.test(value) || markup.test(value.normalize("NFKC"))) return undefined;
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
  if (markup.test(withoutControls) || markup.test(withoutControls.normalize("NFKC")))
    return undefined;
  return withoutControls.replace(/\s+/gu, " ").trim();
}

/** Frozen repaired v1 preview; retain its 12k boundary for already approved queued intents. */
export function comparatorPreservingPreviewDescription(value: string): string | undefined {
  return comparatorPreservingDescription(value)?.slice(0, 12_000).trim();
}

/** Complete current v1 representation. Never turn an oversized description into a prefix. */
export function fullPreviewDescription(value: string): string | undefined {
  const full = comparatorPreservingDescription(value);
  return full && full.length <= 50_000 ? full : undefined;
}

/** Historical and full v1 representations, derived only from independently fetched API HTML. */
export function legacyPageDescriptionDigests(
  textContent: string,
  firstHeading?: string,
): readonly string[] {
  return pageDescriptionDigests(textContent, firstHeading, false);
}

export function greenhouseLegacyPageDescriptionDigests(
  textContent: string,
  firstHeading?: string,
): readonly string[] {
  return pageDescriptionDigests(textContent, firstHeading, true);
}

function pageRepresentations(
  full: string,
  heading: string,
  greenhouseCurrencyPresentation: boolean,
): readonly string[] {
  const values = [full];
  if (heading && full.toLowerCase().startsWith(heading.toLowerCase())) {
    const after = full.slice(heading.length).trimStart();
    const boundary = after.at(heading.length);
    if (
      after.slice(0, heading.length).toLowerCase() === heading.toLowerCase() &&
      (!boundary || /[\s.,:;!?—–-]/u.test(boundary))
    ) {
      values.push(after);
    }
  }
  // The accepted Greenhouse presentation renders its dollar-range separator as a spaced
  // ASCII dash. Preserve both currency amounts, ordinary prose dashes, and other punctuation.
  // This is not punctuation removal, fuzzy matching, or acceptance of changed words/numbers.
  return greenhouseCurrencyPresentation
    ? values.flatMap((value) => [
        value,
        value.replace(/(\$\d[\d,]*(?:\.\d{2})?)—(?=\$\d)/gu, "$1 - "),
      ])
    : values;
}

function pageDescriptionDigests(
  textContent: string,
  firstHeading: string | undefined,
  greenhouseCurrencyPresentation: boolean,
): readonly string[] {
  // Preserve the earlier reader's 50k acquisition/12k preview aliases byte-for-byte. New full
  // aliases are derived separately from complete text and never inherit this historical slice.
  const normalizePage = (value: string) => value.replace(/\s+/gu, " ").trim().slice(0, 50_000);
  const heading = firstHeading ? normalizePage(firstHeading) : "";
  const representations = pageRepresentations(
    normalizePage(textContent),
    heading,
    greenhouseCurrencyPresentation,
  );
  const digests = representations.flatMap((value) => {
    const current = comparatorPreservingPreviewDescription(value);
    const previews = [legacyPreviewDescription(value)];
    if (current !== undefined) previews.push(current);
    return previews.map((preview) =>
      createHash("sha256").update(normalizeText(preview)).digest("hex"),
    );
  });
  const completePage = textContent.replace(/\s+/gu, " ").trim();
  if (completePage && completePage.length <= 50_000) {
    const completeRepresentations = pageRepresentations(
      completePage,
      heading,
      greenhouseCurrencyPresentation,
    );
    for (const representation of completeRepresentations) {
      const preview = fullPreviewDescription(representation);
      if (preview !== undefined) {
        digests.push(createHash("sha256").update(normalizeText(preview)).digest("hex"));
      }
    }
  }
  return Object.freeze([...new Set(digests)]);
}
