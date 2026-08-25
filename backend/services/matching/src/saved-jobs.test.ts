import type { CanonicalJobSummary } from "@ai-job-apply/api-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { deriveSavedJobCursorKeys, SavedJobCollectionChangedError } from "./saved-job-cursor.js";
import {
  PostgresSavedJobStore,
  type SavedJobCatalogResolver,
  type SavedJobRecord,
  type SavedJobRecordPage,
  type SavedJobStore,
  SavedJobsService,
  SavedJobTargetUnavailableError,
} from "./saved-jobs.js";

function job(id = uuidv7(), title = "Synthetic Engineer"): CanonicalJobSummary {
  return {
    id,
    company: { id: uuidv7(), name: "Synthetic Company" },
    title,
    locations: ["Remote - US"],
    status: "active",
    firstObservedAt: "2026-08-15T12:00:00.000Z",
    lastVerifiedAt: "2026-08-15T12:00:00.000Z",
    expiresAt: "2026-09-14T12:00:00.000Z",
  };
}

class MemorySavedJobStore implements SavedJobStore {
  readonly records: SavedJobRecord[] = [];
  readonly replays = new Map<string, SavedJobRecord>();
  revision = 1;

  async findCreateReplay(
    ownerUserId: string,
    requestedJobId: string,
    idempotencyKey: string,
    _occurredAt: Date,
  ): Promise<SavedJobRecord | null> {
    return this.replays.get(`${ownerUserId}:${requestedJobId}:${idempotencyKey}`) ?? null;
  }

  async create(
    ownerUserId: string,
    requestedJobId: string,
    resolvedJob: CanonicalJobSummary,
    idempotencyKey: string,
    occurredAt: Date,
  ): Promise<SavedJobRecord> {
    const existing = this.records.find(
      (record) => record.ownerUserId === ownerUserId && record.requestedJobId === requestedJobId,
    );
    if (existing) {
      this.replays.set(`${ownerUserId}:${requestedJobId}:${idempotencyKey}`, existing);
      return existing;
    }
    const record: SavedJobRecord = {
      id: uuidv7(),
      ownerUserId,
      requestedJobId,
      resolvedCanonicalJobIdAtSave: resolvedJob.id,
      snapshot: {
        jobIdAtSave: resolvedJob.id,
        company: resolvedJob.company,
        title: resolvedJob.title,
        locations: resolvedJob.locations,
        firstObservedAt: resolvedJob.firstObservedAt,
        lastVerifiedAt: resolvedJob.lastVerifiedAt,
        expiresAt: resolvedJob.expiresAt,
      },
      savedAt: new Date(occurredAt.getTime() + this.records.length),
    };
    this.records.unshift(record);
    this.replays.set(`${ownerUserId}:${requestedJobId}:${idempotencyKey}`, record);
    this.revision += 1;
    return record;
  }

  async getOwnerRevision(): Promise<string> {
    return String(this.revision);
  }

  async readOwnerPage(
    ownerUserId: string,
    after: { savedAt: Date; id: string } | undefined,
    limit: number,
  ): Promise<SavedJobRecordPage> {
    const eligible = this.records.filter(
      (record) =>
        record.ownerUserId === ownerUserId &&
        (!after ||
          record.savedAt < after.savedAt ||
          (record.savedAt.getTime() === after.savedAt.getTime() && record.id < after.id)),
    );
    return {
      revision: String(this.revision),
      records: eligible.slice(0, limit),
      hasMore: eligible.length > limit,
    };
  }

