// @vitest-environment jsdom

import type { ResumeDocument } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeUploadForm } from "./resume-upload-form";

const emptyResumes = { documents: [] };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    vi.unstubAllGlobals();
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
