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

  it.each([
    "not a domain",
    "localhost",
    "-invalid.example",
    "invalid-.example",
    "invalid.123",
    "inválid.example",
    `${"a".repeat(64)}.example`,
  ])("rejects the invalid candidate domain %s", (candidateDomain) => {
    expect(() => resolveProductBrand({ candidateDomain })).toThrow(
      "Product candidate domain must be a valid DNS name.",
    );
  });
});
