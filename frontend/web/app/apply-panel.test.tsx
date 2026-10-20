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
        onRecordManualSubmission={() => undefined}
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

describe("ApplyPanel", () => {
  it("opens the employer's page in a new tab and leaves submission to the candidate", async () => {
    await mount();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://boards.example.test/jobs/1");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("confirm sensitive answers and the final submit");
    expect(container.textContent).not.toMatch(/applied successfully|Download Word|DOCX/iu);
  });

  it("says so plainly when there is no safe link", async () => {
    await mount({ applyUrl: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("We do not have a safe link");
  });

  it.each([
    ["armed", "uploaded resume", approved()],
    ["armed", "generated resume (PDF)", approved({ generated: true })],
    ["waiting_for_extension", "Waiting for you", approved({ generated: true })],
  ] as const)(
    "tells the candidate which resume the extension will use (%s)",
    async (phase, copy, application) => {
      await mount({ application, handoff: { phase } as ExtensionHandoffState });
      expect(container.querySelector("[role=status]")?.textContent).toContain(copy);
      expect(container.textContent).toContain("it already knows this application");
    },
  );

  it("confirms the generated resume reached the extension", async () => {
    await mount({ application: approved({ generated: true }), handoff: { phase: "resume_sent" } });
    expect(container.textContent).toContain("Your generated resume reached the extension");
  });

  it("lets the candidate stop waiting for the extension", async () => {
    const stop = vi.fn();
    await mount({
      application: approved({ generated: true }),
      handoff: { phase: "waiting_for_extension" },
      onStopWaiting: stop,
    });
    await act(async () => button("Stop waiting for the extension").click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("falls back to the manual path when the extension did not answer", async () => {
    await mount({ handoff: { phase: "unavailable" } });
    expect(container.textContent).toContain("The extension did not answer");
    expect(container.textContent).toContain("Your answers, to copy by hand");
  });

  it("shows a generated resume that expired and offers no employer link", async () => {
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
    expect(button("Record submission status").disabled).toBe(true);
  });

  it("lists the approved answers and copies one on request", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mount();
    expect(container.textContent).toContain("Contact email:");
    expect(container.textContent).toContain("candidate@example.test");
    expect(container.textContent).not.toContain("Documents resume");
    await act(async () => {
      button("Copy Contact email").click();
    });
    expect(writeText).toHaveBeenCalledWith("candidate@example.test");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Contact email copied.");
  });

  it("explains a blocked clipboard instead of failing silently", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    await mount();
    await act(async () => {
      button("Copy Contact email").click();
    });
    expect(container.querySelector("[role=status]")?.textContent).toContain(
      "did not allow copying",
    );
  });

  it("never offers an unresolved answer as the literal text null", async () => {
    const application = approved();
    application.currentPacket?.fields.push({
      fieldKey: "questions.why_company",
      value: null,
      origin: "confirmed_fact",
      sourceFactIds: [],
      confidence: 0.4,
      disposition: "user_action",
      reasons: ["unsupported_value"],
      requiresReview: true,
    });
    await mount({ application });
    expect(container.textContent).not.toContain("null");
  });

  it("begins the candidate confirmation flow only on explicit request", async () => {
    const onRecordManualSubmission = vi.fn(async () => undefined);
    await mount({ onRecordManualSubmission });
    expect(container.textContent).toContain("whether the application was submitted");
    expect(onRecordManualSubmission).not.toHaveBeenCalled();
    await act(async () => {
      button("Record submission status").click();
    });
    expect(onRecordManualSubmission).toHaveBeenCalledOnce();
  });

  it("shows fixed copy when recording cannot start", async () => {
    await mount({
      onRecordManualSubmission: async () => {
        throw new Error("SECRET upstream detail");
      },
    });
    await act(async () => {
      button("Record submission status").click();
    });
    expect(container.querySelector("[role=status]")?.textContent).toContain(
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

  it("has no automated accessibility violations", async () => {
    await mount({ handoff: { phase: "armed" } });
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
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
  await mount({ application, onRecordManualSubmission: record });
  expect(button("Record submission status").disabled).toBe(true);
  await act(async () => button("Record submission status").click());
  expect(record).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Before submitting on the employer site");
});

it("displays and copies an approved false answer as No during manual Apply", async () => {
  const application = approved();
  if (!application.currentPacket) throw new Error("Missing fixture packet");
  application.currentPacket.fields.push({
    fieldKey: "authorization.us_authorized",
    value: false,
    origin: "user_entered",
    sourceFactIds: [],
    confidence: 1,
    disposition: "review",
    reasons: [],
    requiresReview: true,
  });
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount({ application });
  expect(container.textContent).toContain("Authorization us authorized: No");
  await act(async () => button("Copy Authorization us authorized").click());
  expect(writeText).toHaveBeenCalledWith("No");
});
