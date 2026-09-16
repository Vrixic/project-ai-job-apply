import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExtensionSupportPage, { metadata } from "./page.js";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("extension support page", () => {
  it("states the development boundary and end-user add flow", () => {
    const markup = renderToStaticMarkup(<ExtensionSupportPage />);
    expect(markup).toContain("Development access only");
    expect(markup).toContain("Inspect current tab");
    expect(markup).toContain("Add job to shared database once");
    expect(markup).toContain("Acknowledgement is not publication");
    expect(markup).toContain("Manage an accepted contribution");
    expect(markup).toContain("No monitored public support channel is active");
  });

  it("never solicits secrets or misstates the page as monitored support", () => {
    const markup = renderToStaticMarkup(<ExtensionSupportPage />);
    expect(markup).toContain("Do not send access tokens");
    expect(markup).not.toMatch(/mailto:|tel:|https?:\/\//u);
    expect(markup).not.toContain("Contact support");
    expect(markup).not.toMatch(/[—–]/u);
  });

  it("never directs end users to development diagnostics or invents a support channel", () => {
    const markup = renderToStaticMarkup(<ExtensionSupportPage />);
    for (const diagnostic of [
      "Your shared jobs",
      "Delivery queue",
      "Retry stopped",
      "Refresh processing",
      "Refresh Trust",
    ]) {
      expect(markup).not.toContain(diagnostic);
    }
    expect(markup).toContain("before public release");
    expect(markup).toContain("No public support channel is currently active");
    expect(markup).not.toContain("Recent contributions");
    expect(markup).not.toContain("Choose Refresh to");
  });

  it("has route-specific metadata", () => {
    expect(metadata.title).toContain("Extension help");
    expect(metadata.description).toContain("public job contribution controls");
  });
});
