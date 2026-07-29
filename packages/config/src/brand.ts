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

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function resolveProductBrand(overrides: ProductBrandOverrides = {}): Readonly<ProductBrand> {
  const name = overrides.name?.trim() || DEFAULT_PRODUCT_BRAND.name;
  const candidateDomain =
    overrides.candidateDomain?.trim().toLowerCase() || DEFAULT_PRODUCT_BRAND.candidateDomain;

  if (name.length > 80) {
    throw new Error("Product brand name must contain at most 80 characters.");
  }
  if (!domainPattern.test(candidateDomain)) {
    throw new Error("Product candidate domain must be a valid DNS name.");
  }

  return Object.freeze({
    name,
    candidateDomain,
    status: DEFAULT_PRODUCT_BRAND.status,
  });
}
