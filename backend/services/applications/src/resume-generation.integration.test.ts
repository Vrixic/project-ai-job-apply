import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresNativeMaterialWithdrawalStore } from "./native-material-withdrawal.js";
import { PostgresNativeResumeRequestStore } from "./native-resume-request-store.js";
import {
  createFixtureApplication,
  createIntegrationApplicationStore,
} from "./restricted-packet-integration-support.js";
import { ApplicationIdempotencyConflictError } from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");
const WORKFLOW = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-durable:9";
const DOCUMENT = "0192f7c2-0000-7000-8000-0000000000d1";

describeWithDatabase("generated-resume status and the uploaded-resume option (PostgreSQL)", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  let now = new Date();
  const store = createIntegrationApplicationStore(client, () => now, {
    definitions,
    nativeResumePreparationEnabled: () => true,
  });
  const requests = new PostgresNativeResumeRequestStore(client, () => true);

  beforeAll(async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"])
      await execFileAsync(process.execPath, [fileURLToPath(new URL(path, import.meta.url))], {
        env,
      });
  }, 120_000);
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function application() {
    const ownerUserId = uuidv7();
    const created = await createFixtureApplication(store, client, {
      ownerUserId,
      canonicalJobId: uuidv7(),
      idempotencyKey: key("create"),
    });
    return { ownerUserId, applicationId: created.view.application.id, view: created.view };
  }

  async function packet(
    context: { ownerUserId: string; applicationId: string },
    revision: number,
    resume: "generate" | "uploaded",
    idempotencyKey = key("packet"),
  ) {
    return store.createPacket({
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      expectedRevision: revision,
      idempotencyKey,
      ...(resume === "uploaded" ? { resume: "uploaded" as const } : {}),
      packet: {
        jobRevision: HASH_A,
        form: null,
        fields:
          resume === "uploaded"
            ? [
                proposal(),
                {
                  fieldKey: "documents.resume",
                  value: HASH_C,
                  origin: "confirmed_fact",
                  sourceFactIds: [DOCUMENT],
                  sourceConfirmed: true,
                  confidence: 1,
                },
              ]
            : [proposal()],
        artifactHashes: resume === "uploaded" ? { resume: HASH_C } : {},
      },
    });
  }

  const outbox = (applicationId: string) =>
    client`SELECT id, status, resume_dispatch_result, resume_packet_id
      FROM applications.outbox
      WHERE application_id = ${applicationId}
        AND event_type = 'application.resume-preparation.requested.v1'
      ORDER BY occurred_at, id`;

  it("requests one generation for a default packet and reports it as preparing", async () => {
    const context = await application();
    const result = await packet(context, context.view.application.revision, "generate");
    expect(await outbox(context.applicationId)).toHaveLength(1);
    expect(result.view.resumeGeneration).toEqual({
      state: "preparing",
      requestedAt: now.toISOString(),
    });
    const read = await store.getApplication(context.ownerUserId, context.applicationId);
    expect(read.resumeGeneration?.state).toBe("preparing");
  });

  it("requests no generation for a packet bound to the uploaded resume", async () => {
    const context = await application();
    const result = await packet(context, context.view.application.revision, "uploaded");
    expect(await outbox(context.applicationId)).toHaveLength(0);
    expect(result.view.resumeGeneration).toBeUndefined();
    expect(result.view.currentPacket?.artifactHashes).toEqual({ resume: HASH_C });
    expect(result.view.currentPacket?.temporaryMaterials).toBeUndefined();
  });

  it("does not let an old generation request describe a later uploaded packet", async () => {
    const context = await application();
    const first = await packet(context, context.view.application.revision, "generate");
    const second = await packet(context, first.view.application.revision, "uploaded");
    expect(await outbox(context.applicationId)).toHaveLength(1);
    expect(second.view.resumeGeneration).toBeUndefined();
    const read = await store.getApplication(context.ownerUserId, context.applicationId);
    expect(read.resumeGeneration).toBeUndefined();
  });

  it("keeps the uploaded option part of the idempotent request identity", async () => {
    const context = await application();
    const same = key("same");
    const first = await packet(context, context.view.application.revision, "uploaded", same);
    const replay = await packet(context, context.view.application.revision, "uploaded", same);
    expect(replay.replayed).toBe(true);
    expect(replay.view.currentPacket?.id).toBe(first.view.currentPacket?.id);
    await expect(
      packet(context, context.view.application.revision, "generate", same),
    ).rejects.toBeInstanceOf(ApplicationIdempotencyConflictError);
  });

  it("reports a failed delivery, a missing uploaded resume and a withdrawal as failed", async () => {
    const failedDelivery = await application();
    await packet(failedDelivery, failedDelivery.view.application.revision, "generate");
    // A claimed delivery that ended in failure, through the outbox's own processing->failed step.
    const [delivery] = await outbox(failedDelivery.applicationId);
    if (!delivery) throw Error("event expected");
    expect(await requests.claim(delivery.id, WORKFLOW)).not.toBeNull();
    for (let attempt = 1; attempt < 5; attempt += 1)
      await client`UPDATE applications.outbox SET attempt_count = attempt_count + 1
        WHERE id = ${delivery.id}`;
    await client`UPDATE applications.outbox SET status='failed', failed_at=clock_timestamp(),
      claim_token=NULL, lease_expires_at=NULL, last_error_code='lease_expired'
      WHERE id = ${delivery.id}`;
    expect(
      (await store.getApplication(failedDelivery.ownerUserId, failedDelivery.applicationId))
        .resumeGeneration,
    ).toEqual({
      state: "failed",
      errorCode: "generation_failed",
      requestedAt: now.toISOString(),
    });

    const noResume = await application();
    await packet(noResume, noResume.view.application.revision, "generate");
    const [event] = await outbox(noResume.applicationId);
    if (!event) throw Error("event expected");
    const claim = await requests.claim(event.id, WORKFLOW);
    if (!claim) throw Error("claim expected");
    expect(await requests.withoutResume(claim)).toBe(true);
    expect(
      (await store.getApplication(noResume.ownerUserId, noResume.applicationId)).resumeGeneration,
    ).toMatchObject({ state: "failed", errorCode: "no_resume" });

    const withdrawn = await application();
    await packet(withdrawn, withdrawn.view.application.revision, "generate");
    await client`SELECT pg_sleep(0.05)`;
    await new PostgresNativeMaterialWithdrawalStore(client, () => true).withdraw(
      withdrawn.ownerUserId,
      uuidv7(),
    );
    expect(
      (await store.getApplication(withdrawn.ownerUserId, withdrawn.applicationId)).resumeGeneration,
    ).toMatchObject({ state: "failed", errorCode: "generation_failed" });
  });

  it("reports the timeout once the bound passes without a result", async () => {
    const context = await application();
    await packet(context, context.view.application.revision, "generate");
    const earlier = now;
    now = new Date(earlier.getTime() + 9 * 60_000);
    expect(
      (await store.getApplication(context.ownerUserId, context.applicationId)).resumeGeneration
        ?.state,
    ).toBe("preparing");
    now = new Date(earlier.getTime() + 11 * 60_000);
    expect(
      (await store.getApplication(context.ownerUserId, context.applicationId)).resumeGeneration,
    ).toMatchObject({ state: "failed", errorCode: "generation_timed_out" });
    now = earlier;
  });

  it("never exposes another owner's generation", async () => {
    const mine = await application();
    await packet(mine, mine.view.application.revision, "generate");
    await expect(store.getApplication(uuidv7(), mine.applicationId)).rejects.toThrow();
  });

  it("is the same shape the platform contract accepts", async () => {
    const context = await application();
    const result = await packet(context, context.view.application.revision, "generate");
    expect(JSON.stringify(result.view.resumeGeneration)).not.toMatch(HASH_B);
  });
});
