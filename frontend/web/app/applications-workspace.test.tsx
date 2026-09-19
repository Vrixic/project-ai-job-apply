// @vitest-environment jsdom

import type { Application } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationsWorkspace } from "./applications-workspace";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const HASH = "a".repeat(64);
const AT = "2026-09-18T12:00:00.000Z";

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: APP,
    canonicalJobId: JOB,
    status: "preparing",
    revision: 1,
    currentAction: "prepare_packet",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Application;
}

function reviewable(revision = 2): Application {
  return application({
    status: "review_required",
    revision,
    currentAction: "review_and_approve",
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: HASH,
      jobRevision: HASH,
      artifactHashes: { resume: HASH },
      fields: [
        {
          fieldKey: "contact.email",
          value: "candidate@example.test",
          origin: "confirmed_fact",
          sourceFactIds: ["00000000-0000-7000-8000-000000000010"],
          confidence: 0.99,
          disposition: "review",
          reasons: ["explicit_each_time"],
          requiresReview: true,
        },
      ],
      createdAt: AT,
    },
  } as unknown as Application);
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });

let container: HTMLDivElement;
let root: Root;

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
});

async function click(label: RegExp | string) {
  const button = Array.from(container.querySelectorAll("button")).find((element) =>
    typeof label === "string"
      ? element.textContent === label
      : label.test(element.textContent ?? ""),
  );
  if (!button) throw new Error(`No button ${String(label)}`);
  await act(async () => {
    button.click();
  });
}

async function mount(fetchImplementation: typeof globalThis.fetch, applyUrl?: string) {
  await act(async () => {
    root.render(
      <ApplicationsWorkspace
        jobId={JOB}
        applyUrl={applyUrl}
        fetchImplementation={fetchImplementation}
      />,
    );
  });
}

describe("ApplicationsWorkspace", () => {
  it("creates then prepares an application and shows the review panel", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith("/packets") ? respond(reviewable(), 201) : respond(application(), 201);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    expect(container.textContent).toContain("nothing is submitted from this page");
    await click("Prepare application");

    // The resume preview is a read-only GET that follows the packet; commands are unchanged.
    expect(calls.map(([url]) => url).filter((url) => !url.endsWith("/resume"))).toEqual([
      "/api/platform/applications",
      `/api/platform/applications/${APP}/packets`,
    ]);
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ jobId: JOB });
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ expectedRevision: 1 });
    for (const [, init] of calls.filter(([, request]) => request.method === "POST")) {
      expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(/^web-/);
    }
    expect(container.textContent).toContain("Application review");
    expect(container.textContent).toContain("Review what will be sent");
    // The candidate sees the resume prepared for this job next to the packet.
    expect(container.textContent).toContain("Your resume for this job");
    expect(calls.map(([url]) => url)).toContain(`/api/platform/applications/${APP}/resume`);
  });

  it("approves exactly the reviewed packet hash and acknowledged keys at the current revision", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/approval")) {
        return respond(application({ status: "approved", revision: 3 }));
      }
      return url.endsWith("/packets") ? respond(reviewable(), 201) : respond(application(), 201);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    const acknowledge = Array.from(container.querySelectorAll("input[type=checkbox]"))[0];
    await act(async () => {
      (acknowledge as HTMLInputElement).click();
    });
    await click(/approve/i);

    const approval = calls.find(([url]) => url.endsWith("/approval"));
    expect(approval).toBeDefined();
    expect(JSON.parse(String(approval?.[1].body))).toEqual({
      expectedRevision: 2,
      packetHash: HASH,
      acknowledgedFieldKeys: ["contact.email"],
    });
    const approvalHeaders = (approval?.[1].headers ?? {}) as Record<string, string>;
    expect(approvalHeaders["idempotency-key"]).toBe(`web-approve-2-${APP}`);
    expect(container.textContent).toContain("Approved");
  });

  it("offers the Apply step only after approval, without submitting anything", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const readyToApply = {
      ...reviewable(3),
      status: "approved",
      currentAction: "ready_to_submit",
    } as unknown as Application;
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/approval")) return respond(readyToApply);
      return url.endsWith("/packets") ? respond(reviewable(), 201) : respond(application(), 201);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation, "https://boards.example.test/jobs/1");
    await click("Prepare application");
    // Not yet approved: no Apply step.
    expect(container.textContent).not.toContain("Open the application page");
    const acknowledge = Array.from(container.querySelectorAll("input[type=checkbox]"))[0];
    await act(async () => {
      (acknowledge as HTMLInputElement).click();
    });
    await click(/approve/i);
    expect(container.textContent).toContain("Open the application page");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://boards.example.test/jobs/1",
    );
    // No submission, dispatch, or attempt call is ever made from the web page.
    expect(calls.map(([url]) => url).filter((url) => /submissions|attempts/.test(url))).toEqual([]);
  });

  it("shows fixed copy for a refusal and never upstream text", async () => {
    const fetchImplementation = vi.fn(async () =>
      respond(
        {
          type: "urn:ai-job-apply:problem:forbidden",
          title: "SECRET upstream title",
          status: 403,
          code: "forbidden",
          detail: "candidate@example.test leaked",
        },
        403,
      ),
    ) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    expect(container.textContent).toContain("Applications are not enabled for your account yet.");
    expect(container.textContent).not.toContain("SECRET");
    expect(container.textContent).not.toContain("candidate@example.test");
    // The candidate can try again; nothing was created.
    expect(container.textContent).toContain("Prepare application");
  });

  it("reloads the latest application after a revision conflict", async () => {
    const calls: string[] = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith("/cancel")) {
        return respond(
          {
            type: "urn:ai-job-apply:problem:application_revision_conflict",
            title: "Application changed",
            status: 409,
            code: "application_revision_conflict",
          },
          409,
        );
      }
      if (init.method === "GET") return respond(reviewable(5));
      return url.endsWith("/packets") ? respond(reviewable(2), 201) : respond(application(), 201);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    await click(/cancel/i);
    expect(calls).toContain(`GET /api/platform/applications/${APP}`);
    expect(container.textContent).toContain("This application changed");
  });

  it("has no detectable accessibility violations before and after preparing", async () => {
    const fetchImplementation = vi.fn(async (url: string) =>
      url.endsWith("/packets") ? respond(reviewable(), 201) : respond(application(), 201),
    ) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    expect((await axe.run(container)).violations).toEqual([]);
    await click("Prepare application");
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
