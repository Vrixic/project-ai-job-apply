import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryMetricSink } from "./metrics.js";
import {
  createFixtureServiceApplication,
  createIntegrationApplicationStore,
  createIntegrationApplicationsService,
} from "./restricted-packet-integration-support.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");

describeWithDatabase("Applications measurement over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const sink = new InMemoryMetricSink();
  const jobId = uuidv7();
  const service = createIntegrationApplicationsService({
    store: createIntegrationApplicationStore(client, () => new Date(), { definitions }),
    packets: {
      async prepare({ userEntries }) {
        return {
          jobRevision: HASH_A,
          form: { adapterId: "greenhouse", variantId: "board-v1", formHash: HASH_B },
          fields: [
            ...(userEntries.some((entry) => entry.fieldKey === "contact.email")
              ? []
              : [proposal({ value: "private@example.test" })]),
            ...userEntries.map((entry) =>
              proposal({
                fieldKey: entry.fieldKey,
                value: entry.value,
                origin: "user_entered",
                sourceFactIds: [],
              }),
            ),
          ],
          artifactHashes: { resume: HASH_C },
        };
      },
    },
    bindings: {
      async resolve({ formHash }) {
        return { jobRevision: HASH_A, formHash, resumeHash: HASH_C };
      },
    },
    jobs: { isActive: async () => true },
    metrics: sink,
  });

  beforeAll(async () => {
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("emits versioned funnel, correction, and attempt metrics without candidate values", async () => {
    const owner = uuidv7();
    const created = await createFixtureServiceApplication(
      service,
      client,
      owner,
      jobId,
      key("create"),
    );
    const first = await service.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision },
      key("packet"),
    );
    // The candidate corrects the proposed email, producing a second packet version.
    const second = await service.preparePacket(
      owner,
      created.id,
      {
        expectedRevision: first.revision,
        userEntries: [{ fieldKey: "contact.email", value: "corrected@example.test" }],
      },
      key("packet2"),
    );
    const approved = await service.approve(
      owner,
      created.id,
      {
        expectedRevision: second.revision,
        packetHash: second.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: ["contact.email"],
      },
      key("approve"),
    );
    const start = await service.startSubmission(
      owner,
      created.id,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.4.0",
        observedFormHash: HASH_B,
      },
      key("start"),
    );
    await service.dispatchAttempt(owner, created.id, start.attemptId ?? "");
    await service.recordResult(
      owner,
      created.id,
      start.attemptId ?? "",
      {
        kind: "confirmed",
        confirmation: {
          kind: "provider_confirmation_page",
          observedAt: new Date().toISOString(),
          fingerprintSha256: HASH_A,
        },
      },
      key("result"),
    );

    const stages = sink.events
      .filter((event) => event.name === "application_funnel")
      .map((event) => event.dimensions.stage);
    expect(stages).toEqual([
      "created",
      "packet_prepared",
      "packet_prepared",
      "approved",
      "submission_started",
      "applied",
    ]);
    const correction = sink.events.find((event) => event.name === "field_correction");
    expect(correction?.dimensions).toMatchObject({
      fieldKey: "contact.email",
      variant: "board-v1",
      reason: "value_changed",
    });
    const outcome = sink.events.find((event) => event.name === "attempt_outcome");
    expect(outcome?.dimensions).toMatchObject({
      adapter: "greenhouse",
      adapterVersion: "1.4.0",
      outcome: "confirmed",
    });
    expect(sink.events.some((event) => event.name === "attempt_latency_ms")).toBe(true);
    expect(sink.events.some((event) => event.name === "review_latency_ms")).toBe(true);
    // Not a single event carries a candidate value or identifier.
    const serialized = JSON.stringify(sink.events);
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain(created.id);
  });
});
