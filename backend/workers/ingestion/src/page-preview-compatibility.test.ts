import { createHash } from "node:crypto";
import { normalizeText } from "@ai-job-apply/jobs-service";
import { describe, expect, it } from "vitest";
import {
  comparatorPreservingPreviewDescription,
  greenhouseLegacyPageDescriptionDigests,
  legacyPageDescriptionDigests,
  legacyPreviewDescription,
} from "./page-preview-compatibility.js";
import { parsePublicDescriptionHtml } from "./provider-description.js";

const digest = (value: string) => createHash("sha256").update(normalizeText(value)).digest("hex");

describe("independent comparator-preserving v1 preview compatibility", () => {
  it.each([
    "Require < 5 years, > 2 regions, <= 10 services and >= 3 tests.",
    "Require 2 < experience < 5 and 3 <= regions <= 10.",
    "For x < y and y > z, preserve the stated relationship.",
    "Require <5 years and >2 regions.",
  ])("preserves exact comparison text: %s", (text) => {
    expect(comparatorPreservingPreviewDescription(text)).toBe(text);
  });

  it.each([
    "Read <script>execute</script>",
    "Read <name",
    "Read </name",
    "Read <!unfinished",
    "Read <?unfinished",
    "Read <STYLE",
    "Read ＜script＞execute＜/script＞",
    "Read <ｓｃｒｉｐｔ",
  ])("omits only the repaired alias for actual or malformed markup: %s", (text) => {
    expect(comparatorPreservingPreviewDescription(text)).toBeUndefined();
    expect(legacyPageDescriptionDigests(text)).toEqual([digest(legacyPreviewDescription(text))]);
  });

  it("retains frozen legacy comparison removal and its pre-existing truncation boundary", () => {
    expect(legacyPreviewDescription("Require < 5 and > 2 years.")).toBe("Require 2 years.");
    expect(legacyPreviewDescription(" A\u0000B\u200bC\n\tD ")).toBe("A B C D");
    const long = `${"x".repeat(11_999)} tail`;
    expect(legacyPreviewDescription(long)).toBe(`${"x".repeat(11_999)} `);
    expect(comparatorPreservingPreviewDescription(long)).toBe("x".repeat(11_999));
    expect(comparatorPreservingPreviewDescription(" A\u0000B\u200bC\n\tD ")).toBe("A B C D");
  });

  it("checks the complete source for markup before truncating the repaired alias", () => {
    const text = `${"x".repeat(12_001)}<script`;
    expect(comparatorPreservingPreviewDescription(text)).toBeUndefined();
    expect(legacyPageDescriptionDigests(text)).toEqual([digest("x".repeat(12_000))]);
  });

  it("derives decoded comparator aliases from API HTML without changing provider plaintext", () => {
    const parsed = parsePublicDescriptionHtml(
      "<p>Require &lt; 5 and &gt; 2 years, &lt;= 10 or &gt;= 3 regions.</p><p>Build safely.</p>",
    );
    const page = "Require < 5 and > 2 years, <= 10 or >= 3 regions.Build safely.";
    expect(parsed.textContent).toBe(page);
    expect(parsed.plainText).toBe(page.replace(".Build", ".\nBuild"));
    expect(legacyPageDescriptionDigests(parsed.textContent)).toEqual([
      digest(legacyPreviewDescription(page)),
      digest(page),
    ]);
  });

  it("retains all eight exact Greenhouse heading, currency and sanitizer combinations", () => {
    const heading = "About Example";
    const after = `${heading} Require < 5 and > 2 years. Salary $123,400—$145,600 USD.`;
    const full = `${heading}${after}`;
    const expected = [full, after].flatMap((text) =>
      [text, text.replace("$123,400—$145,600", "$123,400 - $145,600")].flatMap((value) => [
        digest(legacyPreviewDescription(value)),
        digest(value),
      ]),
    );
    const actual = greenhouseLegacyPageDescriptionDigests(full, heading);
    expect(actual).toHaveLength(8);
    expect(actual).toEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(actual).not.toContain(digest(after.replace("< 5", "<= 5")));
    expect(actual).not.toContain(digest(after.replace("> 2", "> 3")));
    expect(legacyPageDescriptionDigests(full, heading)).toHaveLength(4);
  });
});
