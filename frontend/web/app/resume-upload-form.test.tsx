// @vitest-environment jsdom

import type { ResumeDocument } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeUploadForm, resumeUploadGate } from "./resume-upload-form";

const emptyResumes = { documents: [] };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function registeredResume(
  id: string,
  fileName: string,
  uploadUrl: string,
): { document: ResumeDocument; upload: object } {
  return {
    document: {
      id,
      fileName,
      mediaType: "application/pdf",
      sizeBytes: 3,
      sha256: "a".repeat(64),
      status: "awaiting_upload",
      createdAt: "2026-08-17T12:00:00.000Z",
      updatedAt: "2026-08-17T12:00:00.000Z",
    },
    upload: {
      url: uploadUrl,
      method: "POST",
      fields: { key: `synthetic/${id}` },
      expiresAt: "2099-08-17T12:15:00.000Z",
    },
  };
}

function syntheticPdf(name: string, arrayBuffer: () => Promise<ArrayBuffer>): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: arrayBuffer });
  return file;
}

async function selectFile(container: HTMLElement, file: File): Promise<HTMLFormElement> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("The resume file input must be rendered");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const form = input.closest("form");
  if (!form) throw new Error("The resume upload form must be rendered");
  return form;
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

async function flushAsyncWork(rounds = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

describe("ResumeUploadForm upload ownership", () => {
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

  it("bounds an abort-ignoring initial read and retries it explicitly without claiming an empty list", async () => {
    vi.useFakeTimers();
    const stalled = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return stalled.promise;
      })
      .mockImplementationOnce(async (_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return jsonResponse(emptyResumes);
      });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/platform/resumes");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();

    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(signals[0]?.aborted).toBe(false);
    expect(container.textContent).toContain("Loading resumes");
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(signals[0]?.aborted).toBe(true);
    expect(container.textContent).toContain("Loading resume status timed out");
    expect(container.textContent).not.toContain("No resumes uploaded yet");
    expect(vi.getTimerCount()).toBe(0);

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry resume status",
    );
    await act(async () => {
      retry?.click();
      retry?.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("No resumes uploaded yet");
    expect(container.textContent).not.toContain("timed out");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(signals[1]?.aborted).toBe(false);
  });

  it("keeps the exact deadline active through a stalled success body", async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        signal = init?.signal ?? undefined;
        return { ok: true, json: () => body.promise } as Response;
      }),
    );

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(signal?.aborted).toBe(true);
    expect(container.textContent).toContain("Loading resume status timed out");
    expect(container.textContent).not.toContain("No resumes uploaded yet");
    await act(async () => body.resolve(emptyResumes));
    expect(container.textContent).toContain("Loading resume status timed out");
  });

  it("keeps the deadline active through a stalled problem body without rendering its canary", async () => {
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const response = new Response(null, { status: 503 });
    vi.spyOn(response, "json").mockImplementation(async () => body.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => response),
    );

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(container.textContent).toContain("Loading resume status timed out");
    await act(async () =>
      body.resolve({
        code: "platform_unavailable",
        detail: "private-resume-status-canary",
        title: "private-resume-status-canary",
      }),
    );
    expect(container.textContent).toContain("Loading resume status timed out");
    expect(container.textContent).not.toContain("private-resume-status-canary");
  });

  it("does not let an older initial list erase a locally completed upload", async () => {
    const initialList = deferred<Response>();
    const settledJsonResponse = (body: unknown, status = 200) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      }) as Response;
    let getCount = 0;
    const uploaded = registeredResume(
      "019c0000-0000-7000-8000-000000000104",
      "revision-fenced.pdf",
      "https://storage.example.test/revision-fenced",
    );
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        getCount += 1;
        return getCount === 1
          ? initialList.promise
          : settledJsonResponse({ documents: [uploaded.document] });
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        return settledJsonResponse(uploaded, 201);
      }
      if (input === "https://storage.example.test/revision-fenced") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await vi.waitFor(() => expect(getCount).toBe(1));
    const form = await selectFile(
      container,
      syntheticPdf("revision-fenced.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(container.textContent).toContain("Resume uploaded to quarantine");

    await act(async () => {
      initialList.resolve(settledJsonResponse(emptyResumes));
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(container.textContent).toContain("revision-fenced.pdf");
    expect(container.textContent).toContain("Resume processing is temporarily unavailable");
    expect(container.textContent).not.toContain("No resumes uploaded yet");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry resume status",
    );
    await act(async () => retry?.click());
    await flushAsyncWork();
    expect(container.textContent).toContain("revision-fenced.pdf");
    expect(container.textContent).not.toContain("temporarily unavailable");
  });

  it("retains the last-known document when a polling read times out", async () => {
    vi.useFakeTimers();
    const stalledPoll = deferred<Response>();
    let pollSignal: AbortSignal | undefined;
    const processing = registeredResume(
      "019c0000-0000-7000-8000-000000000105",
      "processing.pdf",
      "https://storage.example.test/unused",
    ).document;
    processing.status = "scanning";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ documents: [processing] }))
      .mockImplementationOnce((_input, init) => {
        pollSignal = init?.signal ?? undefined;
        return stalledPoll.promise;
      })
      .mockResolvedValueOnce(jsonResponse({ documents: [{ ...processing, status: "parsed" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await vi.waitFor(() => expect(container.textContent).toContain("processing.pdf"));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(pollSignal?.aborted).toBe(true);
    expect(container.textContent).toContain("processing.pdf");
    expect(container.textContent).toContain("Loading resume status timed out");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry resume status",
    );
    await act(async () => retry?.click());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("parsed");
    expect(container.textContent).not.toContain("timed out");
  });

  it("cleans and fences an abort-ignoring list read across sign-out", async () => {
    vi.useFakeTimers();
    const oldList = deferred<Response>();
    let oldSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        oldSignal = init?.signal ?? undefined;
        return oldList.promise;
      }),
    );

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(<ResumeUploadForm authenticated={false} />));
    expect(oldSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () =>
      oldList.resolve(
        jsonResponse({
          documents: [
            registeredResume(
              "019c0000-0000-7000-8000-000000000106",
              "private-old-session.pdf",
              "https://storage.example.test/private",
            ).document,
          ],
        }),
      ),
    );
    expect(container.textContent).not.toMatch(
      /private-old-session|temporarily unavailable|timed out/i,
    );
  });

  it("owns one exact hash, registration, and storage chain across rapid submissions", async () => {
    const pendingBytes = deferred<ArrayBuffer>();
    const pendingStorage = deferred<Response>();
    const arrayBuffer = vi.fn(() => pendingBytes.promise);
    const registrationCalls: RequestInit[] = [];
    const storageCalls: RequestInit[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrationCalls.push(init);
        return jsonResponse(
          registeredResume(
            "019c0000-0000-7000-8000-000000000101",
            "single-flight.pdf",
            "https://storage.example.test/single-flight",
          ),
          201,
        );
      }
      if (input === "https://storage.example.test/single-flight") {
        storageCalls.push(init ?? {});
        return pendingStorage.promise;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await vi.waitFor(() => expect(container.textContent).toContain("No resumes uploaded yet."));
    const form = await selectFile(container, syntheticPdf("single-flight.pdf", arrayBuffer));

    await act(async () => {
      submit(form);
      submit(form);
    });

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(registrationCalls).toHaveLength(0);

    await act(async () => pendingBytes.resolve(new Uint8Array([1, 2, 3]).buffer));
    await vi.waitFor(() => expect(storageCalls).toHaveLength(1));

    expect(registrationCalls).toHaveLength(1);
    expect(registrationCalls[0]).toMatchObject({
      method: "POST",
      cache: "no-store",
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
    const registrationHeaders = new Headers(registrationCalls[0]?.headers);
    expect(registrationHeaders.get("content-type")).toBe("application/json");
    expect(registrationHeaders.get("idempotency-key")).toMatch(/^resume-upload-/);
    expect(JSON.parse(String(registrationCalls[0]?.body))).toEqual({
      fileName: "single-flight.pdf",
      mediaType: "application/pdf",
      sizeBytes: 3,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(storageCalls[0]).toMatchObject({
      method: "POST",
      body: expect.any(FormData),
      signal: registrationCalls[0]?.signal,
    });

    await act(async () => pendingStorage.resolve(new Response(null, { status: 204 })));
    expect(container.textContent).toContain("single-flight.pdf");
    expect(container.textContent).toContain("Resume uploaded to quarantine");
  });

  it("settles an abort-ignoring registration fetch at exactly 20 seconds and retries with a fresh chain", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const registrations: RequestInit[] = [];
    const storageUrls: string[] = [];
    let registrationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrations.push(init);
        registrationCount += 1;
        if (registrationCount === 1) return new Promise<Response>(() => undefined);
        return jsonResponse(
          registeredResume(
            "019c0000-0000-7000-8000-000000000111",
            "registration-retry.pdf",
            "https://storage.example.test/registration-retry",
          ),
          201,
        );
      }
      if (input === "https://storage.example.test/registration-retry") {
        storageUrls.push(input);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("registration-retry.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrations).toHaveLength(1);
    const firstSignal = registrations[0]?.signal;
    const firstKey = new Headers(registrations[0]?.headers).get("idempotency-key");

    await act(async () => vi.advanceTimersByTimeAsync(19_999));
    expect(firstSignal?.aborted).toBe(false);
    expect(container.textContent).toContain("Encrypting and uploading");
    expect(container.textContent).not.toContain("registration timed out");

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(firstSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Resume upload registration timed out. Try again to request a new upload grant.",
    );
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrations).toHaveLength(2);
    const secondKey = new Headers(registrations[1]?.headers).get("idempotency-key");
    expect(secondKey).not.toBe(firstKey);
    expect(registrations[1]?.signal).not.toBe(firstSignal);
    expect(storageUrls).toEqual(["https://storage.example.test/registration-retry"]);
    expect(container.textContent).toContain("Resume uploaded to quarantine");
  });

  it("settles an abort-ignoring registration body and fences its late result from a newer retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const firstBody = deferred<unknown>();
    const secondBody = deferred<unknown>();
    const registrations: RequestInit[] = [];
    const storageUrls: string[] = [];
    let registrationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrations.push(init);
        registrationCount += 1;
        return {
          ok: true,
          json: () => (registrationCount === 1 ? firstBody.promise : secondBody.promise),
        } as Response;
      }
      if (typeof input === "string" && input.startsWith("https://storage.example.test/")) {
        storageUrls.push(input);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("late-registration.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrations).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(registrations[0]?.signal?.aborted).toBe(true);

    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrations).toHaveLength(2);
    expect(registrations[1]?.signal?.aborted).toBe(false);

    await act(async () =>
      firstBody.resolve(
        registeredResume(
          "019c0000-0000-7000-8000-000000000112",
          "late-registration.pdf",
          "https://storage.example.test/stale-registration",
        ),
      ),
    );
    expect(storageUrls).toHaveLength(0);
    expect(container.textContent).toContain("Encrypting and uploading");
    expect(container.textContent).not.toContain("registration timed out");

    await act(async () =>
      secondBody.resolve(
        registeredResume(
          "019c0000-0000-7000-8000-000000000113",
          "late-registration.pdf",
          "https://storage.example.test/current-registration",
        ),
      ),
    );
    expect(storageUrls).toEqual(["https://storage.example.test/current-registration"]);
    expect(container.textContent).toContain("Resume uploaded to quarantine");
  });

  it("settles a hostile registration problem body without rendering its private values", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const problemBody = deferred<unknown>();
    let registrationSignal: AbortSignal | undefined;
    const response = new Response(null, { status: 503 });
    vi.spyOn(response, "json").mockImplementation(async () => problemBody.promise);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrationSignal = init.signal ?? undefined;
        return response;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("problem-body.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrationSignal).toBeDefined();

    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(registrationSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Resume upload registration timed out. Try again to request a new upload grant.",
    );
    expect(vi.getTimerCount()).toBe(0);

    await act(async () =>
      problemBody.resolve({
        code: "platform_unavailable",
        detail: "private-registration-problem-canary",
        title: "private-registration-problem-canary",
      }),
    );
    expect(container.textContent).toContain("Resume upload registration timed out");
    expect(container.textContent).not.toContain("private-registration-problem-canary");
  });

  it("settles direct storage at exactly 60 seconds and retries with a fresh key and grant", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const registrations: RequestInit[] = [];
    const storageCalls: Array<{ init: RequestInit; url: string }> = [];
    let registrationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrations.push(init);
        registrationCount += 1;
        return jsonResponse(
          registeredResume(
            `019c0000-0000-7000-8000-00000000011${registrationCount + 3}`,
            "storage-retry.pdf",
            `https://storage.example.test/storage-${registrationCount}`,
          ),
          201,
        );
      }
      if (typeof input === "string" && input.startsWith("https://storage.example.test/storage-")) {
        storageCalls.push({ init: init ?? {}, url: input });
        if (input.endsWith("storage-1")) return new Promise<Response>(() => undefined);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("storage-retry.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(storageCalls).toHaveLength(1);
    const firstKey = new Headers(registrations[0]?.headers).get("idempotency-key");
    const firstSignal = storageCalls[0]?.init.signal;
    expect(storageCalls[0]).toMatchObject({
      init: { body: expect.any(FormData), method: "POST" },
      url: "https://storage.example.test/storage-1",
    });

    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(firstSignal?.aborted).toBe(false);
    expect(container.textContent).toContain("Encrypting and uploading");
    expect(container.textContent).not.toContain("file upload timed out");

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(firstSignal?.aborted).toBe(true);
    expect(container.textContent).toContain(
      "Resume file upload timed out. Try again to request a new upload grant.",
    );
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => submit(form));
    await flushAsyncWork();
    expect(storageCalls).toHaveLength(2);
    const secondKey = new Headers(registrations[1]?.headers).get("idempotency-key");
    expect(secondKey).not.toBe(firstKey);
    expect(storageCalls[1]?.url).toBe("https://storage.example.test/storage-2");
    expect(storageCalls[1]?.init.signal).not.toBe(firstSignal);
    expect(container.textContent).toContain("Resume uploaded to quarantine");
  });

  it("requires exact storage 204 and redacts an unexpected transport failure on explicit retry", async () => {
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const registrations: RequestInit[] = [];
    let registrationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrations.push(init);
        registrationCount += 1;
        return jsonResponse(
          registeredResume(
            `019c0000-0000-7000-8000-00000000012${registrationCount}`,
            "strict-storage.pdf",
            `https://storage.example.test/strict-${registrationCount}`,
          ),
          201,
        );
      }
      if (input === "https://storage.example.test/strict-1") {
        return new Response(null, { status: 200 });
      }
      if (input === "https://storage.example.test/strict-2") {
        throw new Error("private-storage-transport-canary");
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("strict-storage.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "The encrypted upload was not accepted. Retry with a new upload grant.",
      ),
    );
    expect(container.textContent).not.toContain("Resume uploaded to quarantine");

    await act(async () => submit(form));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Could not upload the resume. Try again with a new upload grant.",
      ),
    );
    expect(container.textContent).not.toContain("private-storage-transport-canary");
    expect(new Headers(registrations[1]?.headers).get("idempotency-key")).not.toBe(
      new Headers(registrations[0]?.headers).get("idempotency-key"),
    );
  });

  it("clears registration ownership, deadline, and late completion on unmount", async () => {
    vi.useFakeTimers();
    vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new Uint8Array(32).buffer);
    const registration = deferred<Response>();
    let registrationSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrationSignal = init.signal ?? undefined;
        return registration.promise;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    const form = await selectFile(
      container,
      syntheticPdf("unmount.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await flushAsyncWork();
    expect(registrationSignal).toBeDefined();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.unmount());
    expect(registrationSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () =>
      registration.resolve(
        jsonResponse(
          registeredResume(
            "019c0000-0000-7000-8000-000000000130",
            "private-unmounted.pdf",
            "https://storage.example.test/private-unmounted",
          ),
          201,
        ),
      ),
    );
    expect(container.textContent).toBe("");
    root = createRoot(container);
  });

  it("lets a new session own its upload while an aborted prior registration resolves late", async () => {
    const sessionARegistration = deferred<Response>();
    const sessionBRegistration = deferred<Response>();
    const sessionBStorage = deferred<Response>();
    const registrationCalls: RequestInit[] = [];
    const storageUrls: string[] = [];
    let registrationCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/platform/resumes" && (init?.method ?? "GET") === "GET") {
        return jsonResponse(emptyResumes);
      }
      if (input === "/api/platform/resumes" && init?.method === "POST") {
        registrationCalls.push(init);
        registrationCount += 1;
        return registrationCount === 1
          ? sessionARegistration.promise
          : sessionBRegistration.promise;
      }
      if (typeof input === "string" && input.startsWith("https://storage.example.test/")) {
        storageUrls.push(input);
        return sessionBStorage.promise;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await vi.waitFor(() => expect(container.textContent).toContain("No resumes uploaded yet."));
    let form = await selectFile(
      container,
      syntheticPdf("session-a.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
    );
    await act(async () => submit(form));
    await vi.waitFor(() => expect(registrationCalls).toHaveLength(1));
    const sessionASignal = registrationCalls[0]?.signal;
    const sessionAKey = new Headers(registrationCalls[0]?.headers).get("idempotency-key");

    await act(async () => root.render(<ResumeUploadForm authenticated={false} />));
    expect(sessionASignal?.aborted).toBe(true);
    await act(async () => root.render(<ResumeUploadForm authenticated />));
    await vi.waitFor(() => expect(container.textContent).toContain("No resumes uploaded yet."));
    form = await selectFile(
      container,
      syntheticPdf("session-b.pdf", async () => new Uint8Array([4, 5, 6]).buffer),
    );
    await act(async () => submit(form));
    await vi.waitFor(() => expect(registrationCalls).toHaveLength(2));
    const sessionBKey = new Headers(registrationCalls[1]?.headers).get("idempotency-key");
    expect(sessionBKey).not.toBe(sessionAKey);

    await act(async () =>
      sessionARegistration.resolve(
        jsonResponse(
          registeredResume(
            "019c0000-0000-7000-8000-000000000102",
            "session-a.pdf",
            "https://storage.example.test/session-a",
          ),
          201,
        ),
      ),
    );
    await act(async () => {
      submit(form);
      submit(form);
    });
    expect(registrationCalls).toHaveLength(2);
    expect(storageUrls).toHaveLength(0);

    await act(async () =>
      sessionBRegistration.resolve(
        jsonResponse(
          registeredResume(
            "019c0000-0000-7000-8000-000000000103",
            "session-b.pdf",
            "https://storage.example.test/session-b",
          ),
          201,
        ),
      ),
    );
    await vi.waitFor(() => expect(storageUrls).toEqual(["https://storage.example.test/session-b"]));
    await act(async () => sessionBStorage.resolve(new Response(null, { status: 204 })));

    expect(container.textContent).toContain("session-b.pdf");
    expect(container.textContent).not.toContain("session-a.pdf");
    expect(container.textContent).toContain("Resume uploaded to quarantine");
  });
});

