import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { legacyPageDescriptionDigests } from "./page-preview-compatibility.js";
import { parsePublicDescriptionHtml } from "./provider-description.js";

const digest = (value: string) => createHash("sha256").update(value.toLowerCase()).digest("hex");

describe("bounded independent provider HTML representation", () => {
  it("keeps readable provider text and exact DOM block concatenation separate", () => {
    expect(
      parsePublicDescriptionHtml(
        "<h2>About <b>Example</b></h2><p>Build systems.</p><ul><li>Support 12 regions.</li></ul>",
      ),
    ).toEqual({
      plainText: "About Example\nBuild systems.\nSupport 12 regions.",
      textContent: "About ExampleBuild systems.Support 12 regions.",
      firstHeading: "About Example",
    });
  });

  it("decodes entities as text without executing or including private/executable subtrees", () => {
    const result = parsePublicDescriptionHtml(
      '<p>Build &amp; operate &lt;systems&gt;.</p><script>PRIVATE_MARKER</script><form><input value="PRIVATE_MARKER">PRIVATE_MARKER</form><template>PRIVATE_MARKER</template><svg>PRIVATE_MARKER</svg><p>Safely.</p>',
    );
    expect(result.plainText).toBe("Build & operate <systems>.\nSafely.");
    expect(result.textContent).toBe("Build & operate <systems>.Safely.");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
  });

  it.each([undefined, 42, {}, "", " ", "<script>only unsafe</script>", "x".repeat(100_001)])(
    "rejects absent, malformed, empty or oversized descriptions",
    (value) => expect(() => parsePublicDescriptionHtml(value)).toThrow(),
  );

  it("supports exact first-heading deduplication and the frozen v1 length without fuzzy matching", () => {
    const html = parsePublicDescriptionHtml(
      "<h2>About Example</h2><p>About Example Build systems.</p>",
    );
    const digests = legacyPageDescriptionDigests(html.textContent, html.firstHeading);
    expect(digests).toContain(digest("About Example Build systems."));
    expect(digests).not.toContain(digest("Build systems."));
    const long = "x".repeat(13_000);
    expect(legacyPageDescriptionDigests(long)).toContain(digest(long.slice(0, 12_000)));
    expect(legacyPageDescriptionDigests(long)).not.toContain(digest(long.slice(0, 11_999)));
    expect(Object.isFrozen(digests)).toBe(true);
  });

  it("does not inherit the provider-specific Greenhouse currency rewrite", () => {
    const digests = legacyPageDescriptionDigests("Salary $123,400—$145,600 USD");
    expect(digests).toEqual([digest("Salary $123,400—$145,600 USD")]);
    expect(digests).not.toContain(digest("Salary $123,400 - $145,600 USD"));
  });
});
