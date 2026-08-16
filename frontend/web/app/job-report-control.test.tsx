// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobReportControl } from "./job-report-control";

const JOB_ID = "019d04cf-1f80-7000-8000-000000000012";

function jsonResponse(body: unknown, status = 201): Response {
  return Response.json(body, {
    status,
    headers: {
      "content-type": status === 201 ? "application/json" : "application/problem+json",
    },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function selectValue(container: HTMLElement, value: string) {
  const select = container.querySelector("select");
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select?.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit(container: HTMLElement) {
  container
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("JobReportControl", () => {
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

  it("offers labelled fixed reasons and submits only the exact reason with an idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobReportControl jobId={JOB_ID} />));
    const select = container.querySelector("select");
    expect(select?.labels?.[0]?.textContent).toContain("Issue");
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      "",
      "job_closed",
      "job_not_found",
      "job_inaccurate",
      "suspected_scam",
      "duplicate_listing",
      "other_catalog_issue",
    ]);

    await act(async () => selectValue(container, "suspected_scam"));
    await act(async () => submit(container));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe(`/api/platform/jobs/${JOB_ID}/reports`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"reason":"suspected_scam"}');
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("idempotency-key")).toMatch(/^job-report-[0-9a-f-]{36}$/);
    expect(String(init?.body)).not.toMatch(/owner|detail|text/i);
    expect(container.querySelector('output[aria-live="polite"]')?.textContent).toContain(
      "does not automatically change",
    );
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true,
    );
  });

  it("prevents duplicate pending submission", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobReportControl jobId={JOB_ID} />));
    await act(async () => selectValue(container, "job_closed"));
    await act(async () => {
      submit(container);
      submit(container);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      "Reporting…",
    );
    await act(async () => pending.resolve(jsonResponse({ accepted: true })));
  });

  it("reuses one key for an ambiguous retry and rotates it after the reason changes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("ambiguous network failure"))
      .mockRejectedValueOnce(new TypeError("ambiguous network failure"))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<JobReportControl jobId={JOB_ID} />));
    await act(async () => selectValue(container, "job_closed"));
    await act(async () => submit(container));
    expect(container.textContent).toContain("Retry to safely check the same report");
    await act(async () => submit(container));
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("idempotency-key")).toBe(firstHeaders.get("idempotency-key"));

    await act(async () => selectValue(container, "duplicate_listing"));
    await act(async () => submit(container));
    const changedHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(changedHeaders.get("idempotency-key")).not.toBe(firstHeaders.get("idempotency-key"));
  });

  it("treats an existing report as terminal without implying catalog suppression", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            type: "urn:ai-job-apply:problem:job_already_reported",
            title: "Job already reported",
            status: 409,
            code: "job_already_reported",
            traceId: "trace-1",
          },
          409,
        ),
      ),
    );
    await act(async () => root.render(<JobReportControl jobId={JOB_ID} />));
    await act(async () => selectValue(container, "job_inaccurate"));
    await act(async () => submit(container));
    expect(container.textContent).toContain("already reported");
    expect(container.textContent).toContain("do not automatically remove");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.textContent).toBe(
      "Reported",
    );
  });

  it("aborts on unmount and discards stale completion", async () => {
    const pending = deferredResponse();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return pending.promise;
      }),
    );
    await act(async () => root.render(<JobReportControl jobId={JOB_ID} />));
    await act(async () => selectValue(container, "job_not_found"));
    await act(async () => submit(container));
    await act(async () => root.render(null));
    expect(observedSignal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ accepted: true })));
    expect(container.textContent).toBe("");
  });
});
