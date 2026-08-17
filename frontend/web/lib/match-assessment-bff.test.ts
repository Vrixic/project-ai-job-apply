import type { MatchAssessment } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import {
  matchAssessmentJobId,
  rejectMatchAssessmentInput,
  validateMatchAssessmentResponse,
} from "./match-assessment-bff";

const JOB_ID = "019d04cf-1f80-7000-8000-000000000012";

function assessment(overrides: Partial<MatchAssessment> = {}): MatchAssessment {
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

async function settleWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The BFF response did not settle")), 250);
  });
  try {
    return await Promise.race([promise, watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("match-assessment BFF", () => {
  it("accepts only exact lowercase UUIDv7 identifiers and bodyless queryless reads", () => {
    expect(matchAssessmentJobId(JOB_ID)).toBe(JOB_ID);
    expect(matchAssessmentJobId(JOB_ID.toUpperCase())).toBeUndefined();
    expect(matchAssessmentJobId("019d04cf-1f80-4000-8000-000000000012")).toBeUndefined();
    expect(
      rejectMatchAssessmentInput(
        new Request(`https://web.example.test/api/platform/jobs/${JOB_ID}/match-assessment`),
      ),
    ).toBeUndefined();
    expect(
      rejectMatchAssessmentInput(
        new Request(
          `https://web.example.test/api/platform/jobs/${JOB_ID}/match-assessment?owner=other`,
        ),
      )?.status,
    ).toBe(400);
  });

  it("returns an exact validated owner-private response bound to the requested path", async () => {
    const response = await validateMatchAssessmentResponse(
      Response.json(assessment(), {
        headers: { "x-correlation-id": "correlation-1" },
      }),
      JOB_ID,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("correlation-1");
    expect(await response.json()).toEqual(assessment());
  });

  it.each([
    [
      "wrong requested identity",
      assessment({ requestedJobId: "019d04cf-1f80-7000-8000-000000000099" }),
    ],
    [
      "contradictory gate",
      assessment({
        gate: "review_required",
        evidence: [
          { constraint: "work_mode", state: "conflict", reasonCode: "work_mode_conflict" },
          ...assessment().evidence.slice(1),
        ] as MatchAssessment["evidence"],
      }),
    ],
    ["impossible assessment time", assessment({ assessedAt: "2026-02-31T12:00:00.000Z" })],
    ["future preference snapshot", assessment({ preferenceUpdatedAt: "2026-08-16T12:00:00.001Z" })],
    ["out-of-range catalog revision", assessment({ catalogRevision: "9223372036854775808" })],
    ["extra private value", { ...assessment(), privateCandidateValue: "must-not-leak" }],
  ])("fails closed on a %s", async (_label, body) => {
    const response = await validateMatchAssessmentResponse(Response.json(body), JOB_ID);

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("must-not-leak");
  });

  it("rejects the wrong media type, an oversized body, and a stalled body", async () => {
    const wrongMedia = await validateMatchAssessmentResponse(
      new Response(JSON.stringify(assessment()), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      JOB_ID,
    );
    const oversized = await validateMatchAssessmentResponse(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "40000" },
      }),
      JOB_ID,
    );
    const stalled = await validateMatchAssessmentResponse(
      new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      JOB_ID,
      5,
    );

    expect(wrongMedia.status).toBe(503);
    expect(oversized.status).toBe(503);
    expect(stalled.status).toBe(503);
  });

  it("does not await hostile cancellation when response metadata is rejected", async () => {
    let cancelled = false;
    const hostile = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });

    const response = await settleWithin(
      validateMatchAssessmentResponse(
        new Response(hostile, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
        JOB_ID,
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: 503,
      code: "match_assessment_unavailable",
      title: "Match assessment unavailable",
    });
  });

  it("does not await hostile cancellation after a streamed response exceeds its bound", async () => {
    let cancelled = false;
    const hostile = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });

    const response = await settleWithin(
      validateMatchAssessmentResponse(
        new Response(hostile, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        JOB_ID,
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("response body is too large");
  });

  it("contains a hostile cancellation rejection when a response times out", async () => {
    let cancelled = false;
    const privateCanary = "private cancellation transport failure";
    const hostile = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
        return Promise.reject(new Error(privateCanary));
      },
    });

    const response = await settleWithin(
      validateMatchAssessmentResponse(
        new Response(hostile, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        JOB_ID,
        5,
      ),
    );

    expect(cancelled).toBe(true);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(privateCanary);
  });

  it("preserves only a validated declared upstream problem", async () => {
    const upstream = Response.json(
      {
        type: "urn:ai-job-apply:problem:match_preferences_required",
        title: "hostile private title that must not cross the BFF",
        status: 409,
        code: "match_preferences_required",
        traceId: "trace-1",
        detail: "private upstream implementation detail",
      },
      { status: 409, headers: { "content-type": "application/problem+json" } },
    );
    const response = await validateMatchAssessmentResponse(upstream, JOB_ID);
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      type: "urn:ai-job-apply:problem:match_preferences_required",
      title: "Job preferences are required",
      status: 409,
      code: "match_preferences_required",
      traceId: "trace-1",
    });
    expect(JSON.stringify(body)).not.toMatch(/private upstream|hostile private/);
  });

  it.each([
    [
      "private extra field",
      {
        type: "urn:ai-job-apply:problem:match_assessment_unavailable",
        title: "Unavailable",
        status: 503,
        code: "match_assessment_unavailable",
        traceId: "trace-2",
        privateDatabaseDetail: "must-not-leak",
      },
      503,
    ],
    [
      "status mismatch",
      {
        type: "urn:ai-job-apply:problem:match_preferences_required",
        title: "Preferences required",
        status: 409,
        code: "match_preferences_required",
        traceId: "trace-3",
      },
      404,
    ],
    [
      "undeclared code",
      {
        type: "urn:ai-job-apply:problem:private_database_failure",
        title: "Private database failure",
        status: 503,
        code: "private_database_failure",
        traceId: "trace-4",
      },
      503,
    ],
    [
      "type and code mismatch",
      {
        type: "urn:ai-job-apply:problem:platform_unavailable",
        title: "Unavailable",
        status: 503,
        code: "match_assessment_unavailable",
        traceId: "trace-5",
      },
      503,
    ],
  ])(
    "replaces a malformed upstream problem with a generic 503: %s",
    async (_label, body, status) => {
      const response = await validateMatchAssessmentResponse(
        Response.json(body, {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
        JOB_ID,
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("must-not-leak");
    },
  );
});
