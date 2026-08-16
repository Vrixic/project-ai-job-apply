import type { CatalogObservation, RecordObservationResult } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import type {
  IngestionSourceAdapter,
  JobCatalogIngestionPort,
  SourceJobObservation,
  SourcePollResult,
} from "./contract.js";
import { SourceRegistry } from "./registry.js";
import { SourceNeutralIngestionRunner } from "./runner.js";

const observedAt = new Date("2026-08-16T00:00:00.000Z");

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function observation(overrides: Partial<SourceJobObservation> = {}): SourceJobObservation {
  return {
    companyName: "Generated Synthetic Company",
    title: "Generated Engineer",
    locations: ["Remote - US"],
    description: "Generated synthetic public job text.",
    sourceUrl: "https://jobs.example.test/generated/1",
    atsTenant: "synthetic-tenant",
    externalJobId: "generated-1",
    verifiedCompanyDomain: "COMPANY.EXAMPLE.TEST",
    workMode: "remote",
    employmentType: "full_time",
    ...overrides,
  };
}

function adapter(
  result: SourcePollResult | IngestionSourceAdapter["poll"],
): IngestionSourceAdapter {
  const poll: IngestionSourceAdapter["poll"] =
    typeof result === "function" ? result : async () => result;
  return {
    sourceId: "synthetic-foundation-v1",
    adapterVersion: "synthetic-ingestion-v1",
    poll: vi.fn(poll),
  };
}

function registry(sourceAdapter: IngestionSourceAdapter, enabled = true): SourceRegistry {
  return new SourceRegistry([
    {
      sourceId: "synthetic-foundation-v1",
      provider: "other",
      provenance: "authorized_fixture",
      adapter: sourceAdapter,
      enabled,
    },
  ]);
}

function recordResult(outcome: RecordObservationResult["outcome"]): RecordObservationResult {
  return {
    outcome,
    probableDuplicateJobIds: [],
    job: {
      id: "019c0000-0000-7000-8000-000000000001",
      companyId: "019c0000-0000-7000-8000-000000000002",
      title: "Generated Engineer",
      locations: ["Remote - US"],
      description: "Generated synthetic public job text.",
      status: "active",
      firstObservedAt: observedAt,
      lastVerifiedAt: observedAt,
      expiresAt: new Date("2026-09-15T00:00:00.000Z"),
    },
  };
}

function catalog(outcomes: RecordObservationResult["outcome"][] = ["created"]): {
  port: JobCatalogIngestionPort;
  observations: CatalogObservation[];
} {
  const observations: CatalogObservation[] = [];
  return {
    observations,
    port: {
      async recordObservation(value) {
        observations.push(value);
        return recordResult(outcomes[observations.length - 1] ?? "exact_match_updated");
      },
    },
  };
}

