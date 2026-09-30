// @vitest-environment jsdom

import type { JobPreferenceSet } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePageClient } from "./profile-page-client";

vi.mock("../../profile-facts-form", () => ({ ProfileFactsForm: () => null }));

const privateCanary = "private-preference-problem-must-not-render";

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

function preferenceSet(role: string): JobPreferenceSet {
  return {
    id: "019c0000-0000-7000-8000-000000000401",
    version: 3,
    updatedAt: "2026-08-17T22:00:00.000Z",
    targetRoles: [role],
    locations: ["Remote"],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
  };
}

function renderFoundation(authenticated = true) {
  return <ProfilePageClient authenticated={authenticated} />;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === name,
  );
  if (!result) throw new Error(`Expected button: ${name}`);
  return result;
}

function targetRole(container: HTMLElement): HTMLTextAreaElement {
  const result = container.querySelector<HTMLTextAreaElement>("textarea");
  if (!result) throw new Error("Expected target-role input");
  return result;
}

describe("saved-preference load lifecycle", () => {
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

  it("fails closed at the whole-response deadline and manually retries once with a fresh request", async () => {
    const firstBody = deferred<unknown>();
    const signals: AbortSignal[] = [];
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      reads += 1;
      signals.push(init?.signal as AbortSignal);
      return reads === 1
        ? responseWithDeferredJson(firstBody.promise)
        : jsonResponse(preferenceSet("Reliability Engineer"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/platform/job-preferences");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(targetRole(container).matches(":disabled")).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(signals[0]?.aborted).toBe(false);
    expect(container.textContent).not.toContain("Retry loading preferences");
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signals[0]?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Loading saved preferences timed out. Retry to check your current preferences.",
    );
    expect(button(container, "Save preferences").disabled).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retry = button(container, "Retry loading preferences");
    await act(async () => {
      retry.click();
      retry.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(targetRole(container).value).toBe("Reliability Engineer");
    expect(targetRole(container).matches(":disabled")).toBe(false);
    expect(button(container, "Save preferences").disabled).toBe(false);
  });

  it("redacts a failed load and unlocks first-use defaults only after an explicit 404 retry", async () => {
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      reads += 1;
      return reads === 1
        ? jsonResponse(
            {
              type: "https://private.example/problems/upstream",
              title: privateCanary,
              detail: privateCanary,
              traceId: privateCanary,
            },
            503,
          )
        : new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
    expect(button(container, "Save preferences").disabled).toBe(true);

    await act(async () => {
      const retry = button(container, "Retry loading preferences");
      retry.click();
      retry.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(button(container, "Save preferences").disabled).toBe(false);
    expect(container.textContent).not.toContain("temporarily unavailable");
  });

  it.each([
    ["transport rejection", () => Promise.reject(new Error(privateCanary))],
    [
      "unknown private success field",
      () =>
        Promise.resolve(
          jsonResponse({
            ...preferenceSet(privateCanary),
            privateProviderContext: privateCanary,
          }),
        ),
    ],
    [
      "invalid success metadata",
      () =>
        Promise.resolve(
          jsonResponse({
            ...preferenceSet(privateCanary),
            id: "not-a-job-preference-id",
            version: 0,
          }),
        ),
    ],
  ])("keeps controls closed with fixed copy after %s", async (_case, response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(response));

    await act(async () => root.render(renderFoundation()));
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
    expect(button(container, "Save preferences").disabled).toBe(true);
    expect(container.textContent).toContain("Retry loading preferences");
  });

  it("accepts only the bounded boolean legacy extension and preserves its save refusal", async () => {
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        if (init?.method === "PUT") {
          writes += 1;
          throw new Error("A legacy preference must not be written");
        }
        return jsonResponse({
          ...preferenceSet("Legacy Platform Engineer"),
          requiresSponsorship: false,
        });
      }),
    );

    await act(async () => root.render(renderFoundation()));
    expect(targetRole(container).value).toBe("Legacy Platform Engineer");
    expect(container.textContent).toContain("legacy sponsorship answer");

    const form = container.querySelector<HTMLFormElement>('form[aria-label="Job preferences"]');
    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(writes).toBe(0);
    expect(container.textContent).toContain(
      "Saving is unavailable until that answer moves to the restricted-data boundary.",
    );
  });

  it("aborts on sign-out and ignores a late prior-session body after the next session hydrates", async () => {
    const sessionABody = deferred<unknown>();
    const signals: AbortSignal[] = [];
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      reads += 1;
      signals.push(init?.signal as AbortSignal);
      return reads === 1
        ? responseWithDeferredJson(sessionABody.promise)
        : jsonResponse(preferenceSet("Session B Engineer"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await act(async () => root.render(renderFoundation(false)));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => root.render(renderFoundation()));
    expect(targetRole(container).value).toBe("Session B Engineer");

    await act(async () => sessionABody.resolve(preferenceSet("Stale Session A Engineer")));
    expect(targetRole(container).value).toBe("Session B Engineer");
    expect(container.textContent).not.toContain("Stale Session A Engineer");
  });
});
