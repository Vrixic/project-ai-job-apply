// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENING_QUESTIONS } from "../../lib/screening-questions";
import { ScreeningSection } from "./screening-section";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-11-05T12:00:00.000Z";
const [authorized] = SCREENING_QUESTIONS;
const record = (answer: string) => ({
  id: "00000000-0000-7000-8000-000000000011",
  question: authorized.question,
  answer,
  version: 1,
  origin: "entered",
  createdAt: NOW,
  updatedAt: NOW,
  questionKey: authorized.question.toLowerCase(),
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let root: Root;
let container: HTMLElement;
let saved: ReturnType<typeof record> | undefined;
const requests: Array<{ method: string; body: unknown }> = [];

beforeEach(() => {
  saved = undefined;
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return json({ answers: saved ? [saved] : [] });
      const body = JSON.parse(String(init?.body));
      requests.push({ method, body });
      saved = record(body.answer);
      return json(saved, method === "POST" ? 201 : 200);
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ScreeningSection authenticated />));
}
async function choose(index: number, value: string) {
  const select = container.querySelectorAll("select")[index] as HTMLSelectElement;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ScreeningSection", () => {
  it("asks each screening question with no answer chosen", async () => {
    await render();
    const selects = Array.from(container.querySelectorAll("select"));
    expect(selects).toHaveLength(SCREENING_QUESTIONS.length);
    expect(selects.map((select) => select.value)).toEqual(["", ""]);
    for (const item of SCREENING_QUESTIONS) expect(container.textContent).toContain(item.question);
  });
  it("saves a choice as an ordinary saved answer, then updates it on a change", async () => {
    await render();
    await choose(0, "Yes");
    expect(requests).toEqual([
      { method: "POST", body: { question: authorized.question, answer: "Yes" } },
    ]);
    expect(container.textContent).toContain("Saved.");
    expect((container.querySelectorAll("select")[0] as HTMLSelectElement).value).toBe("Yes");
    await choose(0, "No");
    expect(requests.at(-1)).toMatchObject({
      method: "PATCH",
      body: { answer: "No", expectedVersion: 1 },
    });
  });
  it("says when a choice did not save", async () => {
    await render();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ code: "x" }, 500)),
    );
    await choose(1, "No");
    expect(container.textContent).toContain("That did not save.");
  });
});