function resumeDocument(overrides: Partial<ResumeDocument>): ResumeDocument {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    fileName: "synthetic-resume.pdf",
    mediaType: "application/pdf",
    sizeBytes: 3,
    sha256: "a".repeat(64),
    status: "parsed",
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    ...overrides,
  } as ResumeDocument;
}

describe("resumeUploadGate (ADR-032)", () => {
  const now = Date.parse("2026-09-20T12:10:00.000Z");
  const gate = (documents: ResumeDocument[], limit?: number) =>
    resumeUploadGate(documents, limit, now);

  it("blocks while a resume is uploading, scanning, or parsing, whatever the plan allows", () => {
    for (const status of ["awaiting_upload", "scanning", "parsing"] as const) {
      expect(gate([resumeDocument({ status })], 50), status).toEqual({
        blocked: true,
        message: "Your resume is still being processed. You can upload another when it finishes.",
      });
      expect(gate([resumeDocument({ status })]), status).toMatchObject({ blocked: true });
    }
  });

  it("stops blocking an abandoned upload once its grant and scan margin have passed", () => {
    const abandoned = resumeDocument({
      status: "awaiting_upload",
      createdAt: "2026-09-20T11:54:59.000Z",
    });
    expect(gate([abandoned])).toEqual({ blocked: false });
    const recent = resumeDocument({
      status: "awaiting_upload",
      createdAt: "2026-09-20T11:55:01.000Z",
    });
    expect(gate([recent])).toMatchObject({ blocked: true });
  });

  it("blocks a parsed resume only once the plan's limit is reached", () => {
    const parsed = resumeDocument({ status: "parsed" });
    expect(gate([parsed], 1)).toEqual({
      blocked: true,
      message: "Your plan includes 1 stored resume.",
    });
    expect(gate([parsed], 0)).toEqual({
      blocked: true,
      message: "Your plan includes 0 stored resumes.",
    });
    expect(gate([parsed], 2)).toEqual({ blocked: false });
    const second = resumeDocument({ id: "00000000-0000-7000-8000-000000000002" });
    expect(gate([parsed, second], 2)).toEqual({
      blocked: true,
      message: "Your plan includes 2 stored resumes.",
    });
  });

  it("does not count failed or rejected resumes, and leaves an unknown limit to the server", () => {
    const failed = resumeDocument({ status: "failed", failureCode: "scan_failed" });
    const rejected = resumeDocument({ status: "rejected", failureCode: "malware_detected" });
    expect(gate([failed, rejected], 1)).toEqual({ blocked: false });
    expect(gate([], 1)).toEqual({ blocked: false });
    expect(gate([resumeDocument({ status: "parsed" })], undefined)).toEqual({ blocked: false });
  });
});

