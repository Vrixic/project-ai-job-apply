import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const staticRoot = new URL("../static/", import.meta.url);
const entrypoint = new URL("../entrypoints/popup.ts", import.meta.url);

describe("popup and side-panel source assurance", () => {
  it("describes missing development UGC settings as preview authorization, not signed-policy renewal", async () => {
    const source = await readFile(entrypoint, "utf8");
    expect(source).toContain(
      'policy_configuration_required: extensionConfiguration.developmentContributions\n    ? "Configure the public-add preview authorization version before delivery."',
    );
  });
  it("provides semantic controls, live status, disclosures, and visible focus treatment", async () => {
    const [html, css] = await Promise.all([
      readFile(new URL("popup.html", staticRoot), "utf8"),
      readFile(new URL("popup.css", staticRoot), "utf8"),
    ]);

    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html.match(/aria-live="polite"/gu)).toHaveLength(8);
    expect(html).toContain('role="status"');
    expect(html).toContain('id="queue-panel" class="disclosure');
    expect(html).toContain('id="contributions-panel" class="disclosure');
    expect(html).toContain('id="selection-summary"');
    expect(html).toContain('id="delivery-readiness"');
    expect(html).toContain('name="appeal-evidence"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain('data-extension-surface="popup"');
    expect(html).toContain(">Add job to shared database</button>");
    expect(html).not.toContain('id="save-private"');
    expect(html).not.toContain('id="contribution-consent"');
    expect(html).not.toMatch(/<(?:div|span)[^>]+onclick=/iu);
    expect(html).not.toContain("user-scalable=no");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("button:active:not(:disabled)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("min-width: 0");
    expect(css).toContain('html[data-extension-surface="popup"]');
    expect(css).toContain("min-width: 28rem");
    expect(css).toContain("width: 28rem");
    expect(css).toContain("min-height: 37.5rem");
    expect(css).not.toContain(".field-selection");
    expect(css).not.toContain("outline: none");
    expect(css).not.toContain("transition: all");
    expect(css).not.toMatch(/font-size:\s*(?:9|10|11)px/gu);
  });

  it("keeps disclosure keyboard focus inside the clipped card", async () => {
    const css = await readFile(new URL("popup.css", staticRoot), "utf8");
    expect(css).toMatch(
      /\.disclosure\s*>\s*summary:focus-visible\s*\{[^}]*outline-offset:\s*-4px;/u,
    );
    expect(css).toMatch(
      /button,\s*input,\s*textarea,\s*summary\s*\{\s*scroll-margin-block:\s*8px;/u,
    );
  });

  it("renders complete grounded field states with reversible expansion and dynamic selection", async () => {
    const source = await readFile(entrypoint, "utf8");
    expect(source).toContain('jobHeading.textContent = "Job details"');
    expect(source).toContain('sourceDetails.id = "source-details"');
    expect(source).toContain(
      'body.textContent = value ?? options.unavailableMessage ?? "Not available for sharing"',
    );
    expect(source).toContain('expandButton.setAttribute("aria-controls", valueId)');
    expect(source).toContain('expandButton.setAttribute("aria-expanded", "false")');
    expect(source).toContain("function updateSelectionSummary(): void");
    expect(source).toContain("All available public job fields included");
    expect(source).toContain('"Next action: Add job to shared database"');
    expect(source).toMatch(/appendField\(\s*jobGroup,\s*"Work type"/u);
  });

  it("fails the single public-add action closed and confirms destructive clearing", async () => {
    const source = await readFile(entrypoint, "utf8");
    expect(source).toContain("currentDelivery?.contribution.ready !== true");
    expect(source).toContain("Adding this job is unavailable");
    expect(source).toContain('approvedFields: selectedFields(), intent: "contribute"');
    expect(source).not.toContain('intent: "private_save"');
    expect(source).not.toContain("consent.checked");
    expect(source).toContain("window.confirm(");
  });
});
