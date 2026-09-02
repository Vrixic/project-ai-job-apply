import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const staticRoot = new URL("../static/", import.meta.url);
const entrypoint = new URL("../entrypoints/popup.ts", import.meta.url);

describe("popup and side-panel source assurance", () => {
  it("provides semantic controls, live status, a skip link, and visible focus treatment", async () => {
    const [html, css] = await Promise.all([
      readFile(new URL("popup.html", staticRoot), "utf8"),
      readFile(new URL("popup.css", staticRoot), "utf8"),
    ]);

    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html.match(/aria-live="polite"/gu)).toHaveLength(3);
    expect(html).not.toMatch(/<(?:div|span)[^>]+onclick=/iu);
    expect(html).not.toContain("user-scalable=no");
    expect(css).toContain(":focus-visible");
    expect(css).not.toContain("outline: none");
    expect(css).not.toContain("transition: all");
  });

  it("binds optional-field removal to both actions and confirms destructive queue clearing", async () => {
    const source = await readFile(entrypoint, "utf8");
    expect(source).toContain(
      'approvedFields: selectedFields(), intent: "private_save"',
    );
    expect(source).toContain(
      'approvedFields: selectedFields(), intent: "contribute"',
    );
    expect(source).toContain("window.confirm(");
  });
});
