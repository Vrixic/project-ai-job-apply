// @vitest-environment jsdom

import type { EntitlementSummary } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumePageClient } from "./resume-page-client";

vi.mock("../../resume-upload-form", () => ({
  ResumeUploadForm: (props: { maxStoredResumes?: number }) => {
    captured.maxStoredResumes = props.maxStoredResumes;
    return null;
  },
}));

const captured: { maxStoredResumes?: number | undefined } = {};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function summary(overrides: Partial<EntitlementSummary> = {}): EntitlementSummary {
  return {
    plan: "free",
    accessState: "active",
    version: 1,
    evaluatedAt: "2026-08-15T12:00:00.000Z",
    grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
    ...overrides,
  } as EntitlementSummary;
}

describe("ResumePageClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    captured.maxStoredResumes = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("passes the plan's stored-resume limit once the entitlement summary is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse(summary({ limits: { maxStoredResumes: 3 } }))),
    );

    await act(async () => root.render(<ResumePageClient authenticated />));

    expect(captured.maxStoredResumes).toBe(3);
  });

  it("leaves the limit unknown, so the server decides, when the summary has none or is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse(summary())),
    );
    await act(async () => root.render(<ResumePageClient authenticated />));
    expect(captured.maxStoredResumes).toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({ title: "err" }, 503)),
    );
    await act(async () => root.render(<ResumePageClient authenticated={false} />));
    await act(async () => root.render(<ResumePageClient authenticated />));
    expect(captured.maxStoredResumes).toBeUndefined();
  });
});
