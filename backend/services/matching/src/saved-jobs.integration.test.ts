import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CanonicalJobSummary } from "@ai-job-apply/api-contracts";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresSavedJobStore,
  SavedJobIdempotencyConflictError,
  SavedJobIdempotencyLimitError,
  SavedJobLimitError,
} from "./saved-jobs.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresSavedJobStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const store = new PostgresSavedJobStore(client);
  const ownerA = uuidv7();
  const ownerB = uuidv7();
  const requested = uuidv7();
  const occurredAt = new Date("2026-08-15T18:00:00.000Z");
  const activeJob: CanonicalJobSummary = {
    id: uuidv7(),
    company: { id: uuidv7(), name: "Synthetic Company", verifiedDomain: "example.test" },
    title: "Synthetic Engineer",
    locations: ["Remote - US"],
    department: "Engineering",
    status: "active",
    firstObservedAt: "2026-08-15T12:00:00.000Z",
    lastVerifiedAt: "2026-08-15T12:00:00.000Z",
    expiresAt: "2026-09-14T12:00:00.000Z",
  };

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: environment,
    });
    expect(first.stdout.trim()).toBe(
      "Matching migrations through 0003_private_saved_page_captures applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Matching migrations through 0003_private_saved_page_captures applied and verified.",
    );
    await store.ping();
  });

  afterAll(async () => {
    await store.close();
  });

  it("creates and replays an owner-scoped saved target without cross-owner visibility", async () => {
    const created = await store.create(
      ownerA,
      requested,
      activeJob,
      "saved-job-integration-0001",
      occurredAt,
    );
    const replay = await store.create(
      ownerA,
      requested,
      activeJob,
      "saved-job-integration-0001",
      occurredAt,
    );
    expect(replay).toEqual(created);
    expect((await store.readOwnerPage(ownerA, undefined, 25)).records).toEqual([created]);
    expect((await store.readOwnerPage(ownerB, undefined, 25)).records).toEqual([]);

    await expect(
      store.create(ownerA, uuidv7(), activeJob, "saved-job-integration-0001", occurredAt),
    ).rejects.toThrow(SavedJobIdempotencyConflictError);
  });

  it("makes unknown and other-owner deletes indistinguishable and idempotent", async () => {
    const created = await store.create(
      ownerA,
      uuidv7(),
      { ...activeJob, id: uuidv7() },
      "saved-job-integration-0002",
      new Date("2026-08-15T18:01:00.000Z"),
    );
    await store.delete(ownerB, created.id, new Date("2026-08-15T18:02:00.000Z"));
    expect(
      (await store.readOwnerPage(ownerA, undefined, 25)).records.some(
        (item) => item.id === created.id,
      ),
    ).toBe(true);
    await store.delete(ownerA, uuidv7(), new Date("2026-08-15T18:03:00.000Z"));
    await store.delete(ownerA, created.id, new Date("2026-08-15T18:04:00.000Z"));
    await store.delete(ownerA, created.id, new Date("2026-08-15T18:05:00.000Z"));
    expect(
      (await store.readOwnerPage(ownerA, undefined, 25)).records.some(
        (item) => item.id === created.id,
      ),
    ).toBe(false);
  });

  it("refuses unbounded snapshot values at the direct SQL boundary", async () => {
    const base = [
      uuidv7(),
      ownerA,
      uuidv7(),
      uuidv7(),
      uuidv7(),
      "Synthetic Company",
      "example.test",
      "Synthetic Engineer",
      ["Remote - US"],
      "Engineering",
      new Date("2026-08-15T12:00:00.000Z"),
      new Date("2026-08-15T12:00:00.000Z"),
      new Date("2026-09-14T12:00:00.000Z"),
      new Date(),
      new Date(),
    ] as const;
    await expect(
      client.unsafe(
        `INSERT INTO matching.saved_jobs (
        id, owner_user_id, requested_job_id, resolved_canonical_job_id_at_save,
        snapshot_company_id, snapshot_company_name, snapshot_verified_domain, snapshot_title,
        snapshot_locations, snapshot_department, snapshot_first_observed_at,
        snapshot_last_verified_at, snapshot_expires_at, saved_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [...base.slice(0, 7), "x".repeat(241), ...base.slice(8)],
      ),
    ).rejects.toThrow();
    const column = await client<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'matching' AND table_name IN ('saved_jobs', 'idempotency_keys')
          AND data_type = 'jsonb'
      ) AS exists
    `;
    expect(column[0]?.exists).toBe(false);
  });

  it("normalizes contract-valid padded display values before typed snapshot persistence", async () => {
    const paddedOwner = uuidv7();
    const paddedRequested = uuidv7();
    const created = await store.create(
      paddedOwner,
      paddedRequested,
      {
        ...activeJob,
        id: uuidv7(),
        company: { ...activeJob.company, name: "  Synthetic Company  " },
        title: "  Synthetic Engineer  ",
        locations: ["  Remote - US  "],
        department: "  Engineering  ",
      },
      "saved-job-padded-values-0001",
      occurredAt,
    );
    expect(created.snapshot).toMatchObject({
      company: { name: "Synthetic Company" },
      title: "Synthetic Engineer",
      locations: ["Remote - US"],
      department: "Engineering",
    });
    const withoutDepartment = await store.create(
      paddedOwner,
      uuidv7(),
      { ...activeJob, id: uuidv7(), department: "   " },
      "saved-job-blank-department-0001",
      occurredAt,
    );
    expect(withoutDepartment.snapshot).not.toHaveProperty("department");
  });

  it("bounds each owner collection and the retained idempotency replay window", async () => {
    const limitedStore = new PostgresSavedJobStore(client, {
      maximumSavedJobs: 1,
      maximumIdempotencyKeys: 2,
    });
    const limitedOwner = uuidv7();
    const firstRequested = uuidv7();
    const first = await limitedStore.create(
      limitedOwner,
      firstRequested,
      { ...activeJob, id: uuidv7() },
      "saved-job-limited-create-0001",
      occurredAt,
    );
    await expect(
      limitedStore.create(
        limitedOwner,
        uuidv7(),
        { ...activeJob, id: uuidv7() },
        "saved-job-limited-create-0002",
        new Date("2026-08-15T18:01:00.000Z"),
      ),
    ).rejects.toThrow(SavedJobLimitError);

    await expect(
      limitedStore.create(
        limitedOwner,
        firstRequested,
        activeJob,
        "saved-job-limited-replay-0002",
        new Date("2026-08-15T18:02:00.000Z"),
      ),
    ).resolves.toEqual(first);
    await expect(
      limitedStore.create(
        limitedOwner,
        firstRequested,
        activeJob,
        "saved-job-limited-replay-0003",
        new Date("2026-08-15T18:03:00.000Z"),
      ),
    ).rejects.toThrow(SavedJobIdempotencyLimitError);

    const afterRetention = new Date("2026-08-16T18:03:00.001Z");
    await expect(
      limitedStore.findCreateReplay(
        limitedOwner,
        firstRequested,
        "saved-job-limited-create-0001",
        afterRetention,
      ),
    ).resolves.toBeNull();
    await expect(
      limitedStore.create(
        limitedOwner,
        firstRequested,
        activeJob,
        "saved-job-limited-replay-0003",
        afterRetention,
      ),
    ).resolves.toEqual(first);
  });
});
