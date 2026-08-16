// @vitest-environment jsdom

import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchAssessmentNonclaim, matchEvidenceCopy, matchGateCopy } from "./match-assessment-copy";
import { MatchAssessmentPanel } from "./match-assessment-panel";

const JOB_ID = "019d04cf-1f80-7000-8000-000000000012";

function assessment(
  overrides: Partial<Pick<MatchAssessment, "requestedJobId" | "gate" | "evidence">> = {},
): MatchAssessment {
  return {
    schemaVersion: 1,
    requestedJobId: JOB_ID,
    canonicalJobId: JOB_ID,
    preferenceSetId: "019d04cf-1f80-7000-8000-000000000013",
    preferenceVersion: 2,
    preferenceUpdatedAt: "2026-08-16T11:00:00.000Z",
    catalogRevision: "9",
    assessedAt: "2026-08-16T12:00:00.000Z",
    gate: "review_required",
    evidence: [
      { constraint: "work_mode", state: "satisfied", reasonCode: "work_mode_selected" },
      {
        constraint: "employment_type",
        state: "satisfied",
        reasonCode: "employment_type_selected",
      },
      {
        constraint: "target_role",
        state: "satisfied",
        reasonCode: "target_role_exact_overlap",
      },
      { constraint: "location", state: "unknown", reasonCode: "location_not_established" },
      {
        constraint: "compensation",
        state: "unknown",
        reasonCode: "compensation_semantics_unavailable",
      },
      {
        constraint: "authorization_sponsorship",
        state: "unknown",
        reasonCode: "authorization_sponsorship_unavailable",
      },
      {
        constraint: "seniority",
        state: "unknown",
        reasonCode: "seniority_semantics_unavailable",
      },
      {
        constraint: "blocked_company",
        state: "unknown",
        reasonCode: "blocked_company_preferences_unavailable",
      },
      {
        constraint: "qualifications",
        state: "unknown",
        reasonCode: "qualification_evidence_unavailable",
      },
    ],
    ...overrides,
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("MatchAssessmentPanel", () => {
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

  it("renders fixed evidence and explicit nonclaims without a score or eligibility claim", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(assessment()));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<MatchAssessmentPanel jobId={JOB_ID} />));
    const button = container.querySelector("button");
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/platform/jobs/${JOB_ID}/match-assessment`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(container.textContent).toContain("No exact hard conflict");
    expect(container.textContent).toContain("stated work mode is one you selected");
    expect(container.textContent).toContain("Unknown evidence never counts as a conflict");
    expect(container.textContent).toContain(matchGateCopy.review_required.summary);
    expect(container.textContent).toContain(matchEvidenceCopy.work_mode_selected);
    expect(container.textContent).toContain(matchAssessmentNonclaim);
    expect(container.textContent).not.toMatch(/\b\d+%|eligible|strong match/i);
    expect(container.querySelectorAll("li")).toHaveLength(9);
  });

  it("renders an exact conflict without converting unknown evidence into a conflict", async () => {
    const conflict = assessment({
      gate: "excluded",
      evidence: [
        { constraint: "work_mode", state: "conflict", reasonCode: "work_mode_conflict" },
        ...assessment().evidence.slice(1),
      ] as MatchAssessment["evidence"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(conflict)),
    );
    await act(async () => root.render(<MatchAssessmentPanel jobId={JOB_ID} />));
    await act(async () =>
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(container.textContent).toContain("Known preference conflict");
    expect(container.textContent).toContain("stated work mode conflicts");
    expect(container.querySelectorAll('li[data-state="conflict"]')).toHaveLength(1);
  });

  it.each([
    ["match_preferences_required", "Save your job preferences"],
    ["match_preferences_require_review", "Review and save your preferences"],
    ["match_job_unavailable", "no longer available"],
    ["internal_private_detail", "temporarily unavailable"],
  ])("uses bounded client copy for %s problems", async (code, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { code, detail: "private candidate or database detail must not render" },
          { status: code.startsWith("match_preferences") ? 409 : 503 },
        ),
      ),
    );
    await act(async () => root.render(<MatchAssessmentPanel jobId={JOB_ID} />));
    await act(async () =>
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain("private candidate");
  });

  it("drops a prior job response after the requested identity changes", async () => {
    const first = deferredResponse();
    const secondJobId = "019d04cf-1f80-7000-8000-000000000099";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json(assessment({ requestedJobId: secondJobId })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<MatchAssessmentPanel jobId={JOB_ID} />));
    await act(async () =>
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toContain("Checking match evidence");
    await act(async () => root.render(<MatchAssessmentPanel jobId={secondJobId} />));
    first.resolve(Response.json(assessment()));
    await act(async () => {});
    expect(container.textContent).not.toContain("No exact hard conflict");

    await act(async () =>
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(container.textContent).toContain("No exact hard conflict");
  });
});
