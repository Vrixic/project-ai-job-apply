import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ExtensionSupportPage, { metadata } from "./page.js";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("extension support page", () => {
  it("states the development boundary and actionable queue meanings", () => {
    const markup = renderToStaticMarkup(<ExtensionSupportPage />);
    expect(markup).toContain("Development access only");
    expect(markup).toContain("Pending");
    expect(markup).toContain("Stopped");
    expect(markup).toContain("Held for another account");
    expect(markup).toContain("Retry stopped");
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

  it("names the installed contribution controls and requires explicit owner actions", () => {
    const markup = renderToStaticMarkup(<ExtensionSupportPage />);
    expect(markup).toContain("Open Your shared jobs in the extension.");
    expect(markup).toContain("Choose Refresh processing to load the current processing state");
    expect(markup).toContain("Refresh Trust to load the current Trust state.");
    expect(markup).toContain("choose Withdraw when available and confirm removal");
    expect(markup).toContain("from Trust eligibility.");
    expect(markup).toContain("choose Appeal when available, enter supporting evidence");
    expect(markup).toContain("Confirm &amp; submit appeal and confirm the submission prompt.");
    expect(markup).not.toContain("Recent contributions");
    expect(markup).not.toContain("Choose Refresh to");
  });

  it("has route-specific metadata", () => {
    expect(metadata.title).toContain("Extension help");
    expect(metadata.description).toContain("public job contribution controls");
  });
});
