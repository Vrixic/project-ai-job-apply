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

/** Repaired v1 plaintext preview; never rewrite provider truth or historical preview digests. */
export function comparatorPreservingPreviewDescription(value: string): string | undefined {
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
  return withoutControls.replace(/\s+/gu, " ").trim().slice(0, 12_000).trim();
}

/** Both v1 textContent representations, derived only from independently fetched API HTML. */
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

function pageDescriptionDigests(
  textContent: string,
  firstHeading: string | undefined,
  greenhouseCurrencyPresentation: boolean,
): readonly string[] {
  const normalizePage = (value: string) => value.replace(/\s+/gu, " ").trim().slice(0, 50_000);
  const full = normalizePage(textContent);
  const heading = firstHeading ? normalizePage(firstHeading) : "";
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
  const representations = greenhouseCurrencyPresentation
    ? values.flatMap((value) => [
        value,
        value.replace(/(\$\d[\d,]*(?:\.\d{2})?)—(?=\$\d)/gu, "$1 - "),
      ])
    : values;
  return Object.freeze([
    ...new Set(
      representations.flatMap((value) => {
        const current = comparatorPreservingPreviewDescription(value);
        const previews = [legacyPreviewDescription(value)];
        if (current !== undefined) previews.push(current);
        return previews.map((preview) =>
          createHash("sha256").update(normalizeText(preview)).digest("hex"),
        );
      }),
    ),
  ]);
}
