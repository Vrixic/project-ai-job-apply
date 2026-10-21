import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import {
  deriveResumeGeneration,
  RESUME_GENERATION_TIMEOUT_MS,
  type ResumeGenerationRequestRow,
} from "./resume-generation-state.js";
import { APPLICATION_ID, HASH_A, JOB_ID, USER_ID } from "./test-support.js";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

function material(completedAtMs: number): TemporaryMaterialReference {
  return {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: JOB_ID,
    ownerUserId: USER_ID,
    applicationId: APPLICATION_ID,
    version: 1,
    contentSha256: HASH_A,
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
}

function request(overrides: Partial<ResumeGenerationRequestRow> = {}): ResumeGenerationRequestRow {
  return {
    outboxStatus: "published",
    dispatchResult: "started",
    terminalStatus: null,
    requestedAtMs: NOW - 60_000,
    ...overrides,
  };
}

const derive = (input: Partial<Parameters<typeof deriveResumeGeneration>[0]>) =>
  deriveResumeGeneration({ materials: undefined, request: null, nowMs: NOW, ...input });

describe("resume generation state", () => {
  it("is not requested without a request, and never for a packet bound to the uploaded resume", () => {
    expect(derive({})).toEqual({ state: "not_requested" });
    expect(derive({ packetResumeHash: HASH_A, request: request() })).toEqual({
      state: "not_requested",
    });
  });

  it.each([
    ["pending", request({ outboxStatus: "pending", dispatchResult: null })],
    ["processing", request({ outboxStatus: "processing", dispatchResult: null })],
    ["running", request()],
    ["terminal success not yet attached", request({ terminalStatus: "SUCCEEDED" })],
  ])("is preparing while the request is %s", (_name, row) => {
    expect(derive({ request: row })).toEqual({
      state: "preparing",
      requestedAt: new Date(NOW - 60_000).toISOString(),
    });
  });

  it("is ready until the fixed expiry and expired from that instant", () => {
    const completedAtMs = NOW - 60_000;
    const ready = derive({ materials: [material(completedAtMs)], request: request() });
    expect(ready).toEqual({ state: "ready", requestedAt: new Date(NOW - 60_000).toISOString() });
    expect(
      derive({ materials: [material(completedAtMs)], nowMs: completedAtMs + 1_799_999 }).state,
    ).toBe("ready");
    expect(
      derive({ materials: [material(completedAtMs)], nowMs: completedAtMs + 1_800_000 }),
    ).toMatchObject({ state: "expired" });
  });

  it("ignores a cover-letter material when deciding the resume state", () => {
    const letter = { ...material(NOW - 1000), kind: "cover_letter" as const };
    expect(derive({ materials: [letter] })).toEqual({ state: "not_requested" });
  });

  it.each([
    ["no uploaded resume", request({ dispatchResult: "no_resume" }), "no_resume"],
    [
      "a failed delivery",
      request({ outboxStatus: "failed", dispatchResult: null }),
      "generation_failed",
    ],
    ["a failed execution", request({ terminalStatus: "FAILED" }), "generation_failed"],
    ["a stopped execution", request({ terminalStatus: "STOPPED" }), "generation_failed"],
    ["a timed-out execution", request({ terminalStatus: "TIMED_OUT" }), "generation_timed_out"],
  ] as const)("fails with a distinct code for %s", (_name, row, errorCode) => {
    expect(derive({ request: row })).toEqual({
      state: "failed",
      errorCode,
      requestedAt: new Date(NOW - 60_000).toISOString(),
    });
  });

  it("reports a timeout once the bound passes without a result, not before", () => {
    const row = request({ requestedAtMs: NOW - RESUME_GENERATION_TIMEOUT_MS + 1 });
    expect(derive({ request: row }).state).toBe("preparing");
    expect(
      derive({ request: request({ requestedAtMs: NOW - RESUME_GENERATION_TIMEOUT_MS }) }),
    ).toMatchObject({ state: "failed", errorCode: "generation_timed_out" });
  });

  it("fails a request the candidate withdrew, and keeps one requested afterwards", () => {
    expect(derive({ request: request(), withdrawnAtMs: NOW - 30_000 })).toMatchObject({
      state: "failed",
      errorCode: "generation_failed",
    });
    expect(derive({ request: request(), withdrawnAtMs: NOW - 120_000 }).state).toBe("preparing");
  });

  it("carries no identifiers, content or provider detail", () => {
    const text = JSON.stringify(derive({ request: request({ terminalStatus: "FAILED" }) }));
    expect(text).not.toMatch(/arn:|execution|task|owner|fargate/iu);
  });
});
