import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_BRAND, resolveProductBrand } from "./brand.js";

describe("product brand configuration", () => {
  it("uses the provisional ApplyDash identity by default", () => {
    expect(resolveProductBrand()).toEqual(DEFAULT_PRODUCT_BRAND);
  });

  it("allows the presentation identity to change without changing technical identifiers", () => {
    expect(
      resolveProductBrand({
        name: "Future Brand",
        candidateDomain: "FutureBrand.example",
      }),
    ).toEqual({
      name: "Future Brand",
      candidateDomain: "futurebrand.example",
      status: "provisional",
    });
  });

  it("rejects an invalid candidate domain", () => {
    expect(() => resolveProductBrand({ candidateDomain: "not a domain" })).toThrow(
      "Product candidate domain must be a valid DNS name.",
    );
  });
});