  async delete(ownerUserId: string, savedJobId: string, _occurredAt: Date): Promise<void> {
    const index = this.records.findIndex(
      (record) => record.ownerUserId === ownerUserId && record.id === savedJobId,
    );
    if (index >= 0) {
      this.records.splice(index, 1);
      this.revision += 1;
    }
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

class MutableCatalog implements SavedJobCatalogResolver {
  revision = 1;
  readonly current = new Map<string, CanonicalJobSummary | null>();

  async getActiveJobSummary(jobId: string, _activeAt: Date): Promise<CanonicalJobSummary | null> {
    return this.current.get(jobId) ?? null;
  }

  async getCatalogRevision(): Promise<string> {
    return String(this.revision);
  }

  async resolveActiveJobSummaries(jobIds: readonly string[]) {
    return {
      catalogRevision: String(this.revision),
      items: jobIds.flatMap((requestedJobId) => {
        const current = this.current.get(requestedJobId) ?? null;
        return current ? [{ requestedJobId, job: current }] : [];
      }),
    };
  }
}

describe("SavedJobsService", () => {
  const keys = deriveSavedJobCursorKeys("postgres://synthetic.invalid/test");

  it("preserves each explicit requested target across resolve and reopen", async () => {
    const owner = uuidv7();
    const requestedA = uuidv7();
    const requestedB = uuidv7();
    const canonical = job();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    catalog.current.set(requestedA, canonical);
    catalog.current.set(requestedB, canonical);
    const service = new SavedJobsService(store, catalog, keys);

    await service.create(owner, requestedA, "saved-job-create-a-0001");
    await service.create(owner, requestedB, "saved-job-create-b-0001");
    expect((await service.list(owner, { pageSize: 20 })).items).toHaveLength(2);
    expect(store.records.map((record) => record.requestedJobId).sort()).toEqual(
      [requestedA, requestedB].sort(),
    );

    catalog.current.set(requestedA, job(requestedA, "Synthetic Engineer A"));
    catalog.current.set(requestedB, job(requestedB, "Synthetic Engineer B"));
    catalog.revision += 1;
    const reopened = await service.list(owner, { pageSize: 20 });
    expect(reopened.items).toHaveLength(2);
    expect(reopened.items.map((item) => item.requestedJobId).sort()).toEqual(
      [requestedA, requestedB].sort(),
    );
  });

  it("keeps unavailable saves visible without disclosing catalog state", async () => {
    const owner = uuidv7();
    const requested = uuidv7();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    catalog.current.set(requested, job(requested));
    const service = new SavedJobsService(store, catalog, keys);
    await service.create(owner, requested, "saved-job-create-c-0001");

    catalog.current.set(requested, null);
    catalog.revision += 1;
    const [saved] = (await service.list(owner, { pageSize: 20 })).items;
    expect(saved?.availability).toEqual({ state: "unavailable" });
    expect(saved?.snapshot.title).toBe("Synthetic Engineer");
    expect(saved).not.toHaveProperty("statusReason");
  });

  it("replays the original create response without consulting changed catalog availability", async () => {
    const owner = uuidv7();
    const requested = uuidv7();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    catalog.current.set(requested, job(requested));
    const service = new SavedJobsService(store, catalog, keys);
    const created = await service.create(owner, requested, "saved-job-create-replay-0001");
    catalog.current.set(requested, null);
    catalog.getActiveJobSummary = async () => {
      throw new Error("catalog must not be read on replay");
    };

    await expect(service.create(owner, requested, "saved-job-create-replay-0001")).resolves.toEqual(
      created,
    );
    expect(store.records).toHaveLength(1);
  });

  it("keeps a new idempotency key byte-stable when an existing save has a newer catalog summary", async () => {
    const owner = uuidv7();
    const requested = uuidv7();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    catalog.current.set(requested, job(requested, "Original title"));
    const service = new SavedJobsService(store, catalog, keys);
    await service.create(owner, requested, "saved-job-existing-key-0001");
    catalog.current.set(requested, job(requested, "Changed title"));

    const newKeyResponse = await service.create(owner, requested, "saved-job-existing-key-0002");
    const replay = await service.create(owner, requested, "saved-job-existing-key-0002");
    expect(replay).toEqual(newKeyResponse);
    expect(newKeyResponse.snapshot.title).toBe("Original title");
    expect(newKeyResponse.availability).toMatchObject({
      state: "available",
      currentJob: { title: "Original title" },
    });
    expect(store.records).toHaveLength(1);
  });

  it("fails closed for unavailable creates and catalog changes during a page", async () => {
    const owner = uuidv7();
    const requested = uuidv7();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    const service = new SavedJobsService(store, catalog, keys);
    await expect(service.create(owner, requested, "saved-job-create-d-0001")).rejects.toThrow(
      SavedJobTargetUnavailableError,
    );

    catalog.current.set(requested, job(requested));
    await service.create(owner, requested, "saved-job-create-d-0002");
    const originalResolve = catalog.resolveActiveJobSummaries.bind(catalog);
    catalog.resolveActiveJobSummaries = async (jobIds) => {
      const result = await originalResolve(jobIds);
      catalog.revision += 1;
      return { ...result, catalogRevision: String(catalog.revision) };
    };
    await expect(service.list(owner, { pageSize: 20 })).rejects.toThrow(
      SavedJobCollectionChangedError,
    );
  });

  it("uses owner-bound keyset cursors and rejects them after unrelated catalog mutation", async () => {
    const owner = uuidv7();
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    const service = new SavedJobsService(store, catalog, keys);
    for (let index = 0; index < 3; index += 1) {
      const requested = uuidv7();
      catalog.current.set(requested, job(requested, `Synthetic Engineer ${index}`));
      await service.create(owner, requested, `saved-job-create-page-${index}`.padEnd(24, "0"));
    }
    const first = await service.list(owner, { pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const cursor = first.nextCursor;
    if (!cursor) throw new Error("Expected a saved-job cursor");
    expect((await service.list(owner, { pageSize: 2, cursor })).items).toHaveLength(1);

    catalog.revision += 1;
    await expect(service.list(owner, { pageSize: 2, cursor })).rejects.toThrow(
      SavedJobCollectionChangedError,
    );
  });

  it("rejects an invalid injected clock before create, list, or delete I/O", async () => {
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    const service = new SavedJobsService(store, catalog, keys, () => new Date(Number.NaN));
    const owner = uuidv7();
    const requested = uuidv7();

    await expect(service.create(owner, requested, "saved-job-invalid-clock-0001")).rejects.toThrow(
      "clock is invalid",
    );
    await expect(service.list(owner, { pageSize: 20 })).rejects.toThrow("clock is invalid");
    await expect(service.delete(owner, uuidv7())).rejects.toThrow("clock is invalid");
    expect(store.records).toHaveLength(0);
  });

  it("rejects a non-scalar idempotency key before PostgreSQL I/O", async () => {
    const store = new PostgresSavedJobStore({} as postgres.Sql);

    await expect(
      store.findCreateReplay(
        uuidv7(),
        uuidv7(),
        ["saved-job-array-key-0001"] as unknown as string,
        new Date("2026-08-24T00:00:00.000Z"),
      ),
    ).rejects.toThrow("Saved-job idempotency key is invalid");
  });

  it("normalizes create-transaction timestamps before PostgreSQL binding", async () => {
    const owner = uuidv7();
    const requested = uuidv7();
    const current = job(uuidv7());
    const savedJobId = uuidv7();
    const boundValues: unknown[] = [];
    const transaction = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        boundValues.push(...values);
        const statement = strings.join("?");
        if (statement.includes("SELECT count(*)::text")) return Promise.resolve([{ count: "0" }]);
        if (statement.includes("INSERT INTO matching.saved_jobs")) {
          return Promise.resolve([
            {
              id: savedJobId,
              ownerUserId: owner,
              requestedJobId: requested,
              resolvedCanonicalJobIdAtSave: current.id,
              snapshotCompanyId: current.company.id,
              snapshotCompanyName: current.company.name,
              snapshotVerifiedDomain: null,
              snapshotTitle: current.title,
              snapshotLocations: current.locations,
              snapshotDepartment: null,
              snapshotFirstObservedAt: current.firstObservedAt,
              snapshotLastVerifiedAt: current.lastVerifiedAt,
              snapshotExpiresAt: current.expiresAt,
              savedAt: "2026-08-24T21:30:00.000Z",
            },
          ]);
        }
        return Promise.resolve([]);
      },
      { array: (values: readonly string[]) => [...values] },
    ) as unknown as postgres.Sql;
    const client = {
      begin: async (operation: (sql: postgres.Sql) => Promise<unknown>) => operation(transaction),
    } as unknown as postgres.Sql;
    const store = new PostgresSavedJobStore(client);

    await expect(
      store.create(
        owner,
        requested,
        current,
        "saved-job-normalized-timestamps-0001",
        new Date("2026-08-24T21:30:00.000Z"),
      ),
    ).resolves.toMatchObject({ id: savedJobId });
    expect(boundValues.some((value) => value instanceof Date)).toBe(false);
    expect(boundValues).toContain("2026-08-24T21:30:00.000Z");
    expect(boundValues).toContain("2026-08-25T21:30:00.000Z");
  });

  it("normalizes delete-transaction timestamps before PostgreSQL binding", async () => {
    const owner = uuidv7();
    const savedJobId = uuidv7();
    const requestedJobId = uuidv7();
    const resolvedJobId = uuidv7();
    const boundValues: unknown[] = [];
    const transaction = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      boundValues.push(...values);
      if (strings.join("?").includes("DELETE FROM matching.saved_jobs")) {
        return Promise.resolve([
          {
            id: savedJobId,
            ownerUserId: owner,
            requestedJobId,
            resolvedCanonicalJobIdAtSave: resolvedJobId,
            snapshotCompanyId: uuidv7(),
            snapshotCompanyName: "Synthetic Company",
            snapshotVerifiedDomain: null,
            snapshotTitle: "Synthetic Engineer",
            snapshotLocations: ["Remote - US"],
            snapshotDepartment: null,
            snapshotFirstObservedAt: "2026-08-24T12:00:00.000Z",
            snapshotLastVerifiedAt: "2026-08-24T12:00:00.000Z",
            snapshotExpiresAt: "2026-09-23T12:00:00.000Z",
            savedAt: "2026-08-24T21:30:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const client = {
      begin: async (operation: (sql: postgres.Sql) => Promise<unknown>) => operation(transaction),
    } as unknown as postgres.Sql;
    const store = new PostgresSavedJobStore(client);

    await expect(
      store.delete(owner, savedJobId, new Date("2026-08-24T21:45:00.000Z")),
    ).resolves.toBeUndefined();
    expect(boundValues.some((value) => value instanceof Date)).toBe(false);
    expect(boundValues).toContain("2026-08-24T21:45:00.000Z");
  });

  it.each([
    {
      expectedCode: "SAVED_JOB_FIND_REPLAY",
      configure(store: MemorySavedJobStore, _catalog: MutableCatalog) {
        store.findCreateReplay = async () => {
          throw new TypeError("private replay lookup details");
        };
      },
    },
    {
      expectedCode: "SAVED_JOB_CATALOG_LOOKUP",
      configure(_store: MemorySavedJobStore, catalog: MutableCatalog) {
        catalog.getActiveJobSummary = async () => {
          throw new TypeError("private catalog lookup details");
        };
      },
    },
    {
      expectedCode: "SAVED_JOB_PERSIST",
      configure(store: MemorySavedJobStore, _catalog: MutableCatalog) {
        store.create = async () => {
          throw new TypeError("private persistence details");
        };
      },
    },
  ])("classifies an unexpected $expectedCode create-stage failure", async (scenario) => {
    const store = new MemorySavedJobStore();
    const catalog = new MutableCatalog();
    const requested = uuidv7();
    catalog.current.set(requested, job(requested));
    scenario.configure(store, catalog);
    const service = new SavedJobsService(store, catalog, keys);

    await expect(
      service.create(uuidv7(), requested, "saved-job-stage-classification-0001"),
    ).rejects.toMatchObject({
      name: "SavedJobCreateStageError",
      code: scenario.expectedCode,
      message: "Saved-job create failed",
    });
  });

  it("classifies unexpected PostgreSQL create failures without retaining their details", async () => {
    const client = {
      begin: async () => {
        throw new TypeError("private database and candidate details");
      },
    } as unknown as postgres.Sql;
    const store = new PostgresSavedJobStore(client);
    const requested = uuidv7();

    await expect(
      store.create(
        uuidv7(),
        requested,
        job(requested),
        "saved-job-classification-0001",
        new Date("2026-08-24T21:30:00.000Z"),
      ),
    ).rejects.toMatchObject({
      name: "SavedJobPersistenceError",
      code: "SAVED_JOB_BEGIN",
      message: "Saved-job persistence failed",
    });
  });
});
