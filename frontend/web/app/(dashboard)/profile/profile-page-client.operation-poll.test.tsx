// @vitest-environment jsdom

import type {
  JobPreferenceSet,
  Operation,
  PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePageClient } from "./profile-page-client";

// These tests cover the preference lifecycle, so the section tabs are replaced by the
// preferences panel they would host.
vi.mock("../../profile-sections/profile-area", () => ({
  ProfileArea: ({ preferences }: { preferences: React.ReactNode }) => <>{preferences}</>,
}));

const operationId = "019c0000-0000-7000-8000-000000000301";
const privateProblemCanary = "synthetic-private-operation-problem-never-render";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function responseWithDeferredJson(body: Promise<unknown>): Response {
  const response = jsonResponse(null);
  vi.spyOn(response, "json").mockImplementation(async () => body);
  return response;
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

function renderFoundation(authenticated = true) {
  return <ProfilePageClient authenticated={authenticated} />;
}

function preferenceSet(): JobPreferenceSet {
  return {
    id: "019c0000-0000-7000-8000-000000000302",
    version: 1,
    updatedAt: "2026-08-17T21:00:00.000Z",
    targetRoles: ["Platform Engineer"],
    locations: [],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
  };
}

function saveResponse(id = operationId): Response {
  const body: PutJobPreferencesResponse = {
    preferences: preferenceSet(),
    operationId: id,
  };
  return jsonResponse(body);
}

function operation(state: Operation["state"], id = operationId): Operation {
  return {
    id,
    kind: "profile_readiness",
    state,
    ...(state === "succeeded"
      ? {
          result: {
            completionPercent: 100,
            missingFields: [],
            calculatedAt: "2026-08-17T21:00:01.000Z",
          },
        }
      : {}),
    createdAt: "2026-08-17T21:00:00.000Z",
    updatedAt: "2026-08-17T21:00:01.000Z",
  };
}

function preferenceForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Job preferences"]');
  if (!form) throw new Error("The preference form must be rendered");
  return form;
}

async function savePreferences(container: HTMLElement): Promise<void> {
  await act(async () => {
    preferenceForm(container).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("saved-preference operation poll lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("bounds one active attempt, retries on the existing cadence, and ignores its late response", async () => {
    const firstPollBody = deferred<unknown>();
    const secondPoll = deferred<Response>();
    const pollSignals: AbortSignal[] = [];
    let pollCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(preferenceSet());
      }
      if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
        return saveResponse();
      }
      if (path === `/api/platform/operations/${operationId}`) {
        pollSignals.push(init?.signal as AbortSignal);
        pollCount += 1;
        return pollCount === 1
          ? responseWithDeferredJson(firstPollBody.promise)
          : secondPoll.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await savePreferences(container);
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );

    await act(async () => vi.advanceTimersByTimeAsync(1_499));
    expect(pollCount).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(pollCount).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(pollCount).toBe(1);
    expect(pollSignals[0]?.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(pollSignals[0]?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "The saved check timed out. Checking will continue automatically.",
    );

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(pollCount).toBe(2);
    expect(pollSignals[1]?.aborted).toBe(false);
    await act(async () => secondPoll.resolve(jsonResponse(operation("succeeded"))));

    expect(container.textContent).toContain("Saved-preference check: succeeded");
    expect(container.textContent).not.toContain("The saved check timed out");
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );

    await act(async () => firstPollBody.resolve(operation("failed")));
    expect(container.textContent).toContain("Saved-preference check: succeeded");
    expect(container.textContent).not.toContain("Saved-preference check: failed");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(pollCount).toBe(2);
  });

  it("keeps fixed poll failure copy separate and clears it after a current successful retry", async () => {
    let pollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferenceSet());
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return saveResponse();
        }
        if (path === `/api/platform/operations/${operationId}`) {
          pollCount += 1;
          return pollCount === 1
            ? jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              )
            : jsonResponse(operation("succeeded"));
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(renderFoundation()));
    await savePreferences(container);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(container.textContent).toContain("The saved check is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );

    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(container.textContent).toContain("Saved-preference check: succeeded");
    expect(container.textContent).not.toContain("The saved check is temporarily unavailable.");
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
  });

  it("aborts the exact active attempt and fences its completion after sign-out", async () => {
    const pendingPoll = deferred<Response>();
    let pollSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferenceSet());
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          return saveResponse();
        }
        if (path === `/api/platform/operations/${operationId}`) {
          pollSignal = init?.signal ?? undefined;
          return pendingPoll.promise;
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(renderFoundation()));
    await savePreferences(container);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(pollSignal?.aborted).toBe(false);

    await act(async () => root.render(renderFoundation(false)));
    expect(pollSignal?.aborted).toBe(true);
    await act(async () => pendingPoll.resolve(jsonResponse(operation("succeeded"))));
    expect(container.textContent).not.toContain("Saved-preference check: succeeded");
    expect(container.textContent).not.toContain("The saved check timed out");
  });

  it("aborts a replaced operation and lets only the replacement reach terminal state", async () => {
    const replacementId = "019c0000-0000-7000-8000-000000000303";
    const firstPoll = deferred<Response>();
    let saveCount = 0;
    let firstPollSignal: AbortSignal | undefined;
    let replacementPollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/job-preferences" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(preferenceSet());
        }
        if (path === "/api/platform/job-preferences" && init?.method === "PUT") {
          saveCount += 1;
          return saveResponse(saveCount === 1 ? operationId : replacementId);
        }
        if (path === `/api/platform/operations/${operationId}`) {
          firstPollSignal = init?.signal ?? undefined;
          return firstPoll.promise;
        }
        if (path === `/api/platform/operations/${replacementId}`) {
          replacementPollCount += 1;
          return jsonResponse(operation("succeeded", replacementId));
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(renderFoundation()));
    await savePreferences(container);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(firstPollSignal?.aborted).toBe(false);

    await savePreferences(container);
    expect(firstPollSignal?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(replacementPollCount).toBe(1);
    expect(container.textContent).toContain("Saved-preference check: succeeded");

    await act(async () => firstPoll.resolve(jsonResponse(operation("failed"))));
    expect(container.textContent).toContain("Saved-preference check: succeeded");
    expect(container.textContent).not.toContain("Saved-preference check: failed");
  });
});
