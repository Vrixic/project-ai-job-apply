// @vitest-environment jsdom

import type {
  ProfileFact,
  ProfileFactCollection,
  ResumeDocument,
} from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileFactsForm } from "./profile-facts-form";
import { ResumeUploadForm } from "./resume-upload-form";

const emptyFacts = { facts: [], confirmedCount: 0, proposedCount: 0 };
const emptyResumes = { documents: [] };
const privateProblemCanary = "synthetic-private-onboarding-problem-never-render";

function proposedFact(key = "stale_candidate_skill"): ProfileFact {
  return {
    id: "019c0000-0000-7000-8000-000000000040",
    kind: "skill",
    key,
    value: "Prior account value",
    verification: "proposed",
    sensitivity: "confidential",
    source: { type: "resume", reference: "resume:opaque" },
    evidence: {
      supportingSpans: [
        {
          documentId: "019c0000-0000-7000-8000-000000000090",
          documentVersion: 1,
          parserVersion: "synthetic-parser-v1",
          blockIndex: 0,
          startOffset: 0,
          endOffset: 17,
        },
      ],
    },
    version: 1,
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:00.000Z",
  };
}

function confirmedDirectFact(key: string, value = "Synthetic confirmed value"): ProfileFact {
  return {
    ...proposedFact(key),
    key,
    value,
    verification: "confirmed",
    source: { type: "user", reference: "direct-entry" },
  };
}

