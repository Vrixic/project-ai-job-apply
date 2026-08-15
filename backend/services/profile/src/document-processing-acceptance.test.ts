import { describe, expect, it } from "vitest";
import { documentProcessingAcceptanceSubject } from "./document-processing-acceptance.js";

describe("document-processing Profile acceptance boundary", () => {
  it("derives an exact value-free synthetic subject", () => {
    expect(documentProcessingAcceptanceSubject("abcdef01-abcd-4abc-8abc-abcdef012345")).toBe(
      "d1-document-processing-acceptance:abcdef01-abcd-4abc-8abc-abcdef012345",
    );
  });

  it("rejects non-canonical identifiers", () => {
    expect(() =>
      documentProcessingAcceptanceSubject("ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345"),
    ).toThrow("run ID");
  });
});
