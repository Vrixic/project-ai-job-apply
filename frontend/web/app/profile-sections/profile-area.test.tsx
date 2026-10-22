// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileArea } from "./profile-area";

const at = "2026-10-22T12:00:00.000Z";
const skillId = "019d04cf-1f80-7000-8000-000000000011";
const draftId = "019d04cf-1f80-7000-8000-000000000012";
const importId = "019d04cf-1f80-7000-8000-000000000013";

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

let root: Root;
let container: HTMLDivElement;
let calls: Call[];
let skills: Array<Record<string, unknown>>;
let drafts: Array<Record<string, unknown>>;

function skill(name: string, version = 1) {
  return {
    id: skillId,
    name,
    version,
    origin: "entered",
    displayOrder: 0,
    createdAt: at,
    updatedAt: at,
  };
}

function respond(method: string, path: string, body: unknown): Response {
  if (method === "GET" && path === "/api/platform/profile/import-drafts") {
    return Response.json({ drafts });
  }
  if (method === "GET" && path === "/api/platform/profile/personal") {
    return Response.json({ code: "not_found" }, { status: 404 });
  }
  if (method === "GET" && path === "/api/platform/profile/skill-entries") {
    return Response.json({ entries: skills });
  }
  if (method === "POST" && path === "/api/platform/profile/skill-entries") {
    skills = [skill((body as { name: string }).name)];
    return Response.json(skills[0], { status: 201 });
  }
  if (method === "DELETE" && path.startsWith(`/api/platform/profile/skill-entries/${skillId}`)) {
    skills = [];
    return new Response(null, { status: 204 });
  }
  if (method === "POST" && path === `/api/platform/profile/import-drafts/${draftId}/save`) {
    drafts = [];
    skills = [skill("Go")];
    return Response.json({ section: "skill", entryId: skillId, version: 1 }, { status: 201 });
  }
  return Response.json({ code: "not_found" }, { status: 404 });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("React", React);
  skills = [];
  drafts = [
    {
      id: draftId,
      importId,
      section: "skill",
      values: { name: "Go" },
      createdAt: at,
    },
  ];
  calls = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const [path = ""] = String(input).split("?");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({
      method,
      path: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    });
    return respond(method, path, body);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const render = async () => {
  await act(async () =>
    root.render(
      <ProfileArea authenticated name="Synthetic Person" preferences={<p>Preferences panel</p>} />,
    ),
  );
  await flush();
};
const buttonNamed = (name: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const click = async (name: string) => {
  await act(async () => buttonNamed(name).click());
  await flush();
};

describe("ProfileArea", () => {
  it("shows one tab per section, a resume-import banner and only the selected panel", async () => {
    await render();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs.map((text) => text?.replace(/ \(.*\)/u, ""))).toEqual([
      "Personal",
      "Education",
      "Work experience",
      "Skills",
      "Application answers",
      "Resume",
      "Job preferences",
    ]);
    expect(container.textContent).toContain(
      "1 detail found in your resume is waiting for your review.",
    );
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Personal",
    );
    await click("Job preferences");
    expect(container.textContent).toContain("Preferences panel");
  });

  it("adds a skill with a versioned, idempotent request and deletes it only after confirming", async () => {
    await render();
    await click("Skills (1 to review)");
    await click("Add skill");
    const input = container.querySelector<HTMLInputElement>('input[name="name"]');
    if (!input) throw new Error("expected the skill field");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "TypeScript",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Add skill");
    const created = calls.find(
      (call) => call.method === "POST" && call.path.endsWith("/skill-entries"),
    );
    expect(created?.body).toEqual({ name: "TypeScript" });
    expect(created?.headers["idempotency-key"]).toMatch(/^profile-/u);
    expect(container.textContent).toContain("TypeScript");

    await click("Delete TypeScript");
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    await click("Confirm delete TypeScript");
    const deleted = calls.find((call) => call.method === "DELETE");
    expect(deleted?.path).toBe(`/api/platform/profile/skill-entries/${skillId}?expectedVersion=1`);
    expect(container.textContent).toContain("No skills saved yet.");
  });

  it("keeps a resume suggestion out of the profile until it is saved", async () => {
    await render();
    await click("Skills (1 to review)");
    expect(container.textContent).toContain("Found in your resume");
    expect(container.textContent).toContain("No skills saved yet.");
    await click("Save");
    const saved = calls.find((call) => call.path.endsWith("/save"));
    expect(saved?.body).toEqual({});
    expect(container.textContent).not.toContain("Found in your resume");
    expect(container.textContent).toContain("Go");
  });
});
