import type { Application } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  elapsedSeconds,
  expiresInMinutes,
  formatElapsed,
  generationFailureCopy,
  generationView,
  packetResumeSource,
} from "./apply-flow";

const HASH = "a".repeat(64);
const AT = "2026-10-20T12:00:00.000Z";

function material(completedAtMs: number) {
  return {
    schemaVersion: 1 as const,
    kind: "tailored_resume" as const,
    generationId: "00000000-0000-7000-8000-000000000020",
    version: 1,
    contentSha256: HASH,
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
}

function application(overrides: Record<string, unknown> = {}, packet?: Record<string, unknown>) {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    canonicalJobId: "00000000-0000-7000-8000-000000000002",
    status: "review_required",
    revision: 2,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    ...(packet
      ? {
          currentPacket: {
            id: "00000000-0000-7000-8000-000000000003",
            version: 1,
            packetHash: HASH,
            jobRevision: HASH,
            artifactHashes: {},
            fields: [],
            createdAt: AT,
            ...packet,
          },
        }
      : {}),
    ...overrides,
  } as unknown as Application;
}

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

describe("generation view", () => {
  const now = 1_800_000_000_000;

  it("is idle without a packet, for a withheld packet, and before anything was requested", () => {
    expect(generationView(undefined, true, now)).toEqual({ kind: "idle" });
    expect(generationView(application(), true, now)).toEqual({ kind: "idle" });
    expect(generationView(application({}, {}), true, now)).toEqual({ kind: "idle" });
    expect(generationView(application({ packetAvailability: "withheld" }, {}), true, now)).toEqual({
      kind: "idle",
    });
  });

  it("follows the server's own preparing, failed and expired states", () => {
    const requestedAt = new Date(now - 30_000).toISOString();
    expect(
      generationView(
        application({ resumeGeneration: { state: "preparing", requestedAt } }, {}),
        true,
        now,
      ),
    ).toEqual({ kind: "preparing", requestedAtMs: now - 30_000 });
    expect(
      generationView(
        application(
          { resumeGeneration: { state: "failed", errorCode: "generation_timed_out", requestedAt } },
          {},
        ),
        true,
        now,
      ),
    ).toEqual({ kind: "failed", code: "generation_timed_out" });
    expect(
      generationView(
        application({ resumeGeneration: { state: "expired", requestedAt } }, {}),
        true,
        now,
      ),
    ).toEqual({ kind: "expired" });
  });

  it("is ready until the fixed expiry and expired from that instant, on this device's clock", () => {
    const generated = material(now - 60_000);
    const app = application(
      { resumeGeneration: { state: "ready", requestedAt: AT } },
      { temporaryMaterials: [generated], artifactHashes: { resume: HASH } },
    );
    expect(generationView(app, true, now)).toEqual({ kind: "ready", material: generated });
    expect(generationView(app, true, generated.expiresAtMs - 1).kind).toBe("ready");
    expect(generationView(app, true, generated.expiresAtMs).kind).toBe("expired");
  });

  it("treats a hash-bound tailored resume as ready only without native materials", () => {
    const legacy = application({}, { artifactHashes: { resume: HASH } });
    expect(generationView(legacy, false, now)).toEqual({ kind: "ready" });
    expect(generationView(legacy, true, now)).toEqual({ kind: "idle" });
  });

  it("never mistakes the candidate's uploaded resume for a generated one", () => {
    const uploaded = application({}, { artifactHashes: { resume: HASH }, fields: [uploadedField] });
    expect(packetResumeSource(uploaded.currentPacket)).toBe("uploaded");
    expect(generationView(uploaded, false, now)).toEqual({ kind: "idle" });
  });
});

describe("apply plan", () => {
  const now = 1_800_000_000_000;

  it("uses the generated resume when one is valid", () => {
    const generated = material(now - 60_000);
    const app = application(
      {},
      { temporaryMaterials: [generated], artifactHashes: { resume: HASH } },
    );
    const view = generationView(app, true, now);
    expect(applyPlan(app, view)).toEqual({ resume: "generated", needsNewPacket: false });
  });

  it("falls back to the uploaded resume when the generated one expired, needing a new packet", () => {
    const generated = material(now - 3_600_000);
    const app = application(
      {},
      { temporaryMaterials: [generated], artifactHashes: { resume: HASH } },
    );
    const view = generationView(app, true, now);
    expect(view.kind).toBe("expired");
    expect(applyPlan(app, view)).toEqual({ resume: "uploaded", needsNewPacket: true });
  });

  it("reuses a packet already bound to the uploaded resume", () => {
    const app = application({}, { artifactHashes: { resume: HASH }, fields: [uploadedField] });
    expect(applyPlan(app, generationView(app, true, now))).toEqual({
      resume: "uploaded",
      needsNewPacket: false,
    });
  });

  it("needs a packet before applying directly", () => {
    expect(applyPlan(undefined, { kind: "idle" })).toEqual({
      resume: "uploaded",
      needsNewPacket: true,
    });
  });
});

describe("copy and timing helpers", () => {
  it("formats elapsed time and expiry without negative values", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(75)).toBe("1:15");
    expect(elapsedSeconds(undefined, 5_000)).toBe(0);
    expect(elapsedSeconds(10_000, 5_000)).toBe(0);
    expect(elapsedSeconds(1_000, 66_000)).toBe(65);
    expect(expiresInMinutes(material(0), 1_500_000)).toBe(5);
    expect(expiresInMinutes(material(0), 9_000_000)).toBe(0);
  });

  it("gives a distinct fixed message for each failure and never upstream text", () => {
    const copies = (["no_resume", "generation_failed", "generation_timed_out"] as const).map(
      generationFailureCopy,
    );
    expect(new Set(copies).size).toBe(3);
    expect(copies[0]).toContain("uploaded resume");
    expect(copies[2]).toContain("longer than expected");
  });
});
