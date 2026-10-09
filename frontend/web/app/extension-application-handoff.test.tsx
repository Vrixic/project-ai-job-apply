// @vitest-environment jsdom
import type { Application } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExtensionApplicationHandoff } from "./extension-application-handoff";

let root: Root;
let container: HTMLDivElement;
const application = {
  id: "00000000-0000-7000-8000-000000000001",
  canonicalJobId: "00000000-0000-7000-8000-000000000002",
  status: "approved",
  currentAction: "ready_to_submit",
} as Application;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("defaults off and offers no handoff for a packet still requiring review", async () => {
  vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF", "disabled");
  await act(async () => root.render(<ExtensionApplicationHandoff application={application} />));
  expect(container.childElementCount).toBe(0);
  vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF", "enabled");
  await act(async () =>
    root.render(
      <ExtensionApplicationHandoff application={{ ...application, status: "review_required" }} />,
    ),
  );
  expect(container.childElementCount).toBe(0);
});
it("copies only opaque application/job identifiers and offers manual copying on clipboard refusal", async () => {
  vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF", "enabled");
  const copy = vi.fn(async () => {
    throw new Error("Clipboard refused");
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  await act(async () => root.render(<ExtensionApplicationHandoff application={application} />));
  const input = container.querySelector("input");
  const button = container.querySelector("button");
  if (!input || !button) throw new Error("Missing handoff controls");
  const url = new URL(input.value);
  expect(url.origin).toBe(window.location.origin);
  expect([...url.searchParams]).toEqual([
    ["application", application.id],
    ["job", application.canonicalJobId],
  ]);
  await act(async () => button.click());
  expect(copy).toHaveBeenCalledExactlyOnceWith(url.href);
  expect(container.textContent).toContain("copy it manually");
});
