// @vitest-environment jsdom

import type { JobPreferenceSet, PutJobPreferencesResponse } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePageClient } from "./profile-page-client";

vi.mock("../../profile-facts-form", () => ({ ProfileFactsForm: () => null }));

const privateProblemCanary = "synthetic-private-preference-problem-never-render";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function deferredResponse() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

type FormControl = HTMLInputElement | HTMLTextAreaElement;

function setControlValue(control: FormControl, value: string): void {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The form control value setter is unavailable");
  setter.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function labelledControl<T extends FormControl>(
  container: HTMLElement,
  labelText: string,
  selector: string,
): T {
  const control = Array.from(container.querySelectorAll("label"))
    .filter((candidate) => candidate.textContent?.includes(labelText))
    .map((candidate) => candidate.querySelector<T>(selector))
    .find((candidate): candidate is T => candidate !== null);
  if (!control) throw new Error(`Could not find ${labelText}`);
  return control;
}

function preferenceForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Job preferences"]');
  if (!form) throw new Error("The preference form must be rendered");
  return form;
}

function renderFoundation(authenticated = true) {
  return <ProfilePageClient authenticated={authenticated} />;
}

function preferenceSet(role: string, version = 1): JobPreferenceSet {
  return {
    id: "019c0000-0000-7000-8000-000000000201",
    version,
    updatedAt: "2026-08-17T20:00:00.000Z",
    targetRoles: [role],
    locations: [],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
  };
}

function saveResponse(role: string, operationSuffix: string, version = 1): Response {
  const body: PutJobPreferencesResponse = {
    preferences: preferenceSet(role, version),
    operationId: `019c0000-0000-7000-8000-000000000${operationSuffix}`,
  };
  return jsonResponse(body);
}

function putCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
}

async function fillValidPreferences(container: HTMLElement, role = "Platform Engineer") {
  await act(async () => {
    setControlValue(
      labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea"),
      role,
    );
    labelledControl<HTMLInputElement>(container, "Remote", 'input[type="checkbox"]').click();
    labelledControl<HTMLInputElement>(container, "Full-time", 'input[type="checkbox"]').click();
  });
}

