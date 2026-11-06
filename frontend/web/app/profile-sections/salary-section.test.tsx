// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SALARY_QUESTION } from "../../lib/salary-expectation";
import { SalarySection } from "./salary-section";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-11-06T12:00:00.000Z";
const record = (answer: string) => ({
  id: "00000000-0000-7000-8000-000000000021",
  question: SALARY_QUESTION,
  answer,
  version: 1,
  origin: "entered",
  createdAt: NOW,
  updatedAt: NOW,
  questionKey: SALARY_QUESTION.toLowerCase(),
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let root: Root;
let container: HTMLElement;
let saved: ReturnType<typeof record> | undefined;
const requests: Array<{ method: string; body: unknown }> = [];
const onSaved = vi.fn();

beforeEach(() => {
  saved = undefined;
  requests.length = 0;
  onSaved.mockClear();
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

const input = () => container.querySelector("input") as HTMLInputElement;
async function render() {
  await act(async () => root.render(<SalarySection authenticated onSaved={onSaved} />));
}
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Save salary"),
  );
  await act(async () => button?.click());
}

describe("SalarySection", () => {
  it("explains how the salary is used and starts empty", async () => {
    await render();
    expect(input().value).toBe("");
    expect(container.textContent).toContain("Desired annual salary (US dollars)");
    expect(container.textContent).toContain("a list of ranges gets the range that holds it");
    expect(container.textContent).toContain("hourly rate or another currency are left to you");
  });

  it("saves the number as an ordinary saved answer, then updates it", async () => {
    await render();
    await type("$130,000");
    await save();
    expect(requests).toEqual([
      { method: "POST", body: { question: SALARY_QUESTION, answer: "130000" } },
    ]);
    expect(container.textContent).toContain("Saved.");
    expect(container.textContent).toContain("Currently saved: $130,000 a year.");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(input().value).toBe("130000");
    await type("140k");
    await save();
    expect(requests.at(-1)).toMatchObject({
      method: "PATCH",
      body: { answer: "140000", expectedVersion: 1 },
    });
  });

  it("shows the salary that is already saved", async () => {
    saved = record("125000");
    await render();
    expect(input().value).toBe("125000");
    expect(container.textContent).toContain("Currently saved: $125,000 a year.");
  });

  it.each(["", "abc", "12", "1.5 million", "-5000", "999999999"])(
    "refuses %j without saving it",
    async (value) => {
      await render();
      await type(value);
      await save();
      expect(requests).toEqual([]);
      expect(container.textContent).toContain("Enter your desired annual salary in whole dollars");
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it("says when it did not save", async () => {
    await render();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ code: "x" }, 500)),
    );
    await type("120000");
    await save();
    expect(container.textContent).toContain("That did not save.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
