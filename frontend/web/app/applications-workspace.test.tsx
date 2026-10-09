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
  vi.useRealTimers();
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

async function mount(
  fetchImplementation: typeof globalThis.fetch,
  applyUrl?: string,
  coverLetterPreparationEnabled = false,
) {
  await act(async () => {
    root.render(
      <ApplicationsWorkspace
        jobId={JOB}
        applyUrl={applyUrl}
        fetchImplementation={fetchImplementation}
        coverLetterPreparationEnabled={coverLetterPreparationEnabled}
      />,
    );
  });
}

describe("ApplicationsWorkspace", () => {
  it("does not request or expose cover-letter generation by default", async () => {
    const send = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/search")
        ? respond({ items: [] })
        : String(input).endsWith("/packets")
          ? respond(reviewable(), 201)
          : respond(application(), 201),
    );
    await mount(send);
    expect(container.textContent).not.toContain("Optional cover letter");
    await click("Prepare application");
    const packet = send.mock.calls.find(([url]) => String(url).endsWith("/packets"));
    expect(
      JSON.parse(String((packet as unknown as [string, RequestInit])[1].body)),
    ).not.toHaveProperty("coverLetter");
  });
  it("requires explicit disclosure, polls the accepted operation and blocks unavailable material approval", async () => {
    const ready = reviewable(4);
    const OP = "00000000-0000-7000-8000-000000000020";
    if (!ready.currentPacket) throw new Error("Missing packet");
    ready.currentPacket.artifactHashes.coverLetter = HASH;
    ready.currentPacket.temporaryMaterials = [
      {
        schemaVersion: 1,
        kind: "cover_letter",
        generationId: OP,
        version: 1,
        contentSha256: HASH,
        completedAtMs: Date.now(),
        expiresAtMs: Date.now() + 1_800_000,
      },
    ];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const send = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets"))
        return respond(
          { id: OP, applicationId: APP, state: "queued", createdAt: AT, updatedAt: AT },
          202,
        );
      if (url.includes("/preparations/"))
        return respond({
          id: OP,
          applicationId: APP,
          state: "succeeded",
          result: { packetId: ready.currentPacket?.id, revision: 4 },
          createdAt: AT,
          updatedAt: AT,
        });
      if (url === `/api/platform/applications/${APP}`) return respond(ready);
      if (url.endsWith("/resume")) return respond({ status: "no_resume", matchesPacket: false });
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    expect(container.textContent).toContain(
      "Provider abuse-monitoring logs may retain content for up to 30 days",
    );
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    const command = calls.find(({ url }) => url.endsWith("/packets"));
    expect(JSON.parse(String(command?.init.body))).toEqual({
      expectedRevision: 1,
      coverLetter: { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true } },
    });
    expect(calls.filter(({ url }) => url.endsWith("/packets"))).toHaveLength(1);
    expect(container.textContent).toContain("Preparation finished");
    expect(container.textContent).toContain("Its exact preview is unavailable");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(
      false,
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Approve this packet",
      )?.disabled,
    ).toBe(true);
  });
  it("replays a lost admission response with the original disclosure/body/key and requires a new choice after failure", async () => {
    const commands: RequestInit[] = [];
    const OP = "00000000-0000-7000-8000-000000000020";
    const send = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets")) {
        commands.push(init);
        return commands.length === 1
          ? respond({ code: "applications_unavailable" }, 503)
          : respond(
              {
                id: OP,
                applicationId: APP,
                state: "failed",
                errorCode: "generation_unavailable",
                createdAt: AT,
                updatedAt: AT,
              },
              202,
            );
      }
      if (url === `/api/platform/applications/${APP}`) return respond(reviewable());
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    await click("Prepare resume and cover letter");
    expect(commands).toHaveLength(2);
    expect(commands[0]?.body).toBe(commands[1]?.body);
    expect(commands[0]?.headers).toEqual(commands[1]?.headers);
    expect(container.textContent).toContain("Cover-letter generation is unavailable");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(
      false,
    );
  });
  it("bounds status reads and checks the same operation without redispatching generation", async () => {
    vi.useFakeTimers();
    const OP = "00000000-0000-7000-8000-000000000020";
    const operation = { id: OP, applicationId: APP, state: "queued", createdAt: AT, updatedAt: AT };
    const calls: string[] = [];
    const send = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets")) return respond(operation, 202);
      if (url.includes("/preparations/")) return respond(operation);
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    expect(container.textContent).not.toContain("Approve this packet");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_001);
    });
    expect(calls.filter((url) => url.includes("/preparations/"))).toHaveLength(120);
    await click("Check preparation status");
    expect(calls.filter((url) => url.includes("/preparations/"))).toHaveLength(121);
    expect(calls.filter((url) => url.endsWith("/packets"))).toHaveLength(1);
  });
  it("cancels pending preparation at the latest revision and stops polling", async () => {
    vi.useFakeTimers();
    const OP = "00000000-0000-7000-8000-000000000020";
    const operation = {
      id: OP,
      applicationId: APP,
      state: "running",
      createdAt: AT,
      updatedAt: AT,
    };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const send = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets")) return respond(operation, 202);
      if (url.includes("/preparations/")) return respond(operation);
      if (url.endsWith("/cancel"))
        return respond(application({ status: "cancelled", revision: 3, currentAction: "none" }));
      if (url === `/api/platform/applications/${APP}`) return respond(reviewable(2));
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    await click("Cancel application");
    expect(container.textContent).toContain("This application was cancelled");
    const cancel = calls.find(({ url }) => url.endsWith("/cancel"));
    expect(JSON.parse(String(cancel?.init.body))).toEqual({ expectedRevision: 2 });
    const count = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toHaveLength(count);
  });
  it("refuses a succeeded operation whose exact packet does not match the current application", async () => {
    const OP = "00000000-0000-7000-8000-000000000020";
    const send = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets"))
        return respond(
          {
            id: OP,
            applicationId: APP,
            state: "succeeded",
            result: { packetId: OP, revision: 2 },
            createdAt: AT,
            updatedAt: AT,
          },
          202,
        );
      if (url === `/api/platform/applications/${APP}`) return respond(reviewable(2));
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    expect(container.textContent).toContain("prepared packet could not be verified");
    expect(container.textContent).not.toContain("Approve this packet");
  });
  it("does not restore a completed packet from a late status read after cancellation", async () => {
    const OP = "00000000-0000-7000-8000-000000000020";
    const ready = reviewable(3);
    let finish: ((response: Response) => void) | undefined;
    let reads = 0;
    let heldSignal: AbortSignal | undefined;
    const send = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url.endsWith("/packets"))
        return respond(
          {
            id: OP,
            applicationId: APP,
            state: "succeeded",
            result: { packetId: ready.currentPacket?.id, revision: 3 },
            createdAt: AT,
            updatedAt: AT,
          },
          202,
        );
      if (url.endsWith("/cancel"))
        return respond(application({ status: "cancelled", revision: 4, currentAction: "none" }));
      if (url === `/api/platform/applications/${APP}`) {
        reads += 1;
        if (reads === 1) {
          heldSignal = init.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        return respond(ready);
      }
      return respond(application(), 201);
    });
    await mount(send, undefined, true);
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await click("Prepare resume and cover letter");
    await click("Cancel application");
    expect(heldSignal?.aborted).toBe(true);
    await act(async () => {
      finish?.(respond(ready));
    });
    expect(container.textContent).toContain("This application was cancelled");
    expect(container.textContent).not.toContain("Approve this packet");
  });
  it("keeps retries stable and gives changed answers a different preparation key", async () => {
    const value = reviewable();
    if (!value.currentPacket) throw new Error("Missing fixture packet");
    value.currentPacket.fields = [
      { ...value.currentPacket.fields[0], origin: "user_entered" },
    ] as typeof value.currentPacket.fields;
    const calls: RequestInit[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith("/search")) return respond({ items: [value] });
      if (String(input).endsWith("/packets")) {
        calls.push(init);
        return respond({ code: "applications_unavailable" }, 503);
      }
      return respond({}, 404);
    }) as typeof fetch;
    await mount(fetchImplementation);
    for (const answer of ["first@example.test", "first@example.test", "second@example.test"]) {
      await act(async () => {
        const input = container.querySelector('input:not([type="checkbox"])');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, answer);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Save answer");
    }
    expect(calls).toHaveLength(3);
    expect(calls[0]?.headers).toEqual(calls[1]?.headers);
    expect(calls[1]?.headers).not.toEqual(calls[2]?.headers);
    expect(JSON.stringify(calls.map((call) => call.headers))).not.toContain("example.test");
  });
  it("retries an uncertain candidate confirmation with its original payload and key", async () => {
    const takeover = application({
      status: "takeover",
      revision: 4,
      currentAction: "complete_manually",
      attempts: [
        {
          id: APP,
          sequence: 1,
          status: "taken_over",
          adapterId: "manual",
          adapterVersion: "none",
          startedAt: AT,
        },
      ],
    });
    const calls: RequestInit[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (String(input).endsWith("/search")) return respond({ items: [takeover] });
      calls.push(init);
      if (calls.length === 1) throw new Error("Lost response");
      return respond({ ...takeover, revision: 5, status: "applied", currentAction: "none" });
    }) as typeof fetch;
    await mount(fetchImplementation);
    await click("I submitted it");
    await vi.waitFor(() => expect(container.textContent).toContain("That did not go through"));
    await click("I submitted it");
    await vi.waitFor(() => expect(container.textContent).toContain("Submitted and confirmed"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toBe(calls[0]?.body);
    expect(calls[1]?.headers).toEqual(calls[0]?.headers);
  });

  it("discards the previous job workspace when the selected job changes", async () => {
    const fetchImplementation = vi.fn(async () =>
      respond({ items: [reviewable()] }),
    ) as typeof fetch;
    await mount(fetchImplementation);
    expect(container.textContent).toContain("Application review");
    const otherJob = "00000000-0000-7000-8000-000000000099";
    const emptyFetch = vi.fn(async () => respond({ items: [] })) as typeof fetch;
    await act(async () =>
      root.render(<ApplicationsWorkspace jobId={otherJob} fetchImplementation={emptyFetch} />),
    );
    expect(container.textContent).not.toContain("Application review");
    expect(container.textContent).toContain("Prepare application");
  });
  it("creates then prepares an application and shows the review panel", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/search")) return respond({ items: [] });
      return url.endsWith("/packets") ? respond(reviewable(), 201) : respond(application(), 201);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    expect(container.textContent).toContain("nothing is submitted from this page");
    await click("Prepare application");

    // Opening looks for an existing application first, then the resume preview is a read-only
    // GET that follows the packet; commands are unchanged.
    expect(calls.map(([url]) => url).filter((url) => !url.endsWith("/resume"))).toEqual([
      "/api/platform/applications/search",
      "/api/platform/applications",
      `/api/platform/applications/${APP}/packets`,
    ]);
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ jobId: JOB, limit: 1 });
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ jobId: JOB });
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ expectedRevision: 1 });
    for (const [, init] of calls.filter(
      ([url, request]) => request.method === "POST" && !url.endsWith("/search"),
    )) {
      expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(/^web-/);
    }
    expect(container.textContent).toContain("Application review");
    expect(container.textContent).toContain("Review what will be sent");
    // The candidate sees the resume prepared for this job next to the packet.
    expect(container.textContent).toContain("Your resume for this job");
    expect(calls.map(([url]) => url)).toContain(`/api/platform/applications/${APP}/resume`);
  });

  const buttons = () => Array.from(container.querySelectorAll("button")).map((b) => b.textContent);

  it("opens the candidate's existing live application for the job instead of starting another", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith("/search") ? respond({ items: [reviewable()] }) : respond({}, 404);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);

    expect(container.textContent).toContain("Application review");
    expect(container.textContent).toContain("Review what will be sent");
    expect(container.textContent).toContain("Your resume for this job");
    expect(container.textContent).not.toContain("Checking for an existing application");
    expect(buttons()).not.toContain("Prepare application");
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ jobId: JOB, limit: 1 });
    // Nothing was created or prepared just by opening the page.
    expect(
      calls.filter(([url, init]) => init.method === "POST" && !url.endsWith("/search")),
    ).toEqual([]);
  });

  it("offers to prepare when the newest application was cancelled or none exists", async () => {
    for (const items of [[application({ status: "cancelled", revision: 4 })], []]) {
      const fetchImplementation = vi.fn(async (url: string) =>
        url.endsWith("/search") ? respond({ items }) : respond({}, 404),
      ) as unknown as typeof globalThis.fetch;
      await mount(fetchImplementation);
      expect(container.textContent).toContain("nothing is submitted from this page");
      expect(buttons()).toContain("Prepare application");
      await act(async () => root.render(<div />));
    }
  });

  it("shows the prepare step when the lookup fails or returns anything unexpected", async () => {
    const otherJob = "00000000-0000-7000-8000-0000000000ff";
    for (const reply of [
      () => respond({}, 503),
      () => respond({ items: [application({ canonicalJobId: otherJob })] }),
      () => respond({ items: "nope" }),
    ]) {
      const fetchImplementation = vi.fn(async (url: string) =>
        url.endsWith("/search") ? reply() : respond({}, 404),
      ) as unknown as typeof globalThis.fetch;
      await mount(fetchImplementation);
      expect(container.textContent).not.toContain("Application review");
      expect(buttons()).toContain("Prepare application");
      await act(async () => root.render(<div />));
    }
  });

  it("opens the live application when creating one reports that it already exists", async () => {
    let searches = 0;
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/search")) {
        searches += 1;
        // Nothing at first (page load); the application exists by the time the candidate clicks.
        return respond({ items: searches === 1 ? [] : [reviewable()] });
      }
      if (url === "/api/platform/applications" && init.method === "POST") {
        return respond({ code: "application_already_exists" }, 409);
      }
      return respond({}, 404);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    expect(container.textContent).toContain("Application review");
    expect(container.textContent).toContain(
      "You already have an application for this job. It is open below.",
    );
    expect(container.textContent).not.toContain("live application for this job");
  });

  it("keeps the fixed already-exists copy when that application cannot be found", async () => {
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/search")) return respond({ items: [] });
      if (url === "/api/platform/applications" && init.method === "POST") {
        return respond({ code: "application_already_exists" }, 409);
      }
      return respond({}, 404);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    expect(container.textContent).toContain("You already have a live application for this job.");
  });

  it("continues preparing an existing application that has no packet yet, without creating another", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/search")) return respond({ items: [application()] });
      return url.endsWith("/packets") ? respond(reviewable(), 201) : respond({}, 404);
    }) as unknown as typeof globalThis.fetch;
    await mount(fetchImplementation);
    await click("Prepare application");
    const posts = calls.filter(([url, init]) => init.method === "POST" && !url.endsWith("/search"));
    expect(posts.map(([url]) => url)).toEqual([`/api/platform/applications/${APP}/packets`]);
    expect(JSON.parse(String(posts[0]?.[1].body))).toEqual({ expectedRevision: 1 });
    expect(container.textContent).toContain("Review what will be sent");
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
    // Opening the manual handoff does not itself create an attempt.
    expect(calls.map(([url]) => url).filter((url) => /submissions|attempts/.test(url))).toEqual([]);
  });

  it("records a manual attempt, then uses the existing candidate attestation path", async () => {
    const attemptId = "00000000-0000-7000-8000-000000000020";
    const ready = {
      ...reviewable(3),
      status: "approved",
      currentAction: "ready_to_submit",
      approval: {
        packetHash: HASH,
        approvedAt: AT,
        expiresAt: "2026-09-19T12:00:00.000Z",
        acknowledgedFieldKeys: ["contact.email"],
      },
    } as unknown as Application;
    const takenOver = {
      ...ready,
      status: "takeover",
      revision: 4,
      currentAction: "complete_manually",
      attempts: [
        {
          id: attemptId,
          sequence: 1,
          status: "taken_over",
          adapterId: "manual",
          adapterVersion: "none",
          startedAt: AT,
          resolvedAt: AT,
        },
      ],
    } as unknown as Application;
    const applied = {
      ...takenOver,
      status: "applied",
      revision: 5,
      currentAction: "none",
      attempts: [{ ...takenOver.attempts[0], status: "confirmed" }],
    } as unknown as Application;
    const calls: Array<[string, RequestInit]> = [];
    const fetchImplementation = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/search")) return respond({ items: [ready] });
      if (url.endsWith("/manual-submissions")) {
        return respond({ outcome: "started", attemptId, application: takenOver });
      }
      if (url.endsWith("/reconciliation")) return respond(applied);
      return respond({}, 404);
    }) as unknown as typeof globalThis.fetch;

    await mount(fetchImplementation, "https://boards.example.test/jobs/1");
    await click("Record submission status");

    const start = calls.find(([url]) => url.endsWith("/manual-submissions"));
    expect(start).toBeDefined();
    if (!start) throw new Error("Manual submission start was not called");
    expect(JSON.parse(String(start[1].body))).toEqual({ expectedRevision: 3 });
    expect((start[1].headers as Record<string, string>)["idempotency-key"]).toBe(
      `web-manual-submission-3-${APP}`,
    );
    expect(container.querySelector('[aria-label="Confirm the submission status"]')).not.toBeNull();
    expect(container.textContent).toContain("I submitted it");

    await click("I submitted it");
    await vi.waitFor(() => {
      expect(calls.some(([url]) => url.endsWith("/reconciliation"))).toBe(true);
    });
    const reconciliation = calls.find(([url]) => url.endsWith("/reconciliation"));
    expect(reconciliation?.[0]).toBe(
      `/api/platform/applications/${APP}/attempts/${attemptId}/reconciliation`,
    );
    expect(JSON.parse(String(reconciliation?.[1].body))).toMatchObject({
      kind: "user_attested_submitted",
    });
    expect(container.textContent).toContain("Submitted and confirmed.");
    expect(container.textContent).not.toContain("Record submission status");
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