describe("ResumeUploadForm upload gate", () => {
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

  async function mount(documents: ResumeDocument[], maxStoredResumes?: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => jsonResponse({ documents })),
    );
    await act(async () =>
      root.render(<ResumeUploadForm authenticated maxStoredResumes={maxStoredResumes} />),
    );
    await flushAsyncWork();
  }
  const controls = () => ({
    input: container.querySelector<HTMLInputElement>('input[type="file"]'),
    button: container.querySelector<HTMLButtonElement>('button[type="submit"]'),
  });

  it("disables the picker and button with the reason while a resume is unfinished", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    for (const status of ["awaiting_upload", "scanning", "parsing"] as const) {
      await mount([resumeDocument({ status, createdAt: recent })], 10);
      const { input, button } = controls();
      expect(input?.disabled, status).toBe(true);
      expect(button?.disabled, status).toBe(true);
      expect(container.textContent, status).toContain(
        "Your resume is still being processed. You can upload another when it finishes.",
      );
      await act(async () => root.render(<div />));
    }
  });

  it("disables upload when the plan's stored-resume limit is reached and says so", async () => {
    await mount([resumeDocument({ status: "parsed" })], 1);
    const { input, button } = controls();
    expect(input?.disabled).toBe(true);
    expect(button?.disabled).toBe(true);
    expect(container.querySelector("form p[role='status']")?.textContent).toBe(
      "Your plan includes 1 stored resume.",
    );
  });

  it("stays available when the limit is larger, unknown, or nothing occupies a slot", async () => {
    await mount([resumeDocument({ status: "parsed" })], 2);
    expect(controls().input?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Your plan includes");
    await act(async () => root.render(<div />));
    await mount([resumeDocument({ status: "parsed" })], undefined);
    expect(controls().input?.disabled).toBe(false);
    await act(async () => root.render(<div />));
    await mount([resumeDocument({ status: "failed", failureCode: "scan_failed" })], 1);
    expect(controls().input?.disabled).toBe(false);
    await act(async () => root.render(<div />));
    await mount([], 1);
    expect(controls().input?.disabled).toBe(false);
  });

  it("shows the server's fixed refusal, without contacting storage, when it decides otherwise", async () => {
    const refusals: Array<[number, string, string]> = [
      [
        409,
        "resume_upload_in_progress",
        "Your resume is still being processed. You can upload another when it finishes.",
      ],
      [409, "resume_document_limit", "Your plan's stored resume limit has been reached."],
      [
        503,
        "entitlement_unavailable",
        "Your plan details are temporarily unavailable. Try uploading again shortly.",
      ],
    ];
    for (const [status, code, copy] of refusals) {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          calls.push(`${init?.method ?? "GET"} ${String(input)}`);
          return init?.method === "POST"
            ? Response.json(
                { code, title: "upstream text never shown", detail: "secret" },
                { status },
              )
            : jsonResponse(emptyResumes);
        }),
      );
      await act(async () => root.render(<ResumeUploadForm authenticated />));
      await flushAsyncWork();
      const form = await selectFile(
        container,
        syntheticPdf("resume.pdf", async () => new Uint8Array([1, 2, 3]).buffer),
      );
      await act(async () => submit(form));
      await flushAsyncWork(40);
      expect(container.textContent, code).toContain(copy);
      expect(container.textContent, code).not.toMatch(/secret|upstream text/);
      expect(
        calls.filter((call) => call.startsWith("POST")),
        code,
      ).toEqual(["POST /api/platform/resumes"]);
      await act(async () => root.render(<div />));
    }
  });
});

