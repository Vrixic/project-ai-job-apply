import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("installed extension browser harness boundary", () => {
  it("uses only synthetic loopback pages and blocks external traffic", async () => {
    const source = await readFile(new URL("../../../scripts/tests/d2-extension-assurance/browser.mjs", import.meta.url), "utf8");
    expect(source).toContain('url.hostname === "127.0.0.1"');
    expect(source).toContain('route.abort("blockedbyclient")');
    expect(source).not.toMatch(/page\.goto\(`https:\/\//u);
    expect(source).toContain("sensitiveArtifactsRetained");
    expect(source).toContain("telemetryRequests: 0");
  });
});
