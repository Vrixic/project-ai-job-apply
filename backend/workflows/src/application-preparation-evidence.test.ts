import type { ApplicationView } from "@ai-job-apply/applications-service";
import type { ActiveJobRecord } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import { createOwnedCoverLetterEvidenceSource } from "./application-preparation-evidence.js";

type Options = Parameters<typeof createOwnedCoverLetterEvidenceSource>[0];
type ProfileFact = Awaited<ReturnType<Options["profile"]["listGroundingFacts"]>>[number];
const owner = "019a4000-0000-7000-8000-000000000001";
const app = "019a4000-0000-7000-8000-000000000002";
const jobId = "019a4000-0000-7000-8000-000000000003";
const other = "019a4000-0000-7000-8000-000000000004";
const at = new Date("2026-10-02T12:00:00Z");
const fact: ProfileFact = {
  id: other,
  kind: "skill",
  key: "skill",
  value: ["TypeScript"],
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};

function fixture(defaultOff = false) {
  let active = true;
  let enabled = true;
  let now = at;
  let leased = false;
  const view = {
    application: { id: app, ownerUserId: owner, canonicalJobId: jobId },
  } as ApplicationView;
  const job = {
    id: jobId,
    status: "active",
    company: { id: other, name: "Synthetic" },
    title: "Engineer",
    description: "Build reliable systems.",
    expiresAt: new Date(at.getTime() + 60_000),
  } as ActiveJobRecord;
  const facts = [structuredClone(fact)];
  const getApplication = vi.fn(async () => {
    expect(leased).toBe(true);
    return view;
  });
  const getActiveJob = vi.fn(async () => {
    expect(leased).toBe(true);
    return job as ActiveJobRecord | null;
  });
  const listGroundingFacts = vi.fn(async () => {
    expect(leased).toBe(true);
    return facts;
  });
  const withGenerationLease = vi.fn(async (_user: string, run: () => Promise<unknown>) => {
    if (!active) throw Error("Synthetic quarantined candidate");
    leased = true;
    try {
      return await run();
    } finally {
      leased = false;
    }
  }) as unknown as Options["candidateLease"]["withGenerationLease"];
  const source = createOwnedCoverLetterEvidenceSource({
    applications: { getApplication },
    catalog: { getActiveJob },
    profile: { listGroundingFacts },
    candidateLease: { withGenerationLease },
    clock: () => now,
    ...(defaultOff ? {} : { enabled: () => enabled }),
  });
  return {
    source,
    getApplication,
    getActiveJob,
    listGroundingFacts,
    view,
    job,
    facts,
    setClock: (value: Date) => {
      now = value;
    },
    quarantine: () => {
      active = false;
    },
    disable: () => {
      enabled = false;
    },
  };
}

describe("private owned cover-letter evidence composition", () => {
  it.each(["expired", "invalid"])(
    "refuses evidence when the posting/clock becomes unusable during Profile reads (%s)",
    async (kind) => {
      const f = fixture();
      f.listGroundingFacts.mockImplementation(async () => {
        f.setClock(kind === "expired" ? f.job.expiresAt : new Date(Number.NaN));
        return f.facts;
      });
      await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
    },
  );
  it("defaults off without owner reads", async () => {
    const f = fixture(true);
    await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
    expect(f.getApplication).not.toHaveBeenCalled();
  });
  it("loads the bound job and candidate facts through their owner APIs under the candidate lease", async () => {
    const f = fixture();
    const result = await f.source.load(owner, app);
    expect(f.getApplication).toHaveBeenCalledWith(owner, app);
    expect(f.getActiveJob).toHaveBeenCalledWith(jobId, at);
    expect(f.listGroundingFacts).toHaveBeenCalledWith(owner);
    expect(result.job).toEqual({
      title: "Engineer",
      company: "Synthetic",
      description: f.job.description,
    });
  });
  it.each(["not-an-id", owner.toUpperCase()])(
    "rejects malformed owner identity before reads %s",
    async (value) => {
      const f = fixture();
      await expect(f.source.load(value, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
      expect(f.getApplication).not.toHaveBeenCalled();
    },
  );
  it("refuses quarantine before any owned evidence read", async () => {
    const f = fixture();
    f.quarantine();
    await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
    expect(f.getApplication).not.toHaveBeenCalled();
  });
  it.each(["id", "ownerUserId", "canonicalJobId"] as const)(
    "rejects a foreign/malformed application binding %s",
    async (field) => {
      const f = fixture();
      f.view.application[field] = field === "canonicalJobId" ? "not-an-id" : other;
      await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
      expect(f.getActiveJob).not.toHaveBeenCalled();
      expect(f.listGroundingFacts).not.toHaveBeenCalled();
    },
  );
  it.each([null, "expired", "bad-time"])("refuses missing or stale job %s", async (value) => {
    const f = fixture();
    if (value === null) f.getActiveJob.mockResolvedValue(null);
    else f.job.expiresAt = value === "expired" ? at : new Date(Number.NaN);
    await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
    expect(f.listGroundingFacts).not.toHaveBeenCalled();
  });
  it("removes restricted facts and returns detached graph projections", async () => {
    const f = fixture();
    f.facts.push({
      ...fact,
      id: jobId,
      sensitivity: "restricted",
      value: "Synthetic restricted value",
    });
    const result = await f.source.load(owner, app);
    expect(result.facts).toHaveLength(1);
    const [original] = f.facts;
    const [projected] = result.facts;
    if (!original || !projected) throw Error("SyntheticMissingFact");
    (original.value as string[]).push("changed");
    original.source.reference = "changed";
    expect(projected.value).toEqual(["TypeScript"]);
    expect(projected.source.reference).toBe("synthetic");
  });
  it("snapshots the complete posting before the asynchronous Profile read", async () => {
    const f = fixture();
    const description = "Synthetic ".repeat(1_000);
    f.job.description = description;
    f.listGroundingFacts.mockImplementation(async () => {
      f.job.description = "changed";
      return f.facts;
    });
    expect((await f.source.load(owner, app)).job.description).toBe(description);
  });
  it.each(["getApplication", "getActiveJob", "listGroundingFacts"] as const)(
    "rechecks kill switch after %s",
    async (port) => {
      const f = fixture();
      const original = f[port].getMockImplementation();
      f[port].mockImplementation((async () => {
        const value = await original?.();
        f.disable();
        return value;
      }) as never);
      await expect(f.source.load(owner, app)).rejects.toThrow("CoverLetterEvidenceUnavailable");
      if (port !== "listGroundingFacts") expect(f.listGroundingFacts).not.toHaveBeenCalled();
    },
  );
  it.each(["getApplication", "getActiveJob", "listGroundingFacts"] as const)(
    "never reflects private diagnostics from %s",
    async (port) => {
      const f = fixture();
      f[port].mockRejectedValue(Error("Synthetic private owner detail"));
      await expect(f.source.load(owner, app)).rejects.toThrow(/^CoverLetterEvidenceUnavailable$/);
    },
  );
});
