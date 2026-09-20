// @vitest-environment jsdom

import type { EntitlementSummary } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundationForm } from "./foundation-form";

const captured = vi.hoisted(() => ({
  entitlement: undefined as
    | { onSummary?: (summary: EntitlementSummary | undefined) => void }
    | undefined,
  resume: undefined as { maxStoredResumes?: number } | undefined,
}));

vi.mock("./entitlement-status", () => ({
  EntitlementStatus: (props: { onSummary?: (summary: EntitlementSummary | undefined) => void }) => {
    captured.entitlement = props;
    return null;
  },
}));
vi.mock("./resume-upload-form", () => ({
  ResumeUploadForm: (props: { maxStoredResumes?: number }) => {
    captured.resume = props;
    return null;
  },
}));
vi.mock("./job-search-form", () => ({ JobSearchForm: () => null }));
vi.mock("./profile-facts-form", () => ({ ProfileFactsForm: () => null }));
vi.mock("./saved-jobs-panel", () => ({ SavedJobsPanel: () => null }));

const summary = (limits?: { maxStoredResumes: number }): EntitlementSummary => ({
  plan: "free",
  accessState: "active",
  grants: ["profile.manage", "jobs.search", "jobs.save", "applications.history"],
  version: 0,
  evaluatedAt: "2026-09-20T12:00:00.000Z",
  ...(limits ? { limits } : {}),
});

describe("FoundationForm resume limit wiring (ADR-032)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({}, { status: 503 })),
    );
    captured.entitlement = undefined;
    captured.resume = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () =>
      root.render(
        <FoundationForm
          authConfigured
          authConformanceEnabled={false}
          authenticationFailed={false}
          authenticated
          crossUserProbeArmed={false}
          workloadConformanceEnabled={false}
        />,
      ),
    );
    await act(async () => {});
  }

  it("passes the plan's stored-resume limit from the entitlement summary to the upload form", async () => {
    await mount();
    expect(captured.resume?.maxStoredResumes).toBeUndefined();
    await act(async () => captured.entitlement?.onSummary?.(summary({ maxStoredResumes: 1 })));
    expect(captured.resume?.maxStoredResumes).toBe(1);
    await act(async () => captured.entitlement?.onSummary?.(summary({ maxStoredResumes: 3 })));
    expect(captured.resume?.maxStoredResumes).toBe(3);
  });

  it("leaves the limit unknown, so the server decides, when the summary is unavailable or has none", async () => {
    await mount();
    await act(async () => captured.entitlement?.onSummary?.(summary({ maxStoredResumes: 1 })));
    await act(async () => captured.entitlement?.onSummary?.(undefined));
    expect(captured.resume?.maxStoredResumes).toBeUndefined();
    await act(async () => captured.entitlement?.onSummary?.(summary({ maxStoredResumes: 1 })));
    await act(async () => captured.entitlement?.onSummary?.(summary()));
    expect(captured.resume?.maxStoredResumes).toBeUndefined();
  });
});
