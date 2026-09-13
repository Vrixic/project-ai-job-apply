import { describe, expect, it } from "vitest";
import {
  parseCorroboratedAshbyDescriptionHtml,
  parsePublicDescriptionHtml,
} from "./provider-description.js";

const html =
  '<h2>About <b>Example</b></h2><p>Read <a href="https://docs.example.test/Role?one=1&amp;two=2">the guide</a>.</p>' +
  "<ul><li>Require &lt; 5 years and &gt;= 2 regions.</li><li>Build &amp; operate.</li></ul>" +
  '<p><img src="https://cdn.example.test/Chart.png" alt="System &amp; role"></p>';
const native =
  "ABOUT EXAMPLE\nRead the guide https://docs.example.test/Role?one=1&two=2.\n" +
  "- Require < 5 years and >= 2 regions.\n- Build & operate.\n" +
  "System & role [https://cdn.example.test/Chart.png]";

describe("Ashby-only independent native HTML corroboration", () => {
  it("corroborates the entire native representation and returns only unchanged shared outputs", () => {
    const result = parseCorroboratedAshbyDescriptionHtml(html, native);
    expect(result).toEqual(parsePublicDescriptionHtml(html));
    expect(result?.textContent).toBe(
      "About ExampleRead the guide.Require < 5 years and >= 2 regions.Build & operate.",
    );
    expect(result?.firstHeading).toBe("About Example");
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/https:|Chart|native/iu);
  });

  it("retains the original exact whole-plaintext path before native annotations", () => {
    const parsed = parsePublicDescriptionHtml(html);
    expect(parseCorroboratedAshbyDescriptionHtml(html, parsed.plainText)).toEqual(parsed);
    expect(parseCorroboratedAshbyDescriptionHtml(html, native.replaceAll("\n", " \t "))).toEqual(
      parsed,
    );
  });

  it.each([
    ["text", html.replace("the guide", "the handbook")],
    ["operator", html.replace("&lt; 5", "&lt;= 5")],
    ["number", html.replace("5 years", "6 years")],
    ["href", html.replace("/Role?", "/role?")],
    ["href query", html.replace("two=2", "two=3")],
    ["src", html.replace("/Chart.png", "/chart.png")],
    ["alt", html.replace("System &amp; role", "System &amp; other role")],
    ["extra content", `${html}<p>Unexpected extra requirement.</p>`],
    ["extra link", `${html}<a href="https://other.example.test">Other requirement.</a>`],
    ["missing list", html.replace("<li>Build &amp; operate.</li>", "")],
  ])("refuses changed %s without stripping or fuzzy matching", (_reason, changed) => {
    expect(parseCorroboratedAshbyDescriptionHtml(changed, native)).toBeUndefined();
  });

  it.each([
    native.replace("the guide", "THE GUIDE"),
    native.replace("< 5", "<= 5"),
    native.replace("< 5", "< 6"),
    native.replace("< 5", "＜ 5"),
    native.replace("/Role?", "/role?"),
    native.replace("?one=1&two=2", "?two=2&one=1"),
    native.replace("System & role ", ""),
    native.replace("- Build", "Build"),
    native.replace("ABOUT EXAMPLE", "About Example"),
    `${native} Extra requirement.`,
    native.slice(0, -1),
  ])("requires exact complete provider plaintext, including annotations and case", (changed) => {
    expect(parseCorroboratedAshbyDescriptionHtml(html, changed)).toBeUndefined();
  });

  it("uppercases heading text and image alt but never mixed-case href/src annotations", () => {
    const heading =
      '<h2>See <a href="https://docs.example.test/MixedCase">the guide</a><img alt="Role chart" src="https://cdn.example.test/MixedCase.png"></h2>';
    const expected =
      "SEE THE GUIDE https://docs.example.test/MixedCaseROLE CHART [https://cdn.example.test/MixedCase.png]";
    expect(parseCorroboratedAshbyDescriptionHtml(heading, expected)).toEqual(
      parsePublicDescriptionHtml(heading),
    );
    expect(
      parseCorroboratedAshbyDescriptionHtml(
        heading.replace('/MixedCase"', '/mixedcase"'),
        expected,
      ),
    ).toBeUndefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(
        heading.replace("/MixedCase.png", "/mixedcase.png"),
        expected,
      ),
    ).toBeUndefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(heading.replace("Role chart", "Other chart"), expected),
    ).toBeUndefined();
    expect(parseCorroboratedAshbyDescriptionHtml(heading, expected.toUpperCase())).toBeUndefined();
  });

  it("never suppresses redundant hrefs, strips protocols, or rewrites native URLs", () => {
    const selected =
      '<p><a href="https://example.test/Mixed">https://example.test/Mixed</a> <a href="mailto:role@example.test">Contact</a></p>';
    const expected =
      "https://example.test/Mixed https://example.test/Mixed Contact mailto:role@example.test";
    expect(parseCorroboratedAshbyDescriptionHtml(selected, expected)).toBeDefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(selected, expected.replace("mailto:", "")),
    ).toBeUndefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(
        selected,
        expected.replace("https://example.test/Mixed ", ""),
      ),
    ).toBeUndefined();
  });

  it.each([
    " ",
    "  ",
    "&#10;",
    "&#9;",
    "&#127;",
    "&#133;",
    "&#8203;",
    "&#8238;",
    "&#8294;",
    "&#65279;",
  ])("declines native URLs containing whitespace/control/bidi annotation %s", (separator) => {
    const anchor = `<p>Read <a href="https://example.test/a${separator}b">docs</a>.</p>`;
    const image = `<p>Chart<img alt="Role" src="https://example.test/a${separator}b"></p>`;
    const entity = /^&#(\d+);$/u.exec(separator);
    const decoded = entity ? String.fromCodePoint(Number(entity[1])) : separator;
    const annotatedUrl = `https://example.test/a${decoded}b`.replace(/\s+/gu, " ");
    expect(
      parseCorroboratedAshbyDescriptionHtml(anchor, `Read docs ${annotatedUrl}.`),
    ).toBeUndefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(image, `ChartRole [${annotatedUrl}]`),
    ).toBeUndefined();
    // The independently established original plain-text path remains unchanged.
    expect(parseCorroboratedAshbyDescriptionHtml(anchor, "Read docs.")).toEqual(
      parsePublicDescriptionHtml(anchor),
    );
  });

  it.each([
    "script",
    "style",
    "template",
    "noscript",
    "iframe",
    "object",
    "svg",
    "math",
    "form",
    "textarea",
    "select",
    "button",
  ])("shares the existing unsafe-subtree exclusion for %s", (tag) => {
    const unsafe = `<${tag}>PRIVATE_MARKER<a href="https://private.example.test">PRIVATE_MARKER</a></${tag}>`;
    const result = parseCorroboratedAshbyDescriptionHtml(`${html}${unsafe}`, native);
    expect(result).toEqual(parsePublicDescriptionHtml(html));
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
    expect(
      parseCorroboratedAshbyDescriptionHtml(`${html}${unsafe}`, `${native} PRIVATE_MARKER`),
    ).toBeUndefined();
  });

  it.each(["svg", "math"])("refuses new HTML nodes that escape a %s foreign subtree", (tag) => {
    const escaped = `${html}<${tag}><img src="https://other.example.test/image" alt="Unexpected"></${tag}>`;
    expect(parseCorroboratedAshbyDescriptionHtml(escaped, native)).toBeUndefined();
  });

  it.each([undefined, 42, {}, "", "<script>unsafe only</script>", "x".repeat(100_001)])(
    "preserves malformed/empty/oversized HTML refusal",
    (value) => {
      expect(() => parseCorroboratedAshbyDescriptionHtml(value, native)).toThrow();
    },
  );

  it("uses iterative bounded traversal for deeply nested heading text", () => {
    const deep = `<h2>${"<b>".repeat(2_000)}Build${"</b>".repeat(2_000)}</h2>`;
    expect(parseCorroboratedAshbyDescriptionHtml(deep, "BUILD")?.textContent).toBe("Build");
  });

  it("bounds native output even when heading uppercasing expands input characters", () => {
    expect(
      parseCorroboratedAshbyDescriptionHtml(`<h2>${"ß".repeat(49_999)}</h2>`, "SS".repeat(49_999)),
    ).toBeDefined();
    expect(
      parseCorroboratedAshbyDescriptionHtml(`<h2>${"ß".repeat(50_001)}</h2>`, "SS".repeat(50_001)),
    ).toBeUndefined();
  });
});
