import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import SignedOutPage from "./page";

afterEach(() => vi.unstubAllGlobals());
it("distinguishes accepted cleanup from completed disposal", async () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(
    await SignedOutPage({ searchParams: Promise.resolve({ cleanup: "requested" }) }),
  );
  expect(html).toContain("Cleanup may still be in progress");
  expect(html).toContain("does not delete files you downloaded");
  expect(html).not.toContain("deleted successfully");
});
it("shows uncertainty for missing or unexpected status without reflecting query values", async () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(
    await SignedOutPage({ searchParams: Promise.resolve({ cleanup: "secret-query-value" }) }),
  );
  expect(html).toContain("could not confirm cleanup");
  expect(html).not.toContain("secret-query-value");
});