function resumeDocument(status: ResumeDocument["status"] = "scanning"): ResumeDocument {
  return {
    id: "019c0000-0000-7000-8000-000000000090",
    fileName: "synthetic-prior-account.pdf",
    mediaType: "application/pdf",
    sizeBytes: 3,
    sha256: "a".repeat(64),
    status,
    ...(status === "parsed" ? { pageCount: 1, characterCount: 24 } : {}),
    createdAt: "2026-08-15T12:00:00.000Z",
    updatedAt: "2026-08-15T12:00:02.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function stalledProblemResponse(status = 503): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`{"code":"private_database_failure","title":"${privateProblemCanary}"}`),
        );
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/problem+json",
      },
    },
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function responseWithDeferredJson<T>(body: Promise<T>): Response {
  const encoder = new TextEncoder();
  let started = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (started) return Promise.resolve();
        started = true;
        return body
          .then((value) => {
            controller.enqueue(encoder.encode(JSON.stringify(value)));
            controller.close();
          })
          .catch((error) => controller.error(error as Error));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function requestPath(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.pathname : new URL(input.url).pathname;
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function setControlValue(control: FormControl, value: string): void {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The form control value setter is unavailable");
  setter.call(control, value);
  control.dispatchEvent(
    new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
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

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Could not find button ${name}`);
  return button;
}

function directFactForm(container: HTMLElement): HTMLFormElement {
  const form = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((candidate) =>
    candidate.textContent?.includes("Fact category"),
  );
  if (!form) throw new Error("The direct fact form must be rendered");
  return form;
}

function fillDirectFact(form: HTMLFormElement, key: string, value: string): void {
  setControlValue(labelledControl<HTMLSelectElement>(form, "Fact category", "select"), "skill");
  setControlValue(labelledControl<HTMLInputElement>(form, "Fact name", "input"), key);
  setControlValue(labelledControl<HTMLInputElement>(form, "Confirmed value", "input"), value);
}

function profileFacts(authenticated = true) {
  return <ProfileFactsForm authenticated={authenticated} />;
}

function resumeUpload(authenticated = true, onDocumentParsed?: () => void) {
  return (
    <ResumeUploadForm
      authenticated={authenticated}
      {...(onDocumentParsed ? { onDocumentParsed } : {})}
    />
  );
}

describe("coordinated onboarding flow", () => {
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

  it("shows fixed candidate-safe copy for profile-fact list and create failures", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          return reads === 1
            ? jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              )
            : jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          return jsonResponse(
            {
              code: "private_database_failure",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => root.render(<ProfileFactsForm authenticated refreshVersion={1} />));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "synthetic_private_fact",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Synthetic private value",
      );
    });
    await act(async () =>
      factForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(labelledControl<HTMLInputElement>(factForm, "Fact name", "input").value).toBe(
      "synthetic_private_fact",
    );
    expect(factForm.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
  });

  it("shows fixed profile-facts load failure on a 20 second whole-response timeout", async () => {
    vi.useFakeTimers();
    const timeoutJson = deferred<ProfileFactCollection>();
    let loadSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        loadSignal = init?.signal ?? undefined;
        return responseWithDeferredJson(timeoutJson.promise);
      }),
    );

    await act(async () => root.render(profileFacts()));
    expect(container.textContent).toContain("Loading profile facts…");

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(loadSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    await act(async () =>
      timeoutJson.resolve({
        facts: [proposedFact("stale_timeout_fact")],
        confirmedCount: 0,
        proposedCount: 1,
      }),
    );
  });

  it("rejects a profile-fact list success payload that fails schema validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({
          ...emptyFacts,
          privateField: privateProblemCanary,
        }),
      ),
    );

    await act(async () => root.render(profileFacts()));
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
  });

  it("ignores stale profile-facts load completions after sign out", async () => {
    const initialLoad = deferred<Response>();
    const laterLoad = deferred<Response>();
    const proposal = proposedFact("stale_session_profile_fact");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts") return initialLoad.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(profileFacts()));
    await act(async () => root.render(profileFacts(false)));

    fetchMock.mockImplementationOnce(async (input) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts") return laterLoad.promise;
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => root.render(profileFacts()));
    await act(async () =>
      initialLoad.resolve(
        jsonResponse({
          facts: [proposal],
          confirmedCount: 0,
          proposedCount: 1,
        }),
      ),
    );
    await act(async () => laterLoad.resolve(jsonResponse(emptyFacts)));

    expect(container.textContent).toContain("No extracted facts are waiting for review.");
    expect(container.textContent).not.toContain(proposal.key);
  });

  it("does not parse stalled non-OK profile-fact failure bodies and keeps fixed copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts") {
          return init?.method === "GET" || init?.method === undefined
            ? stalledProblemResponse(503)
            : jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
  });

  it("retries profile-fact loading with a fresh request after timeout and ignores stale completion", async () => {
    vi.useFakeTimers();
    const staleProfileLoad = deferred<Response>();
    const staleFact = proposedFact("stale_profile_fact");
    let readCount = 0;
    let secondLoadSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          readCount += 1;
          if (readCount === 1) {
            return staleProfileLoad.promise;
          }
          secondLoadSignal = init?.signal ?? undefined;
          return jsonResponse(emptyFacts);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));

    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(readCount).toBe(1);

    await act(async () => root.render(<ProfileFactsForm authenticated refreshVersion={1} />));

    expect(readCount).toBe(2);
    expect(container.textContent).not.toContain("stale_profile_fact");
    expect(secondLoadSignal?.aborted).toBe(false);
    expect(container.textContent).toContain("No extracted facts are waiting for review.");

    await act(async () =>
      staleProfileLoad.resolve(
        jsonResponse({
          facts: [staleFact],
          confirmedCount: 0,
          proposedCount: 1,
        }),
      ),
    );
    expect(container.textContent).not.toContain("stale_profile_fact");
  });

  it("keeps rapid create and update activation in one mutation and clears its deadline", async () => {
    vi.useFakeTimers();
    const proposal = proposedFact("single_flight_proposal");
    const pendingCreate = deferred<Response>();
    let createSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
      }
      if (path === "/api/platform/profile-facts" && init?.method === "POST") {
        createSignal = init.signal ?? undefined;
        return pendingCreate.promise;
      }
      if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
        throw new Error("A competing profile mutation must not start");
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(profileFacts()));
    const form = directFactForm(container);
    await act(async () => fillDirectFact(form, "single_flight_create", "Synthetic value"));
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      buttonNamed(container, `Confirm ${proposal.key}`).click();
    });

    const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method !== undefined);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.[0]).toBe("/api/platform/profile-facts");
    expect(mutations[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        kind: "skill",
        key: "single_flight_create",
        value: "Synthetic value",
        sensitivity: "confidential",
      }),
    });
    expect(new Headers(mutations[0]?.[1]?.headers).get("idempotency-key")).toMatch(
      /^profile-fact-/,
    );
    expect(createSignal?.aborted).toBe(false);

    await act(async () =>
      pendingCreate.resolve(jsonResponse(confirmedDirectFact("single_flight_create"))),
    );
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(createSignal?.aborted).toBe(false);
  });

  it("reuses an ambiguous create intent and rotates it after a definitive rejection", async () => {
    vi.useFakeTimers();
    const stalled = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let createCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = requestPath(input);
      if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyFacts);
      }
      if (path === "/api/platform/profile-facts" && init?.method === "POST") {
        mutationCalls.push(init);
        createCount += 1;
        if (createCount === 1) return stalled.promise;
        if (createCount === 2) {
          return jsonResponse({ code: "invalid_request", detail: privateProblemCanary }, 400);
        }
        return jsonResponse(confirmedDirectFact("ambiguous_create"));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(profileFacts()));
    const form = directFactForm(container);
    await act(async () => fillDirectFact(form, "ambiguous_create", "Synthetic value"));
    const submit = () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await act(async () => submit());
    const firstSignal = mutationCalls[0]?.signal;
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(firstSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Saving timed out. Retry to safely check the same profile fact.",
    );

    await act(async () => submit());
    await vi.waitFor(() => expect(mutationCalls).toHaveLength(2));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Check the profile fact and try again."),
    );
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[1]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[1]?.headers).get("idempotency-key")).toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );

    await act(async () => submit());
    expect(mutationCalls).toHaveLength(3);
    expect(mutationCalls[2]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[2]?.headers).get("idempotency-key")).not.toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
    await act(async () => stalled.resolve(jsonResponse(confirmedDirectFact("stale_create"))));
    expect(container.textContent).not.toContain("stale_create");
  });

  it("keeps competing profile reviews single-flight and reuses an ambiguous update intent", async () => {
    vi.useFakeTimers();
    const proposal = proposedFact("ambiguous_review");
    const stalled = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let patchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
        }
        if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
          mutationCalls.push(init);
          patchCount += 1;
          return patchCount === 1
            ? stalled.promise
            : jsonResponse({ ...proposal, verification: "confirmed", version: 2 });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => {
      buttonNamed(container, `Confirm ${proposal.key}`).click();
      buttonNamed(container, `Reject ${proposal.key}`).click();
    });
    expect(mutationCalls).toHaveLength(1);
    expect(JSON.parse(String(mutationCalls[0]?.body))).toEqual({
      expectedVersion: 1,
      verification: "confirmed",
    });

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(mutationCalls[0]?.signal?.aborted).toBe(true);
    expect(container.textContent).toContain("Saving timed out");
    await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());
    expect(mutationCalls).toHaveLength(2);
    expect(mutationCalls[1]?.body).toBe(mutationCalls[0]?.body);
    expect(new Headers(mutationCalls[1]?.headers).get("idempotency-key")).toBe(
      new Headers(mutationCalls[0]?.headers).get("idempotency-key"),
    );
    expect(container.textContent).toContain("Prior versions remain auditable");
    await act(async () =>
      stalled.resolve(jsonResponse({ ...proposal, verification: "rejected", version: 2 })),
    );
    expect(container.textContent).not.toContain("rejected · version 2");
  });

  it("prevents a stale session completion from clearing the next session's ambiguous intent", async () => {
    const staleCreate = deferred<Response>();
    const mutationCalls: RequestInit[] = [];
    let createCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          mutationCalls.push(init);
          createCount += 1;
          if (createCount === 1) return staleCreate.promise;
          if (createCount === 2) throw new TypeError(privateProblemCanary);
          return jsonResponse(confirmedDirectFact("session_b_fact"));
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    let form = directFactForm(container);
    await act(async () => fillDirectFact(form, "same_session_fact", "Synthetic value"));
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    const sessionAKey = new Headers(mutationCalls[0]?.headers).get("idempotency-key");

    await act(async () => root.render(profileFacts(false)));
    expect(mutationCalls[0]?.signal?.aborted).toBe(true);
    await act(async () => root.render(profileFacts()));
    form = directFactForm(container);
    await act(async () => fillDirectFact(form, "same_session_fact", "Synthetic value"));
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.textContent).toContain("Profile facts are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    const sessionBKey = new Headers(mutationCalls[1]?.headers).get("idempotency-key");
    expect(sessionBKey).not.toBe(sessionAKey);

    await act(async () =>
      staleCreate.resolve(jsonResponse(confirmedDirectFact("stale_session_a_fact"))),
    );
    expect(container.textContent).not.toContain("stale_session_a_fact");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(new Headers(mutationCalls[2]?.headers).get("idempotency-key")).toBe(sessionBKey);
    expect(mutationCalls[2]?.body).toBe(mutationCalls[1]?.body);
    expect(container.textContent).toContain("Profile fact saved as confirmed user input.");
  });

  it("keeps the fixed profile conflict flow and reloads the latest fact", async () => {
    const proposal = proposedFact("conflicting_skill");
    const latest = { ...proposal, value: "Latest synthetic value", version: 2 };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          const fact = reads === 1 ? proposal : latest;
          return jsonResponse({ facts: [fact], confirmedCount: 0, proposedCount: 1 });
        }
        if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
          return jsonResponse(
            {
              code: "profile_fact_transition_conflict",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            409,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());
    await vi.waitFor(() => expect(reads).toBe(2));

    expect(reads).toBe(2);
    expect(container.textContent).toContain(
      "This proposal changed after it was loaded. The latest version is shown; review it again.",
    );
    expect(container.textContent).toContain("Latest synthetic value");
    expect(container.textContent).not.toContain(privateProblemCanary);
  });

  it("does not restore a created fact after sign-out during its POST", async () => {
    const pendingCreate = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          return pendingCreate.promise;
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "prior_account_created",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Prior account value",
      );
    });
    await act(async () =>
      factForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    await act(async () => root.render(profileFacts(false)));
    expect(container.textContent).not.toContain("prior_account_created");
    expect(container.querySelector("form")).toBeNull();
    await act(async () =>
      pendingCreate.resolve(
        jsonResponse({
          ...proposedFact("prior_account_created"),
          verification: "confirmed",
          source: { type: "user", reference: "direct-entry" },
        }),
      ),
    );

    expect(container.textContent).not.toContain("prior_account_created");
    expect(container.textContent).not.toContain("Profile fact saved");
    expect(container.querySelector("form")).toBeNull();
  });

  it("clears an open correction when the user signs out", async () => {
    const proposal = proposedFact();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 }),
      ),
    );

    await act(async () => root.render(profileFacts()));
    await act(async () => buttonNamed(container, "Edit & confirm").click());
    expect(
      labelledControl<HTMLInputElement>(container, `Correct ${proposal.key}`, "input").value,
    ).toBe("Prior account value");

    await act(async () => root.render(profileFacts(false)));
    expect(container.textContent).not.toContain(`Correct ${proposal.key}`);
    expect(container.textContent).not.toContain(proposal.key);
  });

  it.each(["confirm", "edit-confirm", "reject"] as const)(
    "does not apply a stale %s PATCH after sign-out",
    async (action) => {
      const proposal = proposedFact();
      const pendingPatch = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const path = requestPath(input);
          if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
            return jsonResponse({ facts: [proposal], confirmedCount: 0, proposedCount: 1 });
          }
          if (path === `/api/platform/profile-facts/${proposal.id}` && init?.method === "PATCH") {
            return pendingPatch.promise;
          }
          throw new Error(`Unexpected request: ${path}`);
        }),
      );

      await act(async () => root.render(profileFacts()));
      if (action === "confirm") {
        await act(async () => buttonNamed(container, `Confirm ${proposal.key}`).click());
      } else if (action === "reject") {
        await act(async () => buttonNamed(container, `Reject ${proposal.key}`).click());
      } else {
        await act(async () => buttonNamed(container, "Edit & confirm").click());
        const correction = labelledControl<HTMLInputElement>(
          container,
          `Correct ${proposal.key}`,
          "input",
        );
        await act(async () => setControlValue(correction, "Corrected prior account value"));
        const correctionForm = correction.closest("form");
        await act(async () =>
          correctionForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      }

      await act(async () => root.render(profileFacts(false)));
      await act(async () =>
        pendingPatch.resolve(
          jsonResponse({
            ...proposal,
            value: action === "edit-confirm" ? "Corrected prior account value" : proposal.value,
            verification: action === "reject" ? "rejected" : "confirmed",
            version: 2,
          }),
        ),
      );

      expect(container.textContent).not.toContain(proposal.key);
      expect(container.textContent).not.toContain("Prior versions remain auditable");
    },
  );

  it("requires an explicit fact category and fixes direct entries to confidential", async () => {
    let submittedFact: unknown;
    const created: ProfileFact = {
      id: "019c0000-0000-7000-8000-000000000031",
      kind: "skill",
      key: "programming_language",
      value: "Synthetic TypeScript",
      verification: "confirmed",
      sensitivity: "confidential",
      source: { type: "user", reference: "direct-entry" },
      version: 1,
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/profile-facts" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyFacts);
        }
        if (path === "/api/platform/profile-facts" && init?.method === "POST") {
          submittedFact = JSON.parse(String(init.body));
          return jsonResponse(created);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(profileFacts()));
    const factForm = Array.from(container.querySelectorAll<HTMLFormElement>("form")).find((form) =>
      form.textContent?.includes("Fact category"),
    );
    if (!factForm) throw new Error("The fact form must be rendered");
    const submit = factForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(labelledControl<HTMLSelectElement>(factForm, "Fact category", "select").value).toBe("");
    expect(factForm.textContent).toContain(
      "Restricted sponsorship, work-authorization, demographic, disability, veteran, and legal answers are not collected here",
    );
    expect(submit?.disabled).toBe(true);

    await act(async () => {
      setControlValue(
        labelledControl<HTMLSelectElement>(factForm, "Fact category", "select"),
        "skill",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Fact name", "input"),
        "programming_language",
      );
      setControlValue(
        labelledControl<HTMLInputElement>(factForm, "Confirmed value", "input"),
        "Synthetic TypeScript",
      );
    });
    await act(async () =>
      factForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    expect(submittedFact).toEqual({
      kind: "skill",
      key: "programming_language",
      value: "Synthetic TypeScript",
      sensitivity: "confidential",
    });
  });

  it("shows fixed candidate-safe copy for resume list and registration failures", async () => {
    let reads = 0;
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          reads += 1;
          return reads === 1
            ? jsonResponse(
                {
                  code: "private_database_failure",
                  title: privateProblemCanary,
                  detail: privateProblemCanary,
                },
                503,
              )
            : jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse(
            {
              code: "document_intake_unavailable",
              title: privateProblemCanary,
              detail: privateProblemCanary,
            },
            503,
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(resumeUpload()));
    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);

    await act(async () => root.render(resumeUpload(false)));
    await act(async () => root.render(resumeUpload()));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(registrationCalls).toBe(1));
    });

    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(container.textContent).toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(false);
  });

  it("shows fixed candidate-safe copy when resume status polling fails", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        return reads === 1
          ? jsonResponse({ documents: [resumeDocument()] })
          : jsonResponse(
              {
                code: "private_database_failure",
                title: privateProblemCanary,
                detail: privateProblemCanary,
              },
              503,
            );
      }),
    );

    await act(async () => root.render(resumeUpload()));
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(reads).toBe(2);
    expect(container.textContent).toContain("Resume processing is temporarily unavailable.");
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain(privateProblemCanary);
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);
  });

  it("hides resume state immediately and ignores an initial load after sign-out", async () => {
    const pendingLoad = deferred<Response>();
    const parsedCallback = vi.fn();
    let loadSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        loadSignal = init?.signal;
        return pendingLoad.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    await act(async () => root.render(resumeUpload(false, parsedCallback)));

    expect(loadSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingLoad.resolve(jsonResponse({ documents: [resumeDocument("parsed")] })),
    );
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("hides resume state immediately and ignores a poll after sign-out", async () => {
    vi.useFakeTimers();
    const pendingPoll = deferred<Response>();
    const parsedCallback = vi.fn();
    let reads = 0;
    let pollSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        reads += 1;
        if (reads === 1) return jsonResponse({ documents: [resumeDocument()] });
        pollSignal = init?.signal;
        return pendingPoll.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(container.textContent).toContain("synthetic-prior-account.pdf");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(2);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));

    expect(pollSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingPoll.resolve(jsonResponse({ documents: [resumeDocument("parsed")] })),
    );
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume parsing finished");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("cancels the resume poll delay before another account-bound request", async () => {
    vi.useFakeTimers();
    const parsedCallback = vi.fn();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        return jsonResponse({ documents: [resumeDocument()] });
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(reads).toBe(1);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(reads).toBe(1);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("keeps a new account poll active when the prior account poll resolves last", async () => {
    vi.useFakeTimers();
    const pendingPriorPoll = deferred<Response>();
    const parsedCallback = vi.fn();
    const priorDocument = resumeDocument();
    const currentDocument: ResumeDocument = {
      ...resumeDocument(),
      id: "019c0000-0000-7000-8000-000000000091",
      fileName: "synthetic-current-account.pdf",
    };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        reads += 1;
        if (reads === 1) return jsonResponse({ documents: [priorDocument] });
        if (reads === 2) return pendingPriorPoll.promise;
        if (reads === 3) return jsonResponse({ documents: [currentDocument] });
        if (reads === 4) {
          return jsonResponse({ documents: [{ ...currentDocument, status: "parsed" }] });
        }
        throw new Error(`Unexpected resume read ${reads}`);
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(2);
    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    expect(container.textContent).toContain("synthetic-current-account.pdf");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(reads).toBe(4);
    expect(container.textContent).toContain("Resume parsing finished");
    expect(parsedCallback).toHaveBeenCalledTimes(1);

    await act(async () =>
      pendingPriorPoll.resolve(
        jsonResponse({ documents: [{ ...priorDocument, status: "parsed" }] }),
      ),
    );
    expect(container.textContent).toContain("synthetic-current-account.pdf");
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(parsedCallback).toHaveBeenCalledTimes(1);
  });

  it("does not continue a resume upload after sign-out during registration", async () => {
    const pendingRegistration = deferred<Response>();
    const parsedCallback = vi.fn();
    let registrationSignal: AbortSignal | null | undefined;
    let storageCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationSignal = init.signal;
          return pendingRegistration.promise;
        }
        storageCalls += 1;
        return new Response(null, { status: 204 });
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(registrationSignal).toBeTruthy());
    });

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(registrationSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () =>
      pendingRegistration.resolve(
        jsonResponse({
          document: resumeDocument("awaiting_upload"),
          upload: {
            url: "https://storage.example.test/upload",
            method: "POST",
            fields: { key: "synthetic/key" },
            expiresAt: "2026-08-15T12:15:00.000Z",
          },
        }),
      ),
    );
    expect(storageCalls).toBe(0);
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("does not register a resume when sign-out occurs during hashing", async () => {
    const pendingBytes = deferred<ArrayBuffer>();
    const parsedCallback = vi.fn();
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse({ title: "Unexpected registration" }, 500);
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: () => pendingBytes.promise,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () =>
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(fileInput.value).toBe("");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () => pendingBytes.resolve(new Uint8Array([1, 2, 3]).buffer));
    expect(registrationCalls).toBe(0);
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });

  it("does not restore resume state after sign-out during the storage upload", async () => {
    const pendingStorage = deferred<Response>();
    const parsedCallback = vi.fn();
    let storageSignal: AbortSignal | null | undefined;
    let registrationCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = requestPath(input);
        if (path === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
          return jsonResponse(emptyResumes);
        }
        if (path === "/api/platform/resumes" && init?.method === "POST") {
          registrationCalls += 1;
          return jsonResponse({
            document: resumeDocument("awaiting_upload"),
            upload: {
              url: "https://storage.example.test/upload",
              method: "POST",
              fields: { key: "synthetic/key" },
              expiresAt: "2026-08-15T12:15:00.000Z",
            },
          });
        }
        storageSignal = init?.signal;
        return pendingStorage.promise;
      }),
    );

    await act(async () => root.render(resumeUpload(true, parsedCallback)));
    const fileInput = labelledControl<HTMLInputElement>(
      container,
      "Resume file",
      'input[type="file"]',
    );
    const file = new File([new Uint8Array([1, 2, 3])], "synthetic.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    const uploadForm = fileInput.closest("form");
    await act(async () => {
      uploadForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(storageSignal).toBeTruthy());
    });
    expect(registrationCalls).toBe(1);

    await act(async () => root.render(resumeUpload(false, parsedCallback)));
    expect(storageSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("0 stored");
    expect(container.textContent).not.toContain("Selected file: synthetic.pdf");
    expect(buttonNamed(container, "Upload resume").disabled).toBe(true);

    await act(async () => pendingStorage.resolve(new Response(null, { status: 204 })));
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });
});
