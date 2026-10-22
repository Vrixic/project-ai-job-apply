// @vitest-environment jsdom

import type { ResumeDocument } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeUploadForm } from "./resume-upload-form";

const _emptyFacts = { facts: [], confirmedCount: 0, proposedCount: 0 };
const emptyResumes = { documents: [] };
const privateProblemCanary = "synthetic-private-onboarding-problem-never-render";

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

function _stalledProblemResponse(status = 503): Response {
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

function _responseWithDeferredJson<T>(body: Promise<T>): Response {
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

function _setControlValue(control: FormControl, value: string): void {
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

function _labelledControl<T extends FormControl>(
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

function _buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  if (!button) throw new Error(`Could not find button ${name}`);
  return button;
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
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Could not find the resume file input");
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
    expect(fileInput.disabled).toBe(false);
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
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
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
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);

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
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);

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
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Could not find the resume file input");
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
    expect(fileInput.disabled).toBe(true);

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
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Could not find the resume file input");
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
    expect(fileInput.disabled).toBe(true);

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
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Could not find the resume file input");
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
    expect(fileInput.disabled).toBe(true);

    await act(async () => pendingStorage.resolve(new Response(null, { status: 204 })));
    expect(container.textContent).not.toContain("synthetic-prior-account.pdf");
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");
    expect(parsedCallback).not.toHaveBeenCalled();
  });
});
