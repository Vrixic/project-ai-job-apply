import type { JobPreferenceSet } from "@ai-job-apply/api-contracts";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { MatchAssessmentUnavailableError } from "./match-assessment.js";
import {
  type MatchAssessmentJobReader,
  type MatchAssessmentPreferenceReader,
  MatchAssessmentService,
  MatchAssessmentServiceUnavailableError,
  MatchAssessmentTargetUnavailableError,
  MatchPreferencesRequiredError,
} from "./match-assessment-service.js";

const NOW = new Date("2026-08-16T16:00:00.000Z");

function preferences(overrides: Partial<JobPreferenceSet> = {}): JobPreferenceSet {
  return {
    id: uuidv7(),
    version: 3,
    updatedAt: "2026-08-16T15:00:00.000Z",
    targetRoles: ["Platform Engineer"],
    locations: ["Remote - US"],
    workModes: ["remote"],
    employmentTypes: ["full_time"],
    ...overrides,
  };
}

function setup(options?: {
  preferences?: JobPreferenceSet | null;
  preferenceFailure?: Error;
  jobFailure?: Error;
}) {
  const ownerUserId = uuidv7();
  const requestedJobId = uuidv7();
  const canonicalJobId = uuidv7();
  const preferenceCalls: string[] = [];
  const jobCalls: Array<{ jobId: string; now: Date }> = [];
  const preferenceReader: MatchAssessmentPreferenceReader = {
    async getPreferences(owner) {
      preferenceCalls.push(owner);
      if (options?.preferenceFailure) throw options.preferenceFailure;
      return options && "preferences" in options ? (options.preferences ?? null) : preferences();
    },
  };
  const jobReader: MatchAssessmentJobReader = {
    async getMatchableJob(jobId, now) {
      jobCalls.push({ jobId, now: new Date(now) });
      if (options?.jobFailure) throw options.jobFailure;
      return {
        requestedJobId: jobId,
        job: {
          id: canonicalJobId,
          catalogRevision: "42",
          eligibleThrough: "2026-09-16T16:00:00.000Z",
          title: "Platform Engineer",
          locations: ["Remote - US"],
          workMode: "remote",
          employmentType: "full_time",
        },
      };
    },
  };
  return {
    ownerUserId,
    requestedJobId,
    canonicalJobId,
    preferenceCalls,
    jobCalls,
    preferenceReader,
    jobReader,
    service: new MatchAssessmentService(preferenceReader, jobReader, () => new Date(NOW)),
  };
}