describe("ResumeUploadForm delete (ADR-033)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const parsed = resumeDocument({ id: "00000000-0000-7000-8000-000000000011", status: "parsed" });

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

  async function mount(
    documents: ResumeDocument[],
    onDelete: (url: string, init?: RequestInit) => Promise<Response>,
    maxStoredResumes = 1,
    onDocumentDeleted?: () => void,
  ) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (init?.method === "DELETE") return onDelete(String(input), init);
        return jsonResponse({ documents });
      }),
    );
    await act(async () =>
      root.render(
        <ResumeUploadForm
          authenticated
          maxStoredResumes={maxStoredResumes}
          onDocumentDeleted={onDocumentDeleted}
        />,
      ),
    );
    await flushAsyncWork();
    return calls;
  }
  const button = (name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
    );
  const click = async (target: HTMLButtonElement | undefined) => {
    if (!target) throw new Error("expected control is not rendered");
    await act(async () => target.click());
    await flushAsyncWork();
  };

  it("offers deletion only for a resume whose processing has ended", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    for (const status of ["awaiting_upload", "scanning", "parsing"] as const) {
      await mount(
        [resumeDocument({ id: "00000000-0000-7000-8000-000000000012", status, createdAt: recent })],
        async () => new Response(null, { status: 204 }),
      );
      expect(button("Delete synthetic-resume.pdf"), status).toBeUndefined();
      await act(async () => root.render(<div />));
    }
    for (const status of ["parsed", "failed", "rejected"] as const) {
      await mount(
        [
          resumeDocument({
            id: "00000000-0000-7000-8000-000000000013",
            status,
            ...(status === "parsed" ? {} : { failureCode: "scan_failed" as const }),
          }),
        ],
        async () => new Response(null, { status: 204 }),
      );
      expect(button("Delete synthetic-resume.pdf"), status).toBeDefined();
      await act(async () => root.render(<div />));
    }
  });

  it("asks for confirmation first, and cancelling deletes nothing and returns focus to Delete", async () => {
    const calls = await mount([parsed], async () => new Response(null, { status: 204 }));
    await click(button("Delete synthetic-resume.pdf"));
    expect(container.textContent).toContain(
      "Delete synthetic-resume.pdf? Facts you already reviewed stay in your profile. Suggestions you have not reviewed are removed.",
    );
    expect(window.document.activeElement?.textContent).toBe("Cancel");
    await click(button("Cancel"));
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
    expect(container.textContent).not.toContain("Confirm delete");
    expect(window.document.activeElement).toBe(button("Delete synthetic-resume.pdf"));
  });

  it("deletes after confirmation, frees the upload, announces it, and moves focus to the picker", async () => {
    const calls = await mount([parsed], async () => new Response(null, { status: 204 }));
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    await click(button("Delete synthetic-resume.pdf"));
    await click(button("Confirm delete"));
    expect(calls.filter((call) => call.startsWith("DELETE"))).toEqual([
      `DELETE /api/platform/resumes/${parsed.id}`,
    ]);
    expect(container.textContent).toContain("No resumes uploaded yet.");
    expect(container.querySelector("output")?.textContent).toBe(
      "Resume deleted. You can upload a new one.",
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.disabled).toBe(false);
    expect(window.document.activeElement).toBe(input);
    expect(container.textContent).not.toContain("Your plan includes");
  });

  it("tells the page once after a delete so the review list drops the suggestions, and never on a refusal", async () => {
    const deleted = vi.fn();
    await mount([parsed], async () => new Response(null, { status: 204 }), 1, deleted);
    await click(button("Delete synthetic-resume.pdf"));
    await click(button("Confirm delete"));
    expect(deleted).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div />));

    const refused = vi.fn();
    await mount(
      [parsed],
      async () => Response.json({ code: "resume_not_deletable" }, { status: 409 }),
      1,
      refused,
    );
    await click(button("Delete synthetic-resume.pdf"));
    await click(button("Confirm delete"));
    expect(refused).not.toHaveBeenCalled();
  });

  it("shows fixed copy, keeps the resume listed, and never echoes upstream text when the server refuses", async () => {
    const refusals: Array<[number, string, string]> = [
      [
        409,
        "resume_not_deletable",
        "This resume is still being processed. You can delete it when processing finishes.",
      ],
      [503, "platform_unavailable", "Resume processing is temporarily unavailable."],
    ];
    for (const [status, code, copy] of refusals) {
      await mount([parsed], async () =>
        Response.json({ code, title: "upstream text never shown", detail: "secret" }, { status }),
      );
      await click(button("Delete synthetic-resume.pdf"));
      await click(button("Confirm delete"));
      expect(container.textContent, code).toContain(copy);
      expect(container.textContent, code).not.toMatch(/secret|upstream text/);
      expect(container.textContent, code).toContain("synthetic-resume.pdf");
      expect(button("Delete synthetic-resume.pdf"), code).toBeDefined();
      await act(async () => root.render(<div />));
    }
  });

  it("gives up on a stalled delete at 20 seconds with fixed copy and lets the candidate retry", async () => {
    vi.useFakeTimers();
    await mount(
      [parsed],
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await click(button("Delete synthetic-resume.pdf"));
    await click(button("Confirm delete"));
    expect(button("Deleting…")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await flushAsyncWork();
    expect(container.textContent).toContain(
      "Deleting the resume timed out. Check your resumes and try again.",
    );
    expect(button("Delete synthetic-resume.pdf")?.disabled).toBe(false);
  });
});
