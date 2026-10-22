import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationEventOutbox } from "./outbox-feed.js";
import {
  createFixtureServiceApplication,
  createIntegrationApplicationStore,
  createIntegrationApplicationsService,
} from "./restricted-packet-integration-support.js";
import type { ApplicationJobGate, LiveBindingsSource, PacketPreparationSource } from "./service.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");

describeWithDatabase("ApplicationEventOutbox over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const activeJobs = new Set<string>();
  const store = createIntegrationApplicationStore(client, () => new Date(), { definitions });
  const packets: PacketPreparationSource = {
    async prepare() {
      return {
        jobRevision: HASH_A,
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
        fields: [proposal()],
        artifactHashes: { resume: HASH_C },
      };
    },
  };
  const bindings: LiveBindingsSource = {
    async resolve({ formHash }) {
      return { jobRevision: HASH_A, formHash, resumeHash: HASH_C };
    },
  };
  const jobs: ApplicationJobGate = { isActive: async (jobId) => activeJobs.has(jobId) };
  const service = createIntegrationApplicationsService({ store, packets, bindings, jobs });
  const outbox = new ApplicationEventOutbox(client, 5_000);

  beforeAll(async () => {
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
  });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function application() {
    const owner = uuidv7();
    const jobId = uuidv7();
    activeJobs.add(jobId);
    const created = await createFixtureServiceApplication(
      service,
      client,
      owner,
      jobId,
      key("create"),
    );
    await service.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision },
      key("packet"),
    );
    return { owner, id: created.id };
  }

  it("claims one owner's pending events oldest first and only that owner's", async () => {
    const mine = await application();
    const other = await application();
    const at = new Date(Date.now() + 1_000);
    const claimed = await outbox.claimForOwner(mine.owner, 10, at);
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.every((event) => event.data.userId === mine.owner)).toBe(true);
    expect(claimed.every((event) => event.data.applicationId === mine.id)).toBe(true);
    const revisions = claimed.map((event) => event.data.revision);
    expect([...revisions].sort((a, b) => a - b)).toEqual(revisions);
    // The payload is identifiers and a status only.
    expect(Object.keys(claimed[0]?.data ?? {}).sort()).toEqual([
      "applicationId",
      "revision",
      "status",
      "userId",
    ]);
    const theirs = await outbox.claimForOwner(other.owner, 10, at);
    expect(theirs.every((event) => event.data.userId === other.owner)).toBe(true);
  });

  it("does not hand the same event out twice while its lease is held", async () => {
    const mine = await application();
    const at = new Date(Date.now() + 1_000);
    const first = await outbox.claimForOwner(mine.owner, 10, at);
    expect(first.length).toBeGreaterThan(0);
    expect(await outbox.claimForOwner(mine.owner, 10, at)).toEqual([]);
  });

  it("publishes with the claim token and refuses a stale one", async () => {
    const mine = await application();
    const at = new Date(Date.now() + 1_000);
    const [event] = await outbox.claimForOwner(mine.owner, 1, at);
    if (!event) throw new Error("expected an event");
    expect(await outbox.markPublished({ id: event.id, claimToken: uuidv7() }, at)).toBe(false);
    expect(await outbox.markPublished(event, at)).toBe(true);
    expect(await outbox.markPublished(event, at)).toBe(false);
  });

  it("retries a failed event after the backoff, and fails it after five attempts", async () => {
    const mine = await application();
    let now = new Date(Date.now() + 1_000);
    let seen: string | undefined;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const [event] = await outbox.claimForOwner(mine.owner, 1, now);
      if (!event) throw new Error(`expected an event on attempt ${attempt}`);
      seen ??= event.id;
      expect(event.id).toBe(seen);
      expect(await outbox.markFailed(event, now)).toBe(true);
      // The retry waits out the backoff.
      expect((await outbox.claimForOwner(mine.owner, 1, now)).map((e) => e.id)).not.toContain(seen);
      now = new Date(now.getTime() + 31_000);
    }
    const [row] = await client<{ status: string; attempt_count: number }[]>`
      SELECT status, attempt_count FROM applications.outbox WHERE id = ${seen ?? ""}::uuid
    `;
    expect(row).toEqual({ status: "failed", attempt_count: 5 });
  });

  it("treats an expired lease as a failed attempt and offers the event again", async () => {
    const mine = await application();
    const at = new Date(Date.now() + 1_000);
    const [event] = await outbox.claimForOwner(mine.owner, 1, at);
    if (!event) throw new Error("expected an event");
    const later = new Date(at.getTime() + 10_000);
    const again = await outbox.claimForOwner(mine.owner, 5, later);
    expect(again.map((entry) => entry.id)).toContain(event.id);
  });
});