describe("SourceNeutralIngestionRunner", () => {
  it("injects fixed provenance, canonicalizes URLs, and returns aggregate-only counts", async () => {
    const target = catalog(["created", "exact_match_updated"]);
    const runner = new SourceNeutralIngestionRunner(
      registry(
        adapter({
          kind: "success",
          observations: [
            observation(),
            observation({ sourceUrl: "https://jobs.example.test/2", externalJobId: "generated-2" }),
          ],
        }),
      ),
      target.port,
      { clock: () => observedAt },
    );

    const result = await runner.run("synthetic-foundation-v1", 1, new AbortController().signal);

    expect(result).toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "succeeded",
      observationCount: 2,
      createdCount: 1,
      updatedCount: 1,
    });
    expect(target.observations[0]).toMatchObject({
      provider: "other",
      provenance: "authorized_fixture",
      adapterVersion: "synthetic-ingestion-v1",
      sourceUrl: "https://jobs.example.test/generated/1",
      verifiedCompanyDomain: "company.example.test",
      workMode: "remote",
      employmentType: "full_time",
      observedAt,
    });
    expect(target.observations[0]).not.toHaveProperty("rawSnapshot");
    expect(JSON.stringify(result)).not.toContain("Generated Engineer");
    expect(JSON.stringify(result)).not.toContain("jobs.example.test");
  });

  it("does not poll or persist a default-disabled source", async () => {
    const sourceAdapter = adapter({ kind: "success", observations: [observation()] });
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(registry(sourceAdapter, false), target.port);

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("disabled");
    expect(sourceAdapter.poll).not.toHaveBeenCalled();
    expect(target.observations).toEqual([]);
  });

  it("fails closed before polling when the persisted source control is paused", async () => {
    const sourceAdapter = adapter({ kind: "success", observations: [observation()] });
    const target = catalog();
    const sourceExecutionGate = vi.fn().mockResolvedValue(false);
    const runner = new SourceNeutralIngestionRunner(registry(sourceAdapter), target.port, {
      sourceExecutionGate,
    });

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).resolves.toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "aborted",
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    });
    expect(sourceExecutionGate).toHaveBeenCalledWith({
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
    });
    expect(sourceAdapter.poll).not.toHaveBeenCalled();
    expect(target.observations).toEqual([]);
  });

  it("rechecks source control after polling and every catalog write", async () => {
    const sourceAdapter = adapter({
      kind: "success",
      observations: [
        observation(),
        observation({ sourceUrl: "https://jobs.example.test/2", externalJobId: "generated-2" }),
      ],
    });
    const target = catalog(["created", "created"]);
    const sourceExecutionGate = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const runner = new SourceNeutralIngestionRunner(registry(sourceAdapter), target.port, {
      sourceExecutionGate,
    });

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).resolves.toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "aborted",
      observationCount: 1,
      createdCount: 1,
      updatedCount: 0,
    });
    expect(sourceExecutionGate).toHaveBeenCalledTimes(4);
    expect(target.observations).toHaveLength(1);
  });

  it("rejects duplicate identities, unsupported fields, and invalid match attributes before persistence", async () => {
    const target = catalog();
    const duplicateRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [observation(), observation()] })),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      duplicateRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("duplicate exact identity");

    const unexpected = {
      ...observation(),
      provider: "other",
      provenance: "authorized_fixture",
      rawSnapshot: { forbidden: true },
    } as unknown as SourceJobObservation;
    const unknownRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [unexpected] })),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      unknownRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("unsupported field");

    const invalidWorkMode = {
      ...observation(),
      workMode: "mostly_remote",
    } as unknown as SourceJobObservation;
    const invalidAttributeRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [invalidWorkMode] })),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      invalidAttributeRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("Job matching attributes are invalid");
    expect(target.observations).toEqual([]);
  });

  it("returns a redacted bounded retry without treating absence as closure", async () => {
    const target = catalog();
    const retryRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "retry", reason: "rate_limited", retryAfterMs: 30_000 })),
      target.port,
    );
    await expect(
      retryRunner.run("synthetic-foundation-v1", 2, new AbortController().signal),
    ).resolves.toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "retry",
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
      reason: "rate_limited",
      retryAfterMs: 30_000,
    });

    const thrownRunner = new SourceNeutralIngestionRunner(
      registry(
        adapter(async () => {
          throw new Error("private source value https://private.invalid/token");
        }),
      ),
      target.port,
    );
    const thrown = await thrownRunner.run(
      "synthetic-foundation-v1",
      1,
      new AbortController().signal,
    );
    expect(thrown).toMatchObject({ status: "retry", reason: "source_unavailable" });
    expect(JSON.stringify(thrown)).not.toContain("private");
    expect(target.observations).toEqual([]);
  });

  it("accepts an empty batch without changing catalog lifecycle state", async () => {
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [] })),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).resolves.toMatchObject({ status: "succeeded", observationCount: 0 });
    expect(target.observations).toEqual([]);
  });

  it("fails closed if activation changes between polling and persistence", async () => {
    let active = true;
    const sourceAdapter = adapter(async () => {
      active = false;
      return { kind: "success", observations: [observation()] };
    });
    const dynamicRegistry = new SourceRegistry(
      [
        {
          sourceId: "synthetic-foundation-v1",
          provider: "other",
          provenance: "authorized_fixture",
          adapter: sourceAdapter,
          enabled: true,
        },
      ],
      () => active,
    );
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(dynamicRegistry, target.port, {
      clock: () => observedAt,
    });

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("disabled");
    expect(target.observations).toEqual([]);
  });

  it("protects the persisted observation time from adapter mutation", async () => {
    const mutatingPoll: IngestionSourceAdapter["poll"] = async (context) => {
      context.observedAt.setUTCFullYear(2036);
      return { kind: "success", observations: [observation()] };
    };
    const sourceAdapter = adapter(mutatingPoll);
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(registry(sourceAdapter), target.port, {
      clock: () => observedAt,
    });

    await runner.run("synthetic-foundation-v1", 1, new AbortController().signal);
    expect(target.observations[0]?.observedAt).toEqual(observedAt);
  });

  it.each([
    { kind: "success", observations: [] } as SourcePollResult,
    { kind: "retry", reason: "timeout" } as SourcePollResult,
  ])("fails closed when activation changes during a $kind poll", async (pollResult) => {
    let active = true;
    const sourceAdapter = adapter(async () => {
      active = false;
      return pollResult;
    });
    const dynamicRegistry = new SourceRegistry(
      [
        {
          sourceId: "synthetic-foundation-v1",
          provider: "other",
          provenance: "authorized_fixture",
          adapter: sourceAdapter,
          enabled: true,
        },
      ],
      () => active,
    );
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(dynamicRegistry, target.port, {
      clock: () => observedAt,
    });

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("disabled");
    expect(target.observations).toEqual([]);
  });

  it("reports partial progress on abort and propagates catalog integrity errors", async () => {
    const controller = new AbortController();
    let writes = 0;
    const port: JobCatalogIngestionPort = {
      async recordObservation() {
        writes += 1;
        controller.abort();
        return recordResult("created");
      },
    };
    const runner = new SourceNeutralIngestionRunner(
      registry(
        adapter({
          kind: "success",
          observations: [
            observation(),
            observation({ sourceUrl: "https://jobs.example.test/2", externalJobId: "generated-2" }),
          ],
        }),
      ),
      port,
      { clock: () => observedAt },
    );
    await expect(runner.run("synthetic-foundation-v1", 1, controller.signal)).resolves.toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "aborted",
      observationCount: 1,
      createdCount: 1,
      updatedCount: 0,
    });
    expect(writes).toBe(1);

    const conflictRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [observation()] })),
      {
        async recordObservation() {
          throw new Error("Conflicting exact job identities require manual resolution");
        },
      },
      { clock: () => observedAt },
    );
    await expect(
      conflictRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("Conflicting exact job identities");
  });

  it("returns aborted when the final catalog write resolves after cancellation", async () => {
    const pendingWrite = deferred<RecordObservationResult>();
    const controller = new AbortController();
    let writes = 0;
    const runner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [observation()] })),
      {
        async recordObservation() {
          writes += 1;
          return pendingWrite.promise;
        },
      },
      { clock: () => observedAt },
    );

    const running = runner.run("synthetic-foundation-v1", 1, controller.signal);
    await vi.waitFor(() => expect(writes).toBe(1));
    controller.abort();
    pendingWrite.resolve(recordResult("created"));

    await expect(running).resolves.toEqual({
      sourceId: "synthetic-foundation-v1",
      status: "aborted",
      observationCount: 1,
      createdCount: 1,
      updatedCount: 0,
    });
  });

  it("fails closed if activation changes while a catalog write is in flight", async () => {
    const pendingWrite = deferred<RecordObservationResult>();
    let active = true;
    let writes = 0;
    const dynamicRegistry = new SourceRegistry(
      [
        {
          sourceId: "synthetic-foundation-v1",
          provider: "other",
          provenance: "authorized_fixture",
          adapter: adapter({ kind: "success", observations: [observation()] }),
          enabled: true,
        },
      ],
      () => active,
    );
    const runner = new SourceNeutralIngestionRunner(dynamicRegistry, {
      async recordObservation() {
        writes += 1;
        return pendingWrite.promise;
      },
    });

    const running = runner.run("synthetic-foundation-v1", 1, new AbortController().signal);
    await vi.waitFor(() => expect(writes).toBe(1));
    active = false;
    pendingWrite.resolve(recordResult("created"));

    await expect(running).rejects.toThrow("disabled");
  });

  it.each([
    "http://jobs.example.test/1",
    "https://user:secret@jobs.example.test/1",
    "https://jobs.example.test:8443/1",
    "https://jobs.example.test/1#fragment",
    "https://jobs.example.test/1?next=https%3A%2F%2Fother.example.test",
    "https://127.0.0.1/1",
    "https://localhost/1",
    `https://jobs.example.test/${"a".repeat(4_100)}`,
  ])("rejects a noncanonical synthetic source URL: %s", async (sourceUrl) => {
    const target = catalog();
    const runner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: [observation({ sourceUrl })] })),
      target.port,
      { clock: () => observedAt },
    );

    await expect(
      runner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow(/synthetic source URL|source URL exceeds/);
    expect(target.observations).toEqual([]);
  });

  it("rejects oversized batches and non-synthetic verified domains", async () => {
    const target = catalog();
    const oversized = Array.from({ length: 101 }, (_, index) =>
      observation({
        sourceUrl: `https://jobs.example.test/${index}`,
        externalJobId: `generated-${index}`,
      }),
    );
    const oversizedRunner = new SourceNeutralIngestionRunner(
      registry(adapter({ kind: "success", observations: oversized })),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      oversizedRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("bounded size");

    const domainRunner = new SourceNeutralIngestionRunner(
      registry(
        adapter({
          kind: "success",
          observations: [observation({ verifiedCompanyDomain: "internal.local" })],
        }),
      ),
      target.port,
      { clock: () => observedAt },
    );
    await expect(
      domainRunner.run("synthetic-foundation-v1", 1, new AbortController().signal),
    ).rejects.toThrow("verified company domain");
  });
});
