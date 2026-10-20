// @vitest-environment jsdom

import type { Application } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import {
  acknowledgementsForApply,
  applyBlockers,
  canApply,
  explicitReviewFields,
  reviewGroups,
} from "./application-review-state";

const APP = "00000000-0000-7000-8000-000000000001";
const HASH = "a".repeat(64);
const AT = "2026-10-20T12:00:00.000Z";

type Field = Record<string, unknown>;

const resumeField: Field = {
  fieldKey: "documents.resume",
  value: HASH,
  origin: "generated",
  sourceFactIds: [],
  confidence: 1,
  disposition: "review",
  reasons: ["explicit_each_time", "generated_content"],
  requiresReview: true,
};
const sensitiveField: Field = {
  fieldKey: "authorization.work_in_country",
  value: true,
  origin: "user_entered",
  sourceFactIds: [],
  confidence: 1,
  disposition: "review",
  reasons: ["restricted_answer", "never_infer"],
  requiresReview: true,
};
const emptyField: Field = {
  fieldKey: "questions.why_company",
  value: null,
  origin: "confirmed_fact",
  sourceFactIds: [],
  confidence: 0.5,
  disposition: "user_action",
  reasons: ["unsupported_value"],
  requiresReview: true,
};
const autoField: Field = {
  fieldKey: "contact.email",
  value: "candidate@example.test",
  origin: "confirmed_fact",
  sourceFactIds: ["00000000-0000-7000-8000-000000000010"],
  confidence: 1,
  disposition: "auto",
  reasons: [],
  requiresReview: false,
};

function application(fields: Field[], overrides: Partial<Application> = {}): Application {
  return {
    id: APP,
    canonicalJobId: "00000000-0000-7000-8000-000000000002",
    status: "review_required",
    revision: 2,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: HASH,
      jobRevision: HASH,
      artifactHashes: { resume: HASH },
      fields,
      createdAt: AT,
    },
    ...overrides,
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

function actions() {
  return {
    onProvideEntry: vi.fn<ApplicationReviewActions["onProvideEntry"]>(),
    onReconcile: vi.fn<ApplicationReviewActions["onReconcile"]>(),
  };
}

async function render(
  app: Application,
  handlers = actions(),
  acknowledged: ReadonlySet<string> = new Set(),
  onToggle: (fieldKey: string) => void = () => undefined,
) {
  await act(async () =>
    root.render(
      <ApplicationReviewPanel
        application={app}
        actions={handlers}
        acknowledged={acknowledged}
        onToggle={onToggle}
      />,
    ),
  );
  return handlers;
}

describe("review state for Apply", () => {
  it("never asks the candidate to confirm the resume binding one more time", () => {
    const groups = reviewGroups(application([resumeField, autoField]));
    expect(explicitReviewFields(groups)).toEqual([]);
    expect(canApply(groups, new Set())).toBe(true);
    expect(applyBlockers(groups, new Set())).toEqual([]);
    // The server still requires every reviewable field to be acknowledged, resume included.
    expect(acknowledgementsForApply(groups, new Set())).toEqual(["documents.resume"]);
  });

  it("keeps sensitive answers explicit and unresolved answers blocking", () => {
    const groups = reviewGroups(application([resumeField, sensitiveField, emptyField]));
    expect(explicitReviewFields(groups).map((field) => field.fieldKey)).toEqual([
      "authorization.work_in_country",
    ]);
    expect(canApply(groups, new Set())).toBe(false);
    expect(applyBlockers(groups, new Set())).toEqual([
      "1 answer(s) still need your input.",
      "1 answer(s) still need your check.",
    ]);
    const filled = reviewGroups(application([resumeField, sensitiveField]));
    expect(canApply(filled, new Set(["authorization.work_in_country"]))).toBe(true);
    expect(acknowledgementsForApply(filled, new Set())).toEqual(["documents.resume"]);
    expect(acknowledgementsForApply(filled, new Set(["authorization.work_in_country"]))).toEqual([
      "authorization.work_in_country",
      "documents.resume",
    ]);
  });

  it("blocks Apply on a review field with no value the candidate cannot fill in", () => {
    const unsupported: Field = { ...sensitiveField, fieldKey: "work.visa_type", value: null };
    const groups = reviewGroups(application([resumeField, unsupported]));
    expect(canApply(groups, new Set(["work.visa_type"]))).toBe(false);
    expect(applyBlockers(groups, new Set())).toEqual([
      "Some answers cannot be confirmed yet. Update your saved answers, then try again.",
    ]);
  });

  it("never acknowledges a field the candidate did not confirm", () => {
    const groups = reviewGroups(application([resumeField, sensitiveField]));
    expect(acknowledgementsForApply(groups, new Set(["contact.email"]))).toEqual([
      "documents.resume",
    ]);
  });
});

describe("ApplicationReviewPanel", () => {
  it("shows nothing when there is nothing left to decide", async () => {
    await render(application([resumeField, autoField]));
    expect(container.textContent).toBe("");
  });

  it("has no approval ceremony, material review or cancel controls", async () => {
    await render(application([resumeField, sensitiveField, emptyField]));
    expect(container.textContent).not.toMatch(
      /Approve this packet|I reviewed this generated|Cancel application|Replace the current preparation|Edit again/u,
    );
    expect(container.textContent).not.toContain("documents.resume");
  });

  it("asks for a missing answer and saves it", async () => {
    const handlers = await render(application([resumeField, emptyField]));
    expect(container.textContent).toContain("We need your answer");
    const input = container.querySelector<HTMLInputElement>("input:not([type='checkbox'])");
    if (!input) throw Error("Missing answer input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Because it fits");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent === "Save answer")
        ?.click(),
    );
    expect(handlers.onProvideEntry).toHaveBeenCalledWith({
      fieldKey: "questions.why_company",
      value: "Because it fits",
    });
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("lists a sensitive answer for explicit confirmation and reports the toggle", async () => {
    const onToggle = vi.fn();
    await render(application([resumeField, sensitiveField]), actions(), new Set(), onToggle);
    expect(container.textContent).toContain("Check these answers");
    expect(container.textContent).toContain("Yes");
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    await act(async () => box?.click());
    expect(onToggle).toHaveBeenCalledWith("authorization.work_in_country");
  });

  it("keeps reconciliation of an ambiguous submission available", async () => {
    const handlers = await render(
      application([resumeField], {
        status: "reconciliation_required",
        attempts: [
          {
            id: "00000000-0000-7000-8000-000000000004",
            sequence: 1,
            status: "ambiguous",
            adapterId: "manual",
            adapterVersion: "none",
            startedAt: AT,
          },
        ] as unknown as Application["attempts"],
      }),
    );
    expect(container.textContent).toContain("Do not submit again until you confirm");
    const notSubmitted = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "It was not submitted",
    );
    expect(notSubmitted?.disabled).toBe(true);
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent === "I submitted it")
        ?.click(),
    );
    expect(handlers.onReconcile).toHaveBeenCalledWith({
      attemptId: "00000000-0000-7000-8000-000000000004",
      kind: "submitted",
    });
  });

  it("explains a withheld packet", async () => {
    await render(application([], { packetAvailability: "withheld" } as Partial<Application>));
    expect(container.textContent).toContain("A saved answer changed, was removed or expired");
  });
});