async function submitPreferences(container: HTMLElement) {
  await act(async () => {
    preferenceForm(container).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("preference save request lifecycle", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("claims rapid activation synchronously and clears the completed deadline", async () => {
    vi.useFakeTimers();
    const pendingSave = deferredResponse();
    let saveSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (requestPath(input) !== "/api/platform/job-preferences") {
        throw new Error(`Unexpected request: ${requestPath(input)}`);
      }
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ code: "not_found" }, 404);
      saveSignal = init?.signal ?? undefined;
      return pendingSave.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await fillValidPreferences(container);
    await act(async () => {
      const form = preferenceForm(container);
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const requests = putCalls(fetchMock);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.[0]).toBe("/api/platform/job-preferences");
    expect(requests[0]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({
        targetRoles: ["Platform Engineer"],
        locations: [],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      }),
    });
    expect(new Headers(requests[0]?.[1]?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(requests[0]?.[1]?.headers).get("idempotency-key")).toMatch(/^preferences-/);

    await act(async () => pendingSave.resolve(saveResponse("Platform Engineer", "202")));
    // Flushes a React-scheduler tick that a leaner component tree (no sibling
    // Jobs/Resume/Settings sections) can otherwise leave pending at this instant.
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(renderFoundation(false)));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(saveSignal?.aborted).toBe(false);
  });

  it("aborts at the exact deadline and reuses one ambiguous intent only on explicit retry", async () => {
    vi.useFakeTimers();
    const stalledSave = deferredResponse();
    let putCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (requestPath(input) !== "/api/platform/job-preferences") {
        throw new Error(`Unexpected request: ${requestPath(input)}`);
      }
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ code: "not_found" }, 404);
      putCount += 1;
      return putCount === 1 ? stalledSave.promise : saveResponse("Platform Engineer", "203");
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await fillValidPreferences(container);
    await submitPreferences(container);
    const first = putCalls(fetchMock)[0]?.[1];
    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(first?.signal?.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(first?.signal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Saving preferences timed out. Retry to safely check the same preference update.",
    );
    expect(vi.getTimerCount()).toBe(0);

    await submitPreferences(container);
    const requests = putCalls(fetchMock);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.[1]?.body).toBe(first?.body);
    expect(new Headers(requests[1]?.[1]?.headers).get("idempotency-key")).toBe(
      new Headers(first?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
  });

  it("retains 5xx and transport-ambiguous intent, then rotates when the body changes", async () => {
    let putCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (requestPath(input) !== "/api/platform/job-preferences") {
        throw new Error(`Unexpected request: ${requestPath(input)}`);
      }
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ code: "not_found" }, 404);
      putCount += 1;
      if (putCount === 1) {
        return jsonResponse({ code: "unavailable", detail: privateProblemCanary }, 503);
      }
      if (putCount === 2) throw new TypeError(privateProblemCanary);
      return saveResponse("Principal Engineer", "204");
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await fillValidPreferences(container);
    await submitPreferences(container);
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    const first = putCalls(fetchMock)[0]?.[1];

    await submitPreferences(container);
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    const second = putCalls(fetchMock)[1]?.[1];
    expect(second?.body).toBe(first?.body);
    expect(new Headers(second?.headers).get("idempotency-key")).toBe(
      new Headers(first?.headers).get("idempotency-key"),
    );

    await act(async () =>
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea"),
        "Principal Engineer",
      ),
    );
    await submitPreferences(container);
    const third = putCalls(fetchMock)[2]?.[1];
    expect(third?.body).not.toBe(first?.body);
    expect(new Headers(third?.headers).get("idempotency-key")).not.toBe(
      new Headers(first?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
  });

  it("rotates after definitive rejection, success, and local validation refusal", async () => {
    let putCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (requestPath(input) !== "/api/platform/job-preferences") {
        throw new Error(`Unexpected request: ${requestPath(input)}`);
      }
      if ((init?.method ?? "GET") === "GET") return jsonResponse({ code: "not_found" }, 404);
      putCount += 1;
      if (putCount === 1) {
        return jsonResponse({ code: "invalid_request", detail: privateProblemCanary }, 400);
      }
      if (putCount === 2) return saveResponse("Platform Engineer", "205", 2);
      if (putCount === 3) throw new TypeError(privateProblemCanary);
      return saveResponse("Platform Engineer", "206", 3);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await fillValidPreferences(container);
    await submitPreferences(container);
    expect(container.textContent).toContain("Check your job preferences and try again.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    await submitPreferences(container);
    const requestsAfterSuccess = putCalls(fetchMock);
    expect(new Headers(requestsAfterSuccess[1]?.[1]?.headers).get("idempotency-key")).not.toBe(
      new Headers(requestsAfterSuccess[0]?.[1]?.headers).get("idempotency-key"),
    );

    await submitPreferences(container);
    const ambiguousKey = new Headers(putCalls(fetchMock)[2]?.[1]?.headers).get("idempotency-key");
    expect(ambiguousKey).not.toBe(
      new Headers(requestsAfterSuccess[1]?.[1]?.headers).get("idempotency-key"),
    );
    await act(async () =>
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea"),
        "",
      ),
    );
    await submitPreferences(container);
    expect(putCalls(fetchMock)).toHaveLength(3);
    expect(container.textContent).toContain("Add at least one target role.");
    await act(async () =>
      setControlValue(
        labelledControl<HTMLTextAreaElement>(container, "Target role 1", "textarea"),
        "Platform Engineer",
      ),
    );
    await submitPreferences(container);
    expect(new Headers(putCalls(fetchMock)[3]?.[1]?.headers).get("idempotency-key")).not.toBe(
      ambiguousKey,
    );
  });

  it("prevents a stale account completion from clearing the next account's ambiguous intent", async () => {
    const staleSave = deferredResponse();
    let preferenceReads = 0;
    let putCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (requestPath(input) !== "/api/platform/job-preferences") {
        throw new Error(`Unexpected request: ${requestPath(input)}`);
      }
      if ((init?.method ?? "GET") === "GET") {
        preferenceReads += 1;
        return jsonResponse({ code: "not_found" }, 404);
      }
      putCount += 1;
      if (putCount === 1) return staleSave.promise;
      if (putCount === 2) throw new TypeError(privateProblemCanary);
      return saveResponse("Platform Engineer", "207");
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(renderFoundation()));
    await fillValidPreferences(container);
    await submitPreferences(container);
    const sessionA = putCalls(fetchMock)[0]?.[1];

    await act(async () => root.render(renderFoundation(false)));
    expect(sessionA?.signal?.aborted).toBe(true);
    await act(async () => root.render(renderFoundation()));
    expect(preferenceReads).toBe(2);
    await fillValidPreferences(container);
    await submitPreferences(container);
    const sessionB = putCalls(fetchMock)[1]?.[1];
    expect(new Headers(sessionB?.headers).get("idempotency-key")).not.toBe(
      new Headers(sessionA?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain("Job preferences are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => staleSave.resolve(saveResponse("Stale account role", "208")));
    expect(container.textContent).not.toContain("Stale account role");
    expect(container.textContent).not.toContain("Preferences saved");
    await submitPreferences(container);
    const sessionBRetry = putCalls(fetchMock)[2]?.[1];
    expect(sessionBRetry?.body).toBe(sessionB?.body);
    expect(new Headers(sessionBRetry?.headers).get("idempotency-key")).toBe(
      new Headers(sessionB?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain(
      "Preferences saved. Checking optional preference details.",
    );
  });
});
