// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestrictedAnswersForm } from "./restricted-answers-form";

const metadata = {
  id: "019b4e12-7ea3-7c36-9357-aea35ab542d3",
  fieldKey: "authorization.us_authorized",
  valueType: "boolean",
  sensitivity: "restricted",
  state: "active",
  version: 1,
  confirmedAt: "2026-09-29T12:00:00.000Z",
} as const;

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function select(container: HTMLElement, label: string): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const match = labels.find((candidate) => candidate.textContent?.startsWith(label));
  const control = match?.querySelector("select");
  if (!(control instanceof HTMLSelectElement)) throw new Error(`Missing select: ${label}`);
  return control;
}

function setSelect(control: HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

describe("RestrictedAnswersForm", () => {
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
    vi.useRealTimers();
  });

  it("renders metadata only and never asks the API to return a saved value", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        answers: [{ ...metadata, context: "jurisdiction.us" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<RestrictedAnswersForm authenticated />));
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/platform/restricted-answers", {
      signal: expect.any(AbortSignal),
    });
    expect(container.textContent).toContain("Authorized to work in the United States");
    expect(container.textContent).toContain("Context: jurisdiction.us");
    expect(container.textContent).toContain("Values are separately encrypted");
    expect(container.textContent).not.toContain("synthetic-private-answer");
  });

  it("requires explicit save confirmation and sends the fixed type, sensitivity, and provenance", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ answers: [] }))
      .mockResolvedValueOnce(Response.json(metadata));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<RestrictedAnswersForm authenticated />));
    await act(async () => {});
    const question = select(container, "Restricted question");
    await act(async () => setSelect(question, metadata.fieldKey));
    const answer = select(container, "Answer");
    await act(async () => setSelect(answer, "true"));
    const save = button(container, "Save restricted answer");
    expect(save.disabled).toBe(true);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      if (!confirmation) throw new Error("Missing confirmation");
      confirmation.click();
    });
    expect(save.disabled).toBe(false);

    await act(async () => save.closest("form")?.requestSubmit());

    const [path, init] = fetchMock.mock.calls[1] ?? [];
    if (!init) throw new Error("Missing save request");
    expect(path).toBe(`/api/platform/restricted-answers/${metadata.fieldKey}`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toMatch(
      /^restricted-answer-/,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      expectedVersion: 0,
      valueType: "boolean",
      value: "true",
      sensitivity: "restricted",
      sourceReference: "candidate.settings",
    });
    expect(container.textContent).toContain("Its value is encrypted and is not displayed again.");
    expect(answer.value).toBe("");
  });

  it("reuses the exact idempotency intent after an ambiguous timeout", async () => {
    vi.useFakeTimers();
    const stalled = deferredResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ answers: [] }))
      .mockImplementationOnce(() => stalled.promise)
      .mockResolvedValueOnce(Response.json(metadata));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<RestrictedAnswersForm authenticated />));
    await act(async () => {});
    await act(async () => setSelect(select(container, "Restricted question"), metadata.fieldKey));
    await act(async () => setSelect(select(container, "Answer"), "false"));
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    const form = button(container, "Save restricted answer").closest("form");
    await act(async () => form?.requestSubmit());
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(container.textContent).toContain("Saving timed out");

    await act(async () => form?.requestSubmit());

    const first = fetchMock.mock.calls[1]?.[1];
    const second = fetchMock.mock.calls[2]?.[1];
    if (!first || !second) throw new Error("Missing retry requests");
    expect(second.body).toBe(first.body);
    expect((second.headers as Record<string, string>)["idempotency-key"]).toBe(
      (first.headers as Record<string, string>)["idempotency-key"],
    );
    stalled.resolve(Response.json(metadata));
  });

  it("deletes an exact field and context, then reloads tombstone metadata", async () => {
    const contextual = { ...metadata, context: "jurisdiction.us" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ answers: [contextual] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({ answers: [{ ...contextual, state: "deleted", version: 2 }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<RestrictedAnswersForm authenticated />));
    await act(async () => {});
    await act(async () => button(container, "Delete").click());

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/platform/restricted-answers/${metadata.fieldKey}?context=jurisdiction.us`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/platform/restricted-answers");
    expect(container.textContent).toContain("Restricted answer deleted.");
    expect(container.textContent).toContain("No restricted answers are saved.");
  });

  it("fails closed on malformed upstream metadata without rendering private fields", async () => {
    const privateCanary = "synthetic-private-answer-never-render";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({
          answers: [{ ...metadata, value: privateCanary }],
        }),
      ),
    );

    await act(async () => root.render(<RestrictedAnswersForm authenticated />));
    await act(async () => {});

    expect(container.textContent).toContain("Restricted answers are temporarily unavailable.");
    expect(container.textContent).not.toContain(privateCanary);
  });
});