describe("MatchAssessmentService", () => {
  it("binds owner preferences, requested identity, canonical job, catalog revision, and trusted chronology", async () => {
    const fixture = setup();

    const result = await fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId);

    expect(result).toMatchObject({
      schemaVersion: 1,
      requestedJobId: fixture.requestedJobId,
      canonicalJobId: fixture.canonicalJobId,
      preferenceVersion: 3,
      catalogRevision: "42",
      assessedAt: NOW.toISOString(),
      gate: "review_required",
    });
    expect(fixture.preferenceCalls).toEqual([fixture.ownerUserId]);
    expect(fixture.jobCalls).toEqual([{ jobId: fixture.requestedJobId, now: NOW }]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it("exposes fixed evidence codes without profile or job display values", async () => {
    const secret = "candidate-secret-value";
    const fixture = setup({
      preferences: preferences({ targetRoles: [secret], locations: [secret] }),
    });

    const result = await fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId);

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.evidence).toHaveLength(9);
    expect(result.evidence.map((item) => item.constraint)).toEqual([
      "work_mode",
      "employment_type",
      "target_role",
      "location",
      "compensation",
      "authorization_sponsorship",
      "seniority",
      "blocked_company",
      "qualifications",
    ]);
  });

  it("requires owner preferences without reading the catalog", async () => {
    const fixture = setup({ preferences: null });

    await expect(
      fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchPreferencesRequiredError);
    expect(fixture.jobCalls).toEqual([]);
  });

  it.each([true, false])(
    "requires restricted-preference review without exposing its value (%s)",
    async (requiresSponsorship) => {
      const fixture = setup({ preferences: preferences({ requiresSponsorship }) });
      let caught: unknown;
      try {
        await fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MatchAssessmentUnavailableError);
      expect(JSON.stringify(caught)).not.toContain(String(requiresSponsorship));
      expect(fixture.jobCalls).toEqual([]);
    },
  );

  it("returns generic target absence for an unavailable active job", async () => {
    const fixture = setup();
    fixture.jobReader.getMatchableJob = async () => null;

    await expect(
      fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentTargetUnavailableError);
  });

  it("does not return or retain a job that expires while its snapshot is being read", async () => {
    const fixture = setup();
    const expiresAt = new Date(NOW.getTime() + 1_000);
    fixture.jobReader.getMatchableJob = async (jobId) => ({
      requestedJobId: jobId,
      job: {
        id: fixture.canonicalJobId,
        catalogRevision: "42",
        eligibleThrough: expiresAt.toISOString(),
        title: "Platform Engineer",
        locations: ["Remote - US"],
      },
    });
    const clockValues = [NOW, expiresAt];
    const service = new MatchAssessmentService(
      fixture.preferenceReader,
      fixture.jobReader,
      () => new Date((clockValues.shift() ?? expiresAt).getTime()),
    );

    await expect(
      service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentTargetUnavailableError);
  });

  it("fails closed when the trusted clock regresses during an assessment", async () => {
    const fixture = setup();
    const clockValues = [NOW, new Date(NOW.getTime() - 1)];
    const service = new MatchAssessmentService(
      fixture.preferenceReader,
      fixture.jobReader,
      () => new Date((clockValues.shift() ?? NOW).getTime()),
    );

    await expect(
      service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);
  });

  it("fails closed on a future-dated preference snapshot", async () => {
    const fixture = setup({
      preferences: preferences({ updatedAt: "2026-08-16T16:00:00.001Z" }),
    });

    await expect(
      fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);
  });

  it.each([
    { preferenceFailure: new Error("private profile driver detail") },
    { jobFailure: new Error("private catalog driver detail") },
  ])("maps dependency failures to a fresh generic availability error", async (options) => {
    const fixture = setup(options);
    let caught: unknown;
    try {
      await fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MatchAssessmentServiceUnavailableError);
    expect(caught).toMatchObject({ message: "The match assessment is temporarily unavailable" });
    expect(JSON.stringify(caught)).not.toContain("driver detail");
  });

  it("fails closed on mismatched or malformed reader records", async () => {
    const fixture = setup();
    fixture.jobReader.getMatchableJob = async () => ({
      requestedJobId: uuidv7(),
      job: {
        id: fixture.canonicalJobId,
        catalogRevision: "42",
        eligibleThrough: "2026-09-16T16:00:00.000Z",
        title: "Platform Engineer",
        locations: ["Remote - US"],
      },
    });
    await expect(
      fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);

    fixture.jobReader.getMatchableJob = async (jobId) => ({
      requestedJobId: jobId,
      job: {
        id: fixture.canonicalJobId,
        catalogRevision: "0",
        eligibleThrough: "2026-09-16T16:00:00.000Z",
        title: "Platform Engineer",
        locations: ["Remote - US"],
      },
    });
    await expect(
      fixture.service.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);
  });

  it("rejects invalid owner, requested ID, and clock before any dependency read", async () => {
    const fixture = setup();
    await expect(
      fixture.service.assess("not-an-owner", fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);
    await expect(fixture.service.assess(fixture.ownerUserId, "NOT-A-JOB")).rejects.toBeInstanceOf(
      MatchAssessmentServiceUnavailableError,
    );
    const badClock = new MatchAssessmentService(
      fixture.preferenceReader,
      fixture.jobReader,
      () => new Date(Number.NaN),
    );
    await expect(
      badClock.assess(fixture.ownerUserId, fixture.requestedJobId),
    ).rejects.toBeInstanceOf(MatchAssessmentServiceUnavailableError);
    expect(fixture.preferenceCalls).toEqual([]);
    expect(fixture.jobCalls).toEqual([]);
  });
});
