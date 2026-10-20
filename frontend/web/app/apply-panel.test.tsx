// @vitest-environment jsdom

import type { Application } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyPanel, type ExtensionHandoffState, safeApplyUrl } from "./apply-panel";

const APP = "00000000-0000-7000-8000-000000000001";
const HASH = "a".repeat(64);
const AT = "2026-10-20T12:00:00.000Z";

const uploadedField = {
  fieldKey: "documents.resume",
  value: HASH,
  origin: "confirmed_fact",
  sourceFactIds: ["00000000-0000-7000-8000-000000000030"],
  confidence: 1,
  disposition: "review",
  reasons: ["explicit_each_time"],
  requiresReview: true,
};

function approved(overrides: { generated?: boolean; fields?: unknown[] } = {}): Application {
  const material = {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: "00000000-0000-7000-8000-000000000020",
    version: 1,
    contentSha256: HASH,
    completedAtMs: Date.now() - 60_000,
    expiresAtMs: Date.now() - 60_000 + 1_800_000,
  };
  return {
    id: APP,
    canonicalJobId: "00000000-0000-7000-8000-000000000002",
    status: "approved",
    revision: 3,
    currentAction: "ready_to_submit",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: HASH,
      jobRevision: HASH,
      artifactHashes: { resume: HASH },
      ...(overrides.generated ? { temporaryMaterials: [material] } : {}),
      fields: overrides.fields ?? [
        {
          fieldKey: "contact.email",
          value: "candidate@example.test",
          origin: "confirmed_fact",
          sourceFactIds: [],
          confidence: 0.99,
          disposition: "auto",
          reasons: [],
          requiresReview: false,
        },
        {
          fieldKey: "job.notice_period",
          value: "2 weeks",
          origin: "user_entered",
          sourceFactIds: [],
          confidence: 1,
          disposition: "review",
          reasons: [],
          requiresReview: true,
        },
        ...(overrides.generated ? [] : [uploadedField]),
      ],
      createdAt: AT,
    },
  } as unknown as Application;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(props: Partial<Parameters<typeof ApplyPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <ApplyPanel
        application={approved()}
        applyUrl="https://boards.example.test/jobs/1"
        onRecordSubmission={() => undefined}
        {...props}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

describe("safeApplyUrl", () => {
  it("offers only a plain https link", () => {
    expect(safeApplyUrl("https://boards.example.test/jobs/1")).toBe(
      "https://boards.example.test/jobs/1",
    );
    for (const unsafe of [
      undefined,
      "",
      "javascript:alert(1)",
      "http://boards.example.test/jobs/1",
      "https://user:pass@boards.example.test/jobs/1",
      "not a url",
    ])
      expect(safeApplyUrl(unsafe)).toBeUndefined();
  });
});

function dialog(): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

describe("ApplyPanel", () => {
  it("is minimal: a heading, the employer link and one record action", async () => {
    await mount();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://boards.example.test/jobs/1");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).not.toMatch(
      /Stop waiting|different resume|review link|copy by hand|Record what happened|DOCX|Download Word/iu,
    );
    expect(dialog()).toBeNull();
  });

  it("says so plainly when there is no safe link", async () => {
    await mount({ applyUrl: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("We do not have a safe link");
  });

  it.each([
    ["armed", "uploaded resume", approved()],
    ["armed", "generated resume (PDF)", approved({ generated: true })],
    ["waiting_for_extension", "generated resume (PDF)", approved({ generated: true })],
    ["resume_sent", "generated resume (PDF)", approved({ generated: true })],
  ] as const)(
    "tells the candidate which resume the extension will use (%s)",
    async (phase, copy, application) => {
      await mount({ application, handoff: { phase } as ExtensionHandoffState });
      expect(container.querySelector("[role=status]")?.textContent).toContain(copy);
    },
  );

  it("falls back to a plain instruction when the extension did not answer", async () => {
    await mount({ handoff: { phase: "unavailable" } });
    expect(container.textContent).toContain("The extension did not answer");
  });

  it("shows a generated resume that expired, with no employer link or record action", async () => {
    const application = approved({ generated: true });
    const material = application.currentPacket?.temporaryMaterials?.[0];
    if (!material) throw Error("Missing fixture material");
    material.completedAtMs = Date.now() - 3_600_000;
    material.expiresAtMs = material.completedAtMs + 1_800_000;
    await mount({ application, handoff: { phase: "armed" } });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "generated resume expired",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(button("Record submission").disabled).toBe(true);
  });

  it("opens recording in a dialog and records the outcome in that one step", async () => {
    const onRecordSubmission = vi.fn(async () => undefined);
    await mount({ onRecordSubmission });
    await act(async () => button("Record submission").click());
    const open = dialog();
    expect(open?.getAttribute("aria-modal")).toBe("true");
    expect(open?.textContent).toContain("Did you submit the application");
    expect(onRecordSubmission).not.toHaveBeenCalled();
    await act(async () => button("It was not submitted").click());
    expect(onRecordSubmission).toHaveBeenCalledWith({
      outcome: "not_submitted",
      observation: undefined,
    });
    expect(dialog()).toBeNull();
    await act(async () => button("Record submission").click());
    await act(async () => button("I submitted it").click());
    expect(onRecordSubmission).toHaveBeenLastCalledWith({
      outcome: "submitted",
      observation: undefined,
    });
  });

  it.each(["takeover", "reconciliation_required"] as const)(
    "asks only for the outcome once an attempt is open (%s)",
    async (status) => {
      const application = { ...approved({ generated: true }), status } as Application;
      const material = application.currentPacket?.temporaryMaterials?.[0];
      if (!material) throw Error("Missing fixture material");
      // An expired generated resume no longer matters: nothing is attached any more.
      material.completedAtMs = Date.now() - 3_600_000;
      material.expiresAtMs = material.completedAtMs + 1_800_000;
      const onRecordSubmission = vi.fn(async () => undefined);
      await mount({ application, onRecordSubmission });
      expect(button("Record submission").disabled).toBe(false);
      expect(container.textContent).not.toContain("generated resume expired");
      await act(async () => button("Record submission").click());
      await act(async () => button("I submitted it").click());
      expect(onRecordSubmission).toHaveBeenCalledOnce();
    },
  );

  it("closes the dialog with Cancel or Escape and returns focus to the trigger", async () => {
    await mount();
    await act(async () => button("Record submission").click());
    await act(async () => button("Cancel").click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button("Record submission"));
    await act(async () => button("Record submission").click());
    await act(async () => {
      dialog()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it("shows fixed copy in the dialog when recording cannot start", async () => {
    await mount({
      onRecordSubmission: async () => {
        throw new Error("SECRET upstream detail");
      },
    });
    await act(async () => button("Record submission").click());
    await act(async () => button("I submitted it").click());
    expect(dialog()?.querySelector("[role=status]")?.textContent).toContain(
      "That did not go through",
    );
    expect(container.textContent).not.toContain("SECRET");
  });

  it("renders nothing for a withheld packet", async () => {
    const application = approved();
    (application as { packetAvailability?: string }).packetAvailability = "withheld";
    await mount({ application });
    expect(container.textContent).toBe("");
  });

  it("still asks for the outcome of an open attempt when the packet is withheld", async () => {
    const application = { ...approved(), status: "takeover" } as Application;
    (application as { packetAvailability?: string }).packetAvailability = "withheld";
    await mount({ application });
    expect(container.querySelector("a")).toBeNull();
    await act(async () => button("Record submission").click());
    expect(button("I submitted it").disabled).toBe(false);
  });

  it("has no automated accessibility violations, closed or open", async () => {
    await mount({ handoff: { phase: "armed" } });
    const rules = { rules: { "color-contrast": { enabled: false } } };
    expect((await axe.run(container, rules)).violations.map((v) => v.id)).toEqual([]);
    await act(async () => button("Record submission").click());
    expect((await axe.run(container, rules)).violations.map((v) => v.id)).toEqual([]);
  });
});

it("requires a fresh explicit form match before recording a form-bound approved packet", async () => {
  const application = approved();
  if (!application.currentPacket) throw new Error("Missing fixture packet");
  application.currentPacket.form = {
    adapterId: "generic-assisted-v1",
    variantId: "generic",
    formHash: HASH,
  };
  const record = vi.fn();
  await mount({ application, onRecordSubmission: record });
  await act(async () => button("Record submission").click());
  expect(button("I submitted it").disabled).toBe(true);
  expect(button("It was not submitted").disabled).toBe(true);
  await act(async () => button("I submitted it").click());
  expect(record).not.toHaveBeenCalled();
  expect(dialog()?.textContent).toContain("Before submitting on the employer site");
});
