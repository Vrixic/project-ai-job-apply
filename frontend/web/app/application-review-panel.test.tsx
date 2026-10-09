// @vitest-environment jsdom

import type { Application } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import { canApprove, reviewGroups } from "./application-review-state";

const hash = "a".repeat(64);
const now = "2026-09-18T12:00:00.000Z";

function field(
  fieldKey: string,
  overrides: Partial<NonNullable<Application["currentPacket"]>["fields"][number]> = {},
) {
  return {
    fieldKey,
    value: "value",
    origin: "confirmed_fact",
    sourceFactIds: ["00000000-0000-7000-8000-000000000010"],
    confidence: 0.99,
    disposition: "auto",
    reasons: [],
    requiresReview: false,
    ...overrides,
  } as NonNullable<Application["currentPacket"]>["fields"][number];
}

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    canonicalJobId: "00000000-0000-7000-8000-000000000002",
    status: "review_required",
    revision: 3,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: now,
    updatedAt: now,
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: hash,
      jobRevision: hash,
      artifactHashes: { resume: hash },
      createdAt: now,
      fields: [
        field("contact.email", { value: "candidate@example.test" }),
        field("authorization.us_authorized", {
          value: true,
          origin: "answer_vault",
          disposition: "review",
          reasons: ["restricted_answer", "never_infer"],
          requiresReview: true,
        }),
        field("attestation.truthful", {
          value: null,
          origin: "derived",
          disposition: "user_action",
          reasons: ["direct_user_action"],
          requiresReview: true,
          sourceFactIds: [],
        }),
      ],
    },
    ...overrides,
  } as Application;
}

