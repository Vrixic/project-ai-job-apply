export interface ProductBrand {
  name: string;
  candidateDomain: string;
  status: "provisional" | "approved";
}

export interface ProductBrandOverrides {
  name?: string | undefined;
  candidateDomain?: string | undefined;
}

export const DEFAULT_PRODUCT_BRAND: Readonly<ProductBrand> = Object.freeze({
  name: "ApplyDash",
  candidateDomain: "applydash.ai",
  status: "provisional",
});

function isAsciiLowercaseLetter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function isAsciiLowercaseAlphanumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || isAsciiLowercaseLetter(character);
}

function isValidDomainLabel(label: string): boolean {
  if (
    label.length < 1 ||
    label.length > 63 ||
    !isAsciiLowercaseAlphanumeric(label[0] ?? "") ||
    !isAsciiLowercaseAlphanumeric(label.at(-1) ?? "")
  ) {
    return false;
  }
  return [...label].every(
    (character) => character === "-" || isAsciiLowercaseAlphanumeric(character),
  );
}

function isValidCandidateDomain(candidateDomain: string): boolean {
  if (candidateDomain.length < 1 || candidateDomain.length > 253) {
    return false;
  }
  const labels = candidateDomain.split(".");
  const topLevelDomain = labels.at(-1) ?? "";
  return (
    labels.length >= 2 &&
    topLevelDomain.length >= 2 &&
    [...topLevelDomain].every(isAsciiLowercaseLetter) &&
    labels.every(isValidDomainLabel)
  );
}

export function resolveProductBrand(overrides: ProductBrandOverrides = {}): Readonly<ProductBrand> {
  const name = overrides.name?.trim() || DEFAULT_PRODUCT_BRAND.name;
  const candidateDomain =
    overrides.candidateDomain?.trim().toLowerCase() || DEFAULT_PRODUCT_BRAND.candidateDomain;

  if (name.length > 80) {
    throw new Error("Product brand name must contain at most 80 characters.");
  }
  if (!isValidCandidateDomain(candidateDomain)) {
    throw new Error("Product candidate domain must be a valid DNS name.");
  }

  return Object.freeze({
    name,
    candidateDomain,
    status: DEFAULT_PRODUCT_BRAND.status,
  });
}
