import { createHash } from "node:crypto";
import { normalizeText } from "@ai-job-apply/jobs-service";
import { describe, expect, it } from "vitest";
import {
  comparatorPreservingPreviewDescription,
  fullPreviewDescription,
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
    expect(fullPreviewDescription(text)).toBeUndefined();
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

  it("preserves the complete bounded current description and both frozen 12k aliases", () => {
    const text = `Require < 5 and > 2 years. ${"x".repeat(12_100)} Final obligation >= 3 checks.`;
    expect(fullPreviewDescription(text)).toBe(text);
    expect(legacyPageDescriptionDigests(text)).toEqual([
      digest(legacyPreviewDescription(text)),
      digest(comparatorPreservingPreviewDescription(text) ?? ""),
      digest(text),
    ]);
    expect(fullPreviewDescription(" A\u0000B\u200bC\n\tD ")).toBe("A B C D");
    expect(fullPreviewDescription("")).toBeUndefined();
    expect(fullPreviewDescription("\n \t")).toBeUndefined();
  });

  it("accepts exactly 50k normalized characters without creating an oversize prefix alias", () => {
    const maximum = "x".repeat(50_000);
    expect(fullPreviewDescription(` \n${maximum}\t `)).toBe(maximum);
    expect(legacyPageDescriptionDigests(maximum)).toContain(digest(maximum));
    const oversized = `${maximum} extra`;
    expect(fullPreviewDescription(oversized)).toBeUndefined();
    expect(legacyPageDescriptionDigests(oversized)).toEqual([digest("x".repeat(12_000))]);
    expect(legacyPageDescriptionDigests(oversized)).not.toContain(digest(maximum));
  });

  it("checks the full pre-heading source bound and does not allow removal to rescue oversize", () => {
    const heading = "About Example";
    const after = `${heading} ${"x".repeat(49_980)}`;
    expect(after.length).toBeLessThanOrEqual(50_000);
    const full = `${heading}${after}`;
    expect(full.length).toBeGreaterThan(50_000);
    expect(legacyPageDescriptionDigests(full, heading)).not.toContain(digest(after));
  });

  it("rejects late incomplete markup instead of issuing a full prefix digest", () => {
    const prefix = "x".repeat(12_100);
    for (const tail of ["<script", "</script", "<!unfinished", "＜script", "<ｓｃｒｉｐｔ"]) {
      const text = `${prefix}${tail}`;
      expect(fullPreviewDescription(text)).toBeUndefined();
      expect(legacyPageDescriptionDigests(text)).toEqual([digest("x".repeat(12_000))]);
      expect(legacyPageDescriptionDigests(text)).not.toContain(digest(prefix));
    }
  });

  it("retains all twelve full and historical Greenhouse representations without tail edits", () => {
    const heading = "About Example";
    const after = `${heading} Require < 5 and > 2 years. Salary $123,400—$145,600 USD. ${"x".repeat(12_100)} Final >= 3 checks.`;
    const full = `${heading}${after}`;
    const values = [full, after].flatMap((text) => [
      text,
      text.replace("$123,400—$145,600", "$123,400 - $145,600"),
    ]);
    const historical = values.flatMap((value) => [
      digest(legacyPreviewDescription(value)),
      digest(comparatorPreservingPreviewDescription(value) ?? ""),
    ]);
    const actual = greenhouseLegacyPageDescriptionDigests(full, heading);
    expect(actual).toHaveLength(12);
    expect(actual).toEqual([...historical, ...values.map(digest)]);
    expect(actual).not.toContain(digest(after.replace("Final >= 3", "Final > 3")));
    expect(actual).not.toContain(digest(after.replace("Final >= 3", "Final >= 4")));
    expect(actual).not.toContain(digest(after.slice(0, -1)));
    expect(Object.isFrozen(actual)).toBe(true);
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
