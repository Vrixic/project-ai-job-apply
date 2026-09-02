import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresPrivateSavedPageCaptureStore,
  PrivateCaptureAlreadySavedError,
  PrivateCaptureIdempotencyConflictError,
  PrivateCaptureReplayDeletedError,
  PrivateCaptureResolutionConflictError,
  type PrivateSavedPageCaptureInput,
} from "./private-saved-page-captures.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

function input(captureId = uuidv7()): PrivateSavedPageCaptureInput {
  return {
    schemaVersion: 1,
    captureId,
    source: {
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: `https://jobs.eu.lever.co/synthetic/${captureId}`,
      adapterVersion: "d2-job-page-v1",
    },
    snapshot: {
      title: "Synthetic Platform Engineer",
      company: "Synthetic Company",
      location: "Remote - US",
      description: "A generated-synthetic public description.",
      externalJobId: captureId,
    },
    capturedAt: "2026-09-01T17:59:00.000Z",
  };
}

describeWithDatabase("PostgresPrivateSavedPageCaptureStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const store = new PostgresPrivateSavedPageCaptureStore(client);
  const ownerA = uuidv7();
  const ownerB = uuidv7();
  const occurredAt = new Date("2026-09-01T18:00:00.000Z");

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

  it("creates and replays an immutable owner-scoped capture with a value-bound key", async () => {
    const captureInput = input();
    const command = {
      ownerUserId: ownerA,
      idempotencyKey: "private-capture-integration-0001",
      input: captureInput,
    };
    const created = await store.create(command, occurredAt);
    await expect(store.create(command, occurredAt)).resolves.toEqual(created);
    await expect(store.get(ownerA, captureInput.captureId)).resolves.toEqual(created);
    await expect(store.get(ownerB, captureInput.captureId)).resolves.toBeNull();

    await expect(
      store.create(
        { ...command, input: { ...captureInput, snapshot: { title: "Changed title" } } },
        occurredAt,
      ),
    ).rejects.toThrow(PrivateCaptureIdempotencyConflictError);
    await expect(
      client`UPDATE matching.private_saved_page_captures SET snapshot_title = 'Changed title'
        WHERE id = ${captureInput.captureId}::uuid`,
    ).rejects.toThrow();
  });

  it("does not overwrite or duplicate an already saved source page", async () => {
    const first = input();
    await store.create(
      {
        ownerUserId: ownerA,
        idempotencyKey: "private-capture-integration-0002",
        input: first,
      },
      occurredAt,
    );
    await expect(
      store.create(
        {
          ownerUserId: ownerA,
          idempotencyKey: "private-capture-integration-0003",
          input: { ...first, captureId: uuidv7() },
        },
        occurredAt,
      ),
    ).rejects.toThrow(PrivateCaptureAlreadySavedError);
  });

  it("links one independently supplied resolution as an auditable append-only transition", async () => {
    const captureInput = input();
    await store.create(
      {
        ownerUserId: ownerA,
        idempotencyKey: "private-capture-integration-0004",
        input: captureInput,
      },
      occurredAt,
    );
    const command = {
      ownerUserId: ownerA,
      captureId: captureInput.captureId,
      canonicalJobId: uuidv7(),
      verificationEvidenceId: uuidv7(),
    };
    const linked = await store.linkVerifiedResolution(
      command,
      new Date("2026-09-01T18:01:00.000Z"),
    );
    await expect(
      store.linkVerifiedResolution(command, new Date("2026-09-01T18:02:00.000Z")),
    ).resolves.toEqual(linked);
    await expect(
      store.linkVerifiedResolution(
        { ...command, canonicalJobId: uuidv7() },
        new Date("2026-09-01T18:03:00.000Z"),
      ),
    ).rejects.toThrow(PrivateCaptureResolutionConflictError);
    await expect(
      store.linkVerifiedResolution(
        { ...command, ownerUserId: ownerB },
        new Date("2026-09-01T18:04:00.000Z"),
      ),
    ).resolves.toBeNull();

    const audit = await client<{ action: string }[]>`
      SELECT action FROM matching.private_saved_page_capture_audit_events
      WHERE owner_user_id = ${ownerA}::uuid AND capture_id = ${captureInput.captureId}::uuid
      ORDER BY occurred_at
    `;
    expect(audit.map((event) => event.action)).toEqual(["created", "resolved"]);
    await expect(
      client`UPDATE matching.private_saved_page_capture_resolutions
        SET canonical_job_id = ${uuidv7()}::uuid WHERE capture_id = ${captureInput.captureId}::uuid`,
    ).rejects.toThrow();
  });

  it("makes cross-owner delete indistinguishable and erases private data without recreating it", async () => {
    const captureInput = input();
    const command = {
      ownerUserId: ownerA,
      idempotencyKey: "private-capture-integration-0005",
      input: captureInput,
    };
    await store.create(command, occurredAt);
    await store.delete(ownerB, captureInput.captureId, new Date("2026-09-01T18:01:00.000Z"));
    await expect(store.get(ownerA, captureInput.captureId)).resolves.not.toBeNull();
    await store.delete(ownerA, captureInput.captureId, new Date("2026-09-01T18:02:00.000Z"));
    await store.delete(ownerA, captureInput.captureId, new Date("2026-09-01T18:03:00.000Z"));
    await expect(store.get(ownerA, captureInput.captureId)).resolves.toBeNull();
    await expect(store.create(command, occurredAt)).rejects.toThrow(
      PrivateCaptureReplayDeletedError,
    );

    const retained = await client<{ sourceCount: string; auditCount: string }[]>`
      SELECT
        (SELECT count(*)::text FROM matching.private_saved_page_captures
          WHERE id = ${captureInput.captureId}::uuid) AS "sourceCount",
        (SELECT count(*)::text FROM matching.private_saved_page_capture_audit_events
          WHERE capture_id = ${captureInput.captureId}::uuid) AS "auditCount"
    `;
    expect(retained[0]).toEqual({ sourceCount: "0", auditCount: "2" });
  });

  it("has no raw DOM, token, cookie, form, or outbox persistence surface", async () => {
    const forbidden = await client<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'matching'
        AND table_name LIKE 'private_saved_page_capture%'
        AND (
          column_name ILIKE '%dom%' OR column_name ILIKE '%html%' OR
          column_name ILIKE '%token%' OR column_name ILIKE '%cookie%' OR
          column_name ILIKE '%form%' OR data_type = 'jsonb'
        )
    `;
    expect(forbidden[0]?.count).toBe("0");
    const outbox = await client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM information_schema.tables
      WHERE table_schema = 'matching' AND table_name ILIKE '%outbox%'
    `;
    expect(outbox[0]?.count).toBe("0");
  });
});
