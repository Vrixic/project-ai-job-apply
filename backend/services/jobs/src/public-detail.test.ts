import { describe, expect, it, vi } from "vitest";
import type { ActiveJobRecord } from "./persistence/catalog.js";
import {
  PublicJobDetailProjector,
  type PublicJobDetailReader,
  PublicJobDetailUnavailableError,
} from "./public-detail.js";

const requestedJobId = "018f6f6e-7b2a-7c00-8000-000000000001";
const canonicalJobId = "018f6f6e-7b2a-7c00-8000-000000000002";
const now = new Date("2026-08-16T12:00:00.000Z");

function activeJob(overrides: Partial<ActiveJobRecord> = {}): ActiveJobRecord {
  return {
    id: requestedJobId,
    company: {
      id: "018f6f6e-7b2a-7c00-8000-000000000003",
      name: "Synthetic Systems",
      verifiedDomain: "synthetic.example.test",
    },
    title: "Platform Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    description: "Build reliable generated-synthetic candidate infrastructure.",
    status: "active",
    firstObservedAt: new Date("2026-08-10T12:00:00.000Z"),
    lastVerifiedAt: new Date("2026-08-16T11:00:00.000Z"),
    expiresAt: new Date("2026-09-15T12:00:00.000Z"),
    validThrough: new Date("2026-09-01T12:00:00.000Z"),
    sources: [
      {
        provider: "other",
        provenance: "authorized_fixture",
        canonicalUrl: "https://jobs.synthetic.example.test/roles/123",
        firstObservedAt: new Date("2026-08-10T12:00:00.000Z"),
        lastVerifiedAt: new Date("2026-08-16T11:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

function reader(result: ActiveJobRecord | null) {
  return {
    getActiveJob: vi.fn<PublicJobDetailReader["getActiveJob"]>().mockResolvedValue(result),
  };
}

describe("PublicJobDetailProjector", () => {
  it.each([
    "not-a-uuid",
    requestedJobId.toUpperCase(),
    "018f6f6e-7b2a-6c00-8000-000000000001",
    "018f6f6e-7b2a-7c00-7000-000000000001",
  ])("returns generic absence without catalog I/O for invalid identifier %s", async (jobId) => {
    const catalog = reader(activeJob());
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(jobId)).resolves.toEqual({ kind: "absent" });
    expect(catalog.getActiveJob).not.toHaveBeenCalled();
  });

  it("rejects an invalid clock without catalog I/O", async () => {
    const catalog = reader(activeJob());
    const projector = new PublicJobDetailProjector(catalog, () => new Date(Number.NaN));

    await expect(projector.get(requestedJobId)).rejects.toBeInstanceOf(
      PublicJobDetailUnavailableError,
    );
    expect(catalog.getActiveJob).not.toHaveBeenCalled();
  });

  it("returns the same generic absence for every unavailable catalog target", async () => {
    const catalog = reader(null);
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).resolves.toEqual({ kind: "absent" });
    expect(catalog.getActiveJob).toHaveBeenCalledWith(requestedJobId, now);
  });

  it("keeps the evaluation boundary immutable when a reader mutates its Date argument", async () => {
    const catalog = {
      getActiveJob: vi.fn<PublicJobDetailReader["getActiveJob"]>().mockImplementation((_, at) => {
        at.setUTCFullYear(2035);
        return Promise.resolve(activeJob());
      }),
    };
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).resolves.toMatchObject({ kind: "available" });
    expect(now.toISOString()).toBe("2026-08-16T12:00:00.000Z");
  });

  it("emits only the immutable public allowlist", async () => {
    const source = activeJob();
    const catalog = reader(source);
    const projector = new PublicJobDetailProjector(catalog, () => now);

    const result = await projector.get(requestedJobId);
    expect(result).toEqual({
      kind: "available",
      requestedJobId,
      canonicalJobId: requestedJobId,
      isAlias: false,
      job: {
        id: requestedJobId,
        companyName: "Synthetic Systems",
        title: "Platform Engineer",
        locations: ["Remote - US"],
        department: "Engineering",
        description: "Build reliable generated-synthetic candidate infrastructure.",
        firstObservedAt: "2026-08-10T12:00:00.000Z",
        lastVerifiedAt: "2026-08-16T11:00:00.000Z",
        expiresAt: "2026-09-15T12:00:00.000Z",
        validThrough: "2026-09-01T12:00:00.000Z",
      },
    });
    expect(result).not.toHaveProperty("sources");
    expect(result).not.toHaveProperty("companyId");
    if (result.kind !== "available") {
      throw new Error("Expected an available public job");
    }
    expect(result.job).not.toHaveProperty("sources");
    expect(result.job).not.toHaveProperty("company");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.job)).toBe(true);
    expect(Object.isFrozen(result.job.locations)).toBe(true);

    source.locations[0] = "Changed after projection";
    source.firstObservedAt.setUTCFullYear(2030);
    expect(result.job.locations).toEqual(["Remote - US"]);
    expect(result.job.firstObservedAt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("separates a reversible alias request from its canonical identity", async () => {
    const catalog = reader(activeJob({ id: canonicalJobId }));
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).resolves.toMatchObject({
      kind: "available",
      requestedJobId,
      canonicalJobId,
      isAlias: true,
      job: { id: canonicalJobId },
    });
  });

  it.each([
    { expiresAt: new Date(now), validThrough: undefined, name: "exact expiry" },
    {
      expiresAt: new Date(now.getTime() - 1),
      validThrough: undefined,
      name: "past expiry",
    },
    { validThrough: new Date(now), name: "exact source validity expiry" },
    { status: "blocked", name: "non-active lifecycle" },
    { description: "   ", name: "empty description" },
  ] as Array<{ name: string } & Partial<ActiveJobRecord>>)(
    "returns generic absence for an unavailable $name record",
    async ({ name: _name, ...overrides }) => {
      const catalog = reader(activeJob(overrides));
      const projector = new PublicJobDetailProjector(catalog, () => now);

      await expect(projector.get(requestedJobId)).resolves.toEqual({ kind: "absent" });
    },
  );

  it("fails closed for a malformed future verification record", async () => {
    const catalog = reader(activeJob({ lastVerifiedAt: new Date(now.getTime() + 1) }));
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).rejects.toBeInstanceOf(
      PublicJobDetailUnavailableError,
    );
  });

  it("fails closed when source validity contradicts the canonical expiry", async () => {
    const catalog = reader(activeJob({ validThrough: new Date("2026-10-01T12:00:00.000Z") }));
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).rejects.toBeInstanceOf(
      PublicJobDetailUnavailableError,
    );
  });

  it("maps reader failures to the generic availability error instead of deindexing absence", async () => {
    const failure = new Error("database unavailable");
    const catalog = {
      getActiveJob: vi.fn<PublicJobDetailReader["getActiveJob"]>().mockRejectedValue(failure),
    };
    const projector = new PublicJobDetailProjector(catalog, () => now);

    await expect(projector.get(requestedJobId)).rejects.toEqual(
      new PublicJobDetailUnavailableError(),
    );
    await expect(projector.get(requestedJobId)).rejects.not.toBe(failure);
  });
});
