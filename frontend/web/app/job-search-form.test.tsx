// @vitest-environment jsdom

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobSearchForm } from "./job-search-form";
import { SAVED_JOBS_CHANGED_EVENT } from "./saved-jobs-panel";

const firstJob = {
  id: "00000000-0000-7000-8000-000000000001",
  company: {
    id: "00000000-0000-7000-8000-000000000002",
    name: "Synthetic First Company",
  },
  title: "First-page Engineer",
  locations: ["Remote - US"],
  status: "active",
  firstObservedAt: "2026-08-10T12:00:00.000Z",
  lastVerifiedAt: "2026-08-12T12:00:00.000Z",
  expiresAt: "2026-09-12T12:00:00.000Z",
} as const;

const restartedJob = {
  ...firstJob,
  id: "00000000-0000-7000-8000-000000000003",
  company: { ...firstJob.company, id: "00000000-0000-7000-8000-000000000004" },
  title: "Restarted Catalog Engineer",
} as const;

function assessment(jobId: string): MatchAssessment {
  return {
    schemaVersion: 1,
    requestedJobId: jobId,
    canonicalJobId: jobId,
    preferenceSetId: "00000000-0000-7000-8000-000000000005",
    preferenceVersion: 2,
    preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
    catalogRevision: "9",
    assessedAt: "2026-08-16T12:00:00.000Z",
    gate: "review_required",
    evidence: [
      { constraint: "work_mode", state: "satisfied", reasonCode: "work_mode_selected" },
      {
        constraint: "employment_type",
        state: "unknown",
        reasonCode: "employment_type_unavailable",
      },
      {
        constraint: "target_role",
        state: "unknown",
        reasonCode: "target_role_not_established",
      },
      { constraint: "location", state: "unknown", reasonCode: "location_not_established" },
      {
        constraint: "compensation",
        state: "unknown",
        reasonCode: "compensation_semantics_unavailable",
      },
      {
        constraint: "authorization_sponsorship",
        state: "unknown",
        reasonCode: "authorization_sponsorship_unavailable",
      },
      {
        constraint: "seniority",
        state: "unknown",
        reasonCode: "seniority_semantics_unavailable",
      },
      {
        constraint: "blocked_company",
        state: "unknown",
        reasonCode: "blocked_company_preferences_unavailable",
      },
      {
        constraint: "qualifications",
        state: "unknown",
        reasonCode: "qualification_evidence_unavailable",
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("JobSearchForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps rapid initial search activation single-flight and cleans up its deadline", async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return pending.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/platform/jobs/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sort: "relevance", pageSize: 10 }),
      signal: expect.any(AbortSignal),
    });
    expect(observedSignal?.aborted).toBe(false);

    await act(async () => pending.resolve(jsonResponse({ items: [firstJob] })));

    expect(container.textContent).toContain(firstJob.title);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(observedSignal?.aborted).toBe(false);
  });

  it("keeps rapid continuation activation single-flight and safely restarts a changed catalog", async () => {
    const initial = deferredResponse();
    const restarted = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "about:blank",
            title: "Job catalog changed",
            status: 409,
            code: "job_search_catalog_changed",
            detail: "The job catalog changed; restart the search from the first page",
          },
          409,
        ),
      )
      .mockImplementationOnce(() => restarted.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(form).not.toBeNull();
    expect(submit?.disabled).toBe(false);

    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toBe("Searching…");

    await act(async () =>
      initial.resolve(jsonResponse({ items: [firstJob], nextCursor: "signed.body" })),
    );
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 job loaded.");
    expect(container.textContent).toContain(firstJob.title);

    const loadMore = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Load more jobs"),
    );
    await act(async () => {
      loadMore?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      loadMore?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Restarting this search",
    );
    expect(container.textContent).not.toContain(firstJob.title);
    expect(submit?.disabled).toBe(true);

    await act(async () => restarted.resolve(jsonResponse({ items: [restartedJob] })));
    expect(container.textContent).toContain(restartedJob.title);
    expect(container.textContent).not.toContain(firstJob.title);
    expect(container.textContent).toContain("Report a catalog issue");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("1 job loaded.");
    expect(submit?.disabled).toBe(false);
  });

  it("aborts a stalled component request and announces the timeout", async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return pending.promise;
      }),
    );

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(submit?.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(observedSignal?.aborted).toBe(true);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Job search timed out",
    );
    expect(submit?.disabled).toBe(false);
    await act(async () => pending.resolve(jsonResponse({ items: [firstJob] })));
    expect(container.textContent).not.toContain(firstJob.title);
  });

  it("renders a fixed failure without exposing upstream problem details", async () => {
    const privateCanary = "synthetic-private-upstream-detail-never-render";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            type: "urn:ai-job-apply:problem:job_search_unavailable",
            title: "Private upstream title",
            status: 503,
            code: "job_search_unavailable",
            detail: privateCanary,
          },
          503,
        ),
      ),
    );

    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Job search is temporarily unavailable.",
    );
    expect(container.textContent).not.toContain(privateCanary);
    expect(container.textContent).not.toContain("Private upstream title");
  });

  it("loads accepted match evidence only after an explicit click for the exact result card", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob, restartedJob] }))
      .mockResolvedValueOnce(jsonResponse(assessment(restartedJob.id)));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    const cards = Array.from(container.querySelectorAll("article"));
    expect(cards).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      firstJob.title,
      restartedJob.title,
    ]);
    expect(cards[0]?.textContent).not.toContain("No exact hard conflict");
    expect(cards[1]?.textContent).not.toContain("No exact hard conflict");

    const secondMatchButton = Array.from(cards[1]?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Check match evidence",
    );
    await act(async () =>
      secondMatchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/platform/jobs/${restartedJob.id}/match-assessment`,
    );
    expect(cards[0]?.textContent).not.toContain("No exact hard conflict");
    expect(cards[1]?.textContent).toContain("No exact hard conflict");
    expect(cards[1]?.textContent).toContain("stated work mode is one you selected");
    expect(cards.map((card) => card.querySelector("h3")?.textContent)).toEqual([
      firstJob.title,
      restartedJob.title,
    ]);
  });

  it("drops pending match evidence when a changed search or sign-out unmounts its result", async () => {
    const firstAssessment = deferredResponse();
    const signedOutAssessment = deferredResponse();
    let changedSearchSignal: AbortSignal | undefined;
    let signOutSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockImplementationOnce((_input, init) => {
        changedSearchSignal = init?.signal ?? undefined;
        return firstAssessment.promise;
      })
      .mockResolvedValueOnce(jsonResponse({ items: [restartedJob] }))
      .mockResolvedValueOnce(jsonResponse(assessment(restartedJob.id)))
      .mockImplementationOnce((_input, init) => {
        signOutSignal = init?.signal ?? undefined;
        return signedOutAssessment.promise;
      });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<JobSearchForm authenticated />));
    const form = container.querySelector("form");
    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const firstMatchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Check match evidence",
    );
    await act(async () =>
      firstMatchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.textContent).toContain("Checking match evidence");

    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(changedSearchSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(restartedJob.title);
    expect(container.textContent).not.toContain(firstJob.title);
    await act(async () => firstAssessment.resolve(jsonResponse(assessment(firstJob.id))));
    expect(container.textContent).not.toContain("No exact hard conflict");

    const restartedMatchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Check match evidence",
    );
    await act(async () =>
      restartedMatchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.textContent).toContain("No exact hard conflict");
    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Refresh match evidence",
    );
    await act(async () => refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    await act(async () => root.render(<JobSearchForm authenticated={false} />));
    expect(signOutSignal?.aborted).toBe(true);
    await act(async () => signedOutAssessment.resolve(jsonResponse(assessment(restartedJob.id))));
    expect(container.textContent).toContain("Sign in to search");
    expect(container.textContent).not.toContain("No exact hard conflict");
  });

  it("saves an active result with a dedicated idempotency key and drops stale completion on sign-out", async () => {
    const save = deferredResponse();
    const changed = vi.fn();
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockImplementationOnce(() => save.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );
    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/platform/saved-jobs");
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(/^saved-job-/);
    const signal = init?.signal;

    await act(async () => root.render(<JobSearchForm authenticated={false} />));
    expect(signal?.aborted).toBe(true);
    await act(async () => save.resolve(jsonResponse({ id: "saved" }, 201)));
    expect(container.textContent).not.toContain("Job saved to your private list");
    expect(container.textContent).toContain("Sign in to search");
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
  });

  it("does not let a stale definitive response clear a newer session save intent", async () => {
    let resolveStaleProblem!: (value: unknown) => void;
    const staleProblem = new Promise<unknown>((resolve) => {
      resolveStaleProblem = resolve;
    });
    let rejectNewSave!: (reason: unknown) => void;
    const newSave = new Promise<Response>((_resolve, reject) => {
      rejectNewSave = reject;
    });
    const changed = vi.fn();
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    const staleDefinitiveResponse = {
      ok: false,
      status: 409,
      json: () => staleProblem,
    } as unknown as Response;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockResolvedValueOnce(staleDefinitiveResponse)
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockImplementationOnce(() => newSave)
      .mockResolvedValueOnce(jsonResponse({ id: "saved" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const firstSessionSave = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );
    await act(async () =>
      firstSessionSave?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const [, firstSessionInit] = fetchMock.mock.calls[1] ?? [];

    await act(async () => root.render(<JobSearchForm authenticated={false} />));
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const newSessionSave = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );
    await act(async () =>
      newSessionSave?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const [, newSessionInit] = fetchMock.mock.calls[3] ?? [];
    const newSessionKey = new Headers(newSessionInit?.headers).get("idempotency-key");
    expect(newSessionKey).toMatch(/^saved-job-/);
    expect(newSessionKey).not.toBe(new Headers(firstSessionInit?.headers).get("idempotency-key"));

    await act(async () => resolveStaleProblem({ code: "idempotency_conflict" }));

    expect(container.textContent).not.toContain("Job search is temporarily unavailable.");
    expect(changed).not.toHaveBeenCalled();
    expect(newSessionSave?.disabled).toBe(true);

    await act(async () => rejectNewSave(new Error("new-session-private-transport-canary")));

    expect(container.textContent).toContain(
      "The job could not be saved. Retry to safely check the same saved job.",
    );
    expect(container.textContent).not.toContain("new-session-private-transport-canary");
    await act(async () =>
      newSessionSave?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const [, newSessionRetryInit] = fetchMock.mock.calls[4] ?? [];
    expect(new Headers(newSessionRetryInit?.headers).get("idempotency-key")).toBe(newSessionKey);
    expect(newSessionRetryInit?.body).toBe(newSessionInit?.body);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
  });

  it("keeps rapid save activation single-flight and reuses the exact intent after timeout", async () => {
    vi.useFakeTimers();
    let firstSaveSignal: AbortSignal | undefined;
    const changed = vi.fn();
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockImplementationOnce((_input, init) => {
        firstSaveSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          firstSaveSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("The request was aborted", "AbortError")),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce(jsonResponse({ id: "saved" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[1] ?? [];
    const firstKey = new Headers(firstInit?.headers).get("idempotency-key");
    expect(firstKey).toMatch(/^saved-job-/);
    expect(firstInit?.body).toBe(JSON.stringify({ jobId: firstJob.id }));

    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(firstSaveSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "Saving timed out. Retry to safely check the same saved job.",
    );
    expect(saveButton?.disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, retryInit] = fetchMock.mock.calls[2] ?? [];
    expect(new Headers(retryInit?.headers).get("idempotency-key")).toBe(firstKey);
    expect(retryInit?.body).toBe(firstInit?.body);
    expect(container.textContent).toContain("Job saved to your private list.");
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
  });

  it("reuses one save intent across network and server ambiguity without leaking failures", async () => {
    const changed = vi.fn();
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockRejectedValueOnce(new Error("private-transport-canary"))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            title: "private-title-canary",
            detail: "private-detail-canary",
            type: "private-type-canary",
            traceId: "private-trace-canary",
            code: "private-code-canary",
          },
          503,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "saved" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, firstInit] = fetchMock.mock.calls[1] ?? [];
    const firstKey = new Headers(firstInit?.headers).get("idempotency-key");
    expect(container.textContent).toContain(
      "The job could not be saved. Retry to safely check the same saved job.",
    );
    expect(container.textContent).not.toContain("private-transport-canary");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, serverRetryInit] = fetchMock.mock.calls[2] ?? [];
    expect(new Headers(serverRetryInit?.headers).get("idempotency-key")).toBe(firstKey);
    expect(serverRetryInit?.body).toBe(firstInit?.body);
    expect(container.textContent).not.toMatch(/private-(?:title|detail|type|trace|code)-canary/);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, finalRetryInit] = fetchMock.mock.calls[3] ?? [];
    expect(new Headers(finalRetryInit?.headers).get("idempotency-key")).toBe(firstKey);
    expect(finalRetryInit?.body).toBe(firstInit?.body);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
  });

  it("starts a fresh save intent after a definitive rejection", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            title: "private-title-canary",
            detail: "private-detail-canary",
            type: "private-type-canary",
            traceId: "private-trace-canary",
            code: "idempotency_conflict",
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "saved" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, rejectedInit] = fetchMock.mock.calls[1] ?? [];
    const rejectedKey = new Headers(rejectedInit?.headers).get("idempotency-key");
    expect(container.textContent).not.toMatch(/private-(?:title|detail|type|trace|code)-canary/);

    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [, retryInit] = fetchMock.mock.calls[2] ?? [];
    expect(new Headers(retryInit?.headers).get("idempotency-key")).not.toBe(rejectedKey);
    expect(retryInit?.body).toBe(rejectedInit?.body);
    expect(container.textContent).toContain("Job saved to your private list.");
  });

  it("aborts and clears a pending save on unmount without dispatching stale success", async () => {
    vi.useFakeTimers();
    const save = deferredResponse();
    const changed = vi.fn();
    window.addEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockImplementationOnce(() => save.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );
    const timersBeforeSave = vi.getTimerCount();
    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const saveSignal = fetchMock.mock.calls[1]?.[1]?.signal;

    expect(vi.getTimerCount()).toBe(timersBeforeSave + 1);
    await act(async () => root.unmount());

    expect(saveSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(timersBeforeSave);
    await act(async () => save.resolve(jsonResponse({ id: "saved" }, 201)));
    expect(container.textContent).toBe("");
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener(SAVED_JOBS_CHANGED_EVENT, changed);
    root = createRoot(container);
  });

  it("fails closed at render time for populated search fields, results, and save messages on sign-out", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [firstJob] }))
      .mockResolvedValueOnce(jsonResponse({ id: "saved" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobSearchForm authenticated />));
    const keywords = container.querySelector<HTMLInputElement>('input[type="search"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(keywords, "private candidate query");
      keywords?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save job"),
    );
    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain(firstJob.title);
    expect(container.textContent).toContain("Job saved to your private list");
    expect(keywords?.value).toBe("private candidate query");

    await act(async () => root.render(<JobSearchForm authenticated={false} />));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("private candidate query");
    expect(container.textContent).not.toContain(firstJob.title);
    expect(container.textContent).not.toContain("Job saved to your private list");
    expect(container.textContent).toContain("Sign in to search");
  });

  it("re-enables search after sign-out during a pending request and ignores its stale response", async () => {
    const pending = deferredResponse();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return pending.promise;
      }),
    );
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );

    await act(async () => root.render(<JobSearchForm authenticated={false} />));
    expect(observedSignal?.aborted).toBe(true);
    await act(async () => root.render(<JobSearchForm authenticated />));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
    await act(async () => pending.resolve(jsonResponse({ items: [firstJob] })));
    expect(container.textContent).not.toContain(firstJob.title);
  });

  it("aborts a pending search on unmount and drops an abort-ignoring completion", async () => {
    const pending = deferredResponse();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return pending.promise;
      }),
    );
    await act(async () => root.render(<JobSearchForm authenticated />));
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    await act(async () => root.unmount());
    expect(observedSignal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ items: [firstJob] })));
    expect(container.textContent).not.toContain(firstJob.title);
    root = createRoot(container);
  });
});