describe("ApplicationReviewPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actions = {
    onApprove: vi.fn(),
    onProvideEntry: vi.fn(),
    onReopen: vi.fn(),
    onCancel: vi.fn(),
    onReconcile: vi.fn(),
  } satisfies ApplicationReviewActions;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    for (const mock of Object.values(actions)) mock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => root.unmount());
    container.remove();
  });

  function render(value: Application) {
    act(() => root.render(<ApplicationReviewPanel application={value} actions={actions} />));
  }
  const button = (name: RegExp) =>
    Array.from(container.querySelectorAll("button")).find((candidate) =>
      name.test(candidate.textContent ?? ""),
    );
  const click = async (element: Element | undefined) => {
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  it("collects a sensitive yes/no answer explicitly and preserves false as a boolean", async () => {
    const value = application();
    if (!value.currentPacket) throw new Error("Missing fixture packet");
    value.currentPacket.fields = [
      field("authorization.sponsorship_required", {
        value: null,
        disposition: "user_action",
        requiresReview: true,
        reasons: ["restricted_answer", "never_infer"],
      }),
    ];
    render(value);
    const select = container.querySelector("select");
    expect(select?.value).toBe("");
    expect(actions.onProvideEntry).not.toHaveBeenCalled();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "false");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button(/Save answer/u));
    expect(actions.onProvideEntry).toHaveBeenCalledWith({
      fieldKey: "authorization.sponsorship_required",
      value: false,
    });
  });

  it("requires fresh acknowledgement when a sensitive answer is replaced", async () => {
    const first = application();
    if (!first.currentPacket) throw new Error("Missing fixture packet");
    first.currentPacket.fields = [
      field("authorization.us_authorized", {
        value: true,
        origin: "answer_vault",
        disposition: "review",
        requiresReview: true,
        reasons: ["restricted_answer"],
      }),
    ];
    render(first);
    await click(container.querySelector('input[type="checkbox"]') ?? undefined);
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(false);
    const changed = structuredClone(first);
    if (!changed.currentPacket) throw new Error("Missing fixture packet");
    changed.currentPacket.packetHash = "b".repeat(64);
    changed.currentPacket.fields[0] = {
      ...changed.currentPacket.fields[0],
      value: false,
    } as (typeof changed.currentPacket.fields)[number];
    render(changed);
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("admits only one action while an approval is unresolved", async () => {
    let resolve: (() => void) | undefined;
    actions.onApprove.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const value = application();
    if (!value.currentPacket) throw new Error("Missing fixture packet");
    value.currentPacket.fields = [];
    render(value);
    await click(button(/Approve this packet/u));
    await click(button(/Approve this packet/u));
    await click(button(/Cancel application/u));
    expect(actions.onApprove).toHaveBeenCalledOnce();
    expect(actions.onCancel).not.toHaveBeenCalled();
    await act(async () => resolve?.());
  });

  it("refuses approval when the original generated material expires", () => {
    const value = application();
    if (!value.currentPacket) throw new Error("Missing fixture packet");
    value.currentPacket.fields = [];
    value.currentPacket.temporaryMaterials = [
      {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: value.id,
        version: 1,
        contentSha256: hash,
        completedAtMs: 0,
        expiresAtMs: 1_800_000,
      },
    ];
    render(value);
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Generated materials expired");
  });

  it("requires an available exact generated preview and a fresh candidate acknowledgement", async () => {
    const value = application();
    if (!value.currentPacket) throw new Error("Missing fixture packet");
    value.currentPacket.fields = [];
    const completedAtMs = Date.now();
    value.currentPacket.temporaryMaterials = [
      {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: value.id,
        version: 1,
        contentSha256: hash,
        completedAtMs,
        expiresAtMs: completedAtMs + 1_800_000,
      },
    ];
    render(value);
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("exact preview is unavailable");
    act(() =>
      root.render(
        <ApplicationReviewPanel
          application={value}
          actions={actions}
          availableMaterialGenerations={[value.id]}
        />,
      ),
    );
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(true);
    await click(container.querySelector('input[type="checkbox"]') ?? undefined);
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(false);
    const changed = structuredClone(value);
    if (!changed.currentPacket) throw new Error("Missing fixture packet");
    changed.currentPacket.packetHash = "b".repeat(64);
    act(() =>
      root.render(
        <ApplicationReviewPanel
          application={changed}
          actions={actions}
          availableMaterialGenerations={[value.id]}
        />,
      ),
    );
    expect((button(/Approve this packet/u) as HTMLButtonElement).disabled).toBe(true);
  });

  it("separates what needs input, what needs confirmation, and what is automatic", () => {
    const groups = reviewGroups(application());
    expect(groups.needsInput.map((entry) => entry.fieldKey)).toEqual(["attestation.truthful"]);
    expect(groups.needsReview.map((entry) => entry.fieldKey).sort()).toEqual([
      "attestation.truthful",
      "authorization.us_authorized",
    ]);
    expect(groups.automatic.map((entry) => entry.fieldKey)).toEqual(["contact.email"]);
    render(application());
    expect(container.textContent).toContain("Needs your input");
    expect(container.textContent).toContain("Confirm before approving");
    expect(container.textContent).toContain("Nothing is submitted until you approve.");
  });

  it("always shows a restricted answer and why, and disables approval until everything is decided", () => {
    render(application());
    const text = container.textContent ?? "";
    expect(text).toContain("authorization.us_authorized");
    expect(text).toContain("Sensitive answer. It is shown every time");
    expect(text).toContain("You must complete this yourself.");
    const approve = button(/Approve this packet/u) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(container.textContent).toContain("still need your input");
  });

  it("approves exactly the packet hash with every reviewable field acknowledged", async () => {
    const resolved = application();
    const packet = resolved.currentPacket;
    if (packet) {
      packet.fields = packet.fields.map((entry) =>
        entry.fieldKey === "attestation.truthful"
          ? { ...entry, value: true, origin: "user_entered" }
          : entry,
      ) as typeof packet.fields;
    }
    render(resolved);
    const approve = () => button(/Approve this packet/u) as HTMLButtonElement;
    expect(approve().disabled).toBe(true);
    expect(canApprove(reviewGroups(resolved), new Set())).toBe(false);
    for (const checkbox of Array.from(container.querySelectorAll('input[type="checkbox"]'))) {
      await click(checkbox);
    }
    expect(approve().disabled).toBe(false);
    await click(approve());
    expect(actions.onApprove).toHaveBeenCalledWith({
      packetHash: hash,
      acknowledgedFieldKeys: ["attestation.truthful", "authorization.us_authorized"],
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Approved.");
  });

  it("renders candidate and generated values as inert text", () => {
    const hostile = application();
    const packet = hostile.currentPacket;
    if (packet) {
      packet.fields = [
        field("questions.why_company", {
          value: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
          origin: "generated",
          disposition: "review",
          reasons: ["generated_content"],
          requiresReview: true,
        }),
      ];
    }
    render(hostile);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(2)</script>");
    expect(container.textContent).toContain("Drafted for you. Read it carefully");
  });

  it("reports a failed action without claiming success", async () => {
    actions.onCancel.mockRejectedValueOnce(new Error("boom with candidate data"));
    render(application());
    await click(button(/Cancel application/u));
    const status = container.querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain("did not go through");
    expect(status).not.toContain("candidate data");
  });

  it("shows an approved packet with its expiry and lets the candidate edit again", async () => {
    render(
      application({
        status: "approved",
        currentAction: "ready_to_submit",
        approval: {
          id: "00000000-0000-7000-8000-000000000004",
          packetHash: hash,
          acknowledgedFieldKeys: [],
          approvedAt: now,
          expiresAt: "2026-09-19T12:00:00.000Z",
        },
      }),
    );
    expect(container.textContent).toContain("Approval expires");
    expect(button(/Approve this packet/u)).toBeUndefined();
    await click(button(/Edit again/u));
    expect(actions.onReopen).toHaveBeenCalledOnce();
  });

  it("makes the candidate acknowledge duplicate risk before reporting not submitted", async () => {
    render(
      application({
        status: "reconciliation_required",
        currentAction: "confirm_submission_status",
        attempts: [
          {
            id: "00000000-0000-7000-8000-000000000005",
            sequence: 1,
            status: "ambiguous",
            adapterId: "greenhouse",
            adapterVersion: "1.0.0",
            startedAt: now,
          },
        ],
      }),
    );
    expect(container.textContent).toContain("Do not submit again until you confirm");
    const notSubmitted = () => button(/It was not submitted/u) as HTMLButtonElement;
    expect(notSubmitted().disabled).toBe(true);
    await click(container.querySelector('input[type="checkbox"]') ?? undefined);
    expect(notSubmitted().disabled).toBe(false);
    await click(notSubmitted());
    expect(actions.onReconcile).toHaveBeenCalledWith({
      attemptId: "00000000-0000-7000-8000-000000000005",
      kind: "not_submitted",
      acknowledgesDuplicateRisk: true,
    });
    expect(button(/Cancel application/u)).toBeUndefined();
  });

  it("offers no actions once submitted or cancelled and never mentions hiring outcomes", () => {
    for (const status of ["applied", "cancelled"] as const) {
      render(application({ status, currentAction: "none" }));
      expect(container.querySelectorAll("button")).toHaveLength(0);
    }
    for (const status of [
      "preparing",
      "review_required",
      "approved",
      "submitting",
      "takeover",
      "reconciliation_required",
      "applied",
      "cancelled",
    ] as const) {
      render(application({ status }));
      expect(container.textContent).not.toMatch(/interview|offer|reject|recruiter|hired/iu);
    }
  });

  it("uses labelled controls, headings, and a polite status region", () => {
    render(application());
    expect(container.querySelector("h2")?.textContent).toBe("Application review");
    expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(container.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    for (const input of Array.from(container.querySelectorAll("input"))) {
      const labelled =
        input.id && container.querySelector(`label[for="${input.id}"]`) !== null
          ? true
          : input.closest("label") !== null;
      expect(labelled).toBe(true);
    }
    for (const control of Array.from(container.querySelectorAll("button"))) {
      expect((control.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });
  it("has no automated accessibility violations in any interactive state (contrast is not evaluated in jsdom)", async () => {
    const states: Application[] = [
      application(),
      application({
        status: "approved",
        approval: {
          id: "00000000-0000-7000-8000-000000000004",
          packetHash: hash,
          acknowledgedFieldKeys: [],
          approvedAt: now,
          expiresAt: "2026-09-19T12:00:00.000Z",
        },
      }),
      application({
        status: "reconciliation_required",
        attempts: [
          {
            id: "00000000-0000-7000-8000-000000000005",
            sequence: 1,
            status: "ambiguous",
            adapterId: "greenhouse",
            adapterVersion: "1.0.0",
            startedAt: now,
          },
        ],
      }),
      application({ status: "applied" }),
    ];
    for (const state of states) {
      render(state);
      const result = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    }
  });
});
