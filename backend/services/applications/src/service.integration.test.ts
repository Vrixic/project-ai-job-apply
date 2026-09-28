import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApplicationJobGate,
  ApplicationJobUnavailableError,
  ApplicationsService,
  InvalidApplicationCursorError,
  type LiveBindingsSource,
  type PacketPreparationSource,
} from "./service.js";
import { PostgresApplicationStore } from "./store.js";
import { definitions, HASH_A, HASH_B, HASH_C, proposal } from "./test-support.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const key = (label: string) => `${label}-${uuidv7()}`.slice(0, 64).padEnd(16, "x");
const validateApplication = compileComponentValidator("Application");
const validatePage = compileComponentValidator("ApplicationPage");
const validateHistory = compileComponentValidator("ApplicationHistoryPage");
const validateStart = compileComponentValidator("ApplicationSubmissionStart");
const validateAttempt = compileComponentValidator("ApplicationAttempt");

describeWithDatabase("ApplicationsService over PostgreSQL", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 4,
    onnotice: () => undefined,
  });
  const activeJobs = new Set<string>();
  let liveJobRevision = HASH_A;
  const store = new PostgresApplicationStore(client, () => new Date(), { definitions });
  const packets: PacketPreparationSource = {
    async prepare({ userEntries }) {
      return {
        jobRevision: liveJobRevision,
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
        fields: [
          proposal(),
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
  };
  const bindings: LiveBindingsSource = {
    async resolve({ formHash }) {
      return { jobRevision: liveJobRevision, formHash, resumeHash: HASH_C };
    },
  };
  const jobs: ApplicationJobGate = { isActive: async (jobId) => activeJobs.has(jobId) };
  const service = new ApplicationsService({ store, packets, bindings, jobs });

  beforeAll(async () => {
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    await execFileAsync(process.execPath, [migrationExecutable], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  function newJob() {
    const jobId = uuidv7();
    activeJobs.add(jobId);
    return jobId;
  }

  it("refuses to start an application for a job that is not active", async () => {
    await expect(service.create(uuidv7(), uuidv7(), key("create"))).rejects.toThrow(
      ApplicationJobUnavailableError,
    );
  });

  it("drives prepare, approve, submit, and confirm through contract-valid responses", async () => {
    const owner = uuidv7();
    const created = await service.create(owner, newJob(), key("create"));
    expect(validateApplication(created)).toBe(true);

    const prepared = await service.preparePacket(
      owner,
      created.id,
      {
        expectedRevision: created.revision,
        userEntries: [{ fieldKey: "attestation.truthful", value: true }],
      },
      key("packet"),
    );
    expect(validateApplication(prepared)).toBe(true);
    expect(prepared.currentAction).toBe("review_and_approve");
    const attestation = prepared.currentPacket?.fields.find(
      (field) => field.fieldKey === "attestation.truthful",
    );
    expect(attestation).toMatchObject({
      origin: "user_entered",
      requiresReview: true,
      value: true,
    });

    // Skipping the attestation acknowledgement refuses approval.
    await expect(
      service.approve(
        owner,
        created.id,
        {
          expectedRevision: prepared.revision,
          packetHash: prepared.currentPacket?.packetHash ?? "",
          acknowledgedFieldKeys: [],
        },
        key("approve-bad"),
      ),
    ).rejects.toMatchObject({ code: "UNACKNOWLEDGED_FIELD" });

    const approved = await service.approve(
      owner,
      created.id,
      {
        expectedRevision: prepared.revision,
        packetHash: prepared.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: ["attestation.truthful"],
      },
      key("approve"),
    );
    expect(validateApplication(approved)).toBe(true);
    expect(approved.currentAction).toBe("ready_to_submit");

    const start = await service.startSubmission(
      owner,
      created.id,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: HASH_B,
      },
      key("start"),
    );
    expect(validateStart(start)).toBe(true);
    expect(start.outcome).toBe("started");
    const attemptId = start.attemptId ?? "";

    const dispatched = await service.dispatchAttempt(owner, created.id, attemptId);
    expect(validateAttempt(dispatched)).toBe(true);
    expect(dispatched.status).toBe("dispatched");

    const applied = await service.recordResult(
      owner,
      created.id,
      attemptId,
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
    expect(validateApplication(applied)).toBe(true);
    expect(applied.status).toBe("applied");

    const history = await service.history(owner, created.id, {});
    expect(validateHistory(history)).toBe(true);
    expect(history.entries.at(-1)).toMatchObject({
      kind: "submission_confirmed",
      toStatus: "applied",
    });
    expect(JSON.stringify(history)).not.toMatch(/interview|offer|recruiter|hired/i);
  });

  it("records a hand-completed submission through takeover and candidate attestation", async () => {
    const manualService = new ApplicationsService({
      store,
      jobs,
      bindings,
      packets: {
        async prepare({ userEntries }) {
          return {
            jobRevision: liveJobRevision,
            form: null,
            fields: [
              proposal(),
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
    });
    const owner = uuidv7();
    const created = await manualService.create(owner, newJob(), key("manual-create"));
    const prepared = await manualService.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision },
      key("manual-packet"),
    );
    const approved = await manualService.approve(
      owner,
      created.id,
      {
        expectedRevision: prepared.revision,
        packetHash: prepared.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: [],
      },
      key("manual-approve"),
    );

    const start = await manualService.startManualSubmission(
      owner,
      created.id,
      { expectedRevision: approved.revision },
      key("manual-start"),
    );
    expect(validateStart(start)).toBe(true);
    expect(start).toMatchObject({
      outcome: "started",
      application: {
        status: "takeover",
        currentAction: "complete_manually",
        attempts: [
          {
            status: "taken_over",
            adapterId: "manual",
            adapterVersion: "none",
          },
        ],
      },
    });
    expect(start.application.attempts[0]?.dispatchedAt).toBeUndefined();

    const applied = await manualService.reconcile(
      owner,
      created.id,
      start.attemptId ?? "",
      {
        kind: "user_attested_submitted",
        observedAt: new Date().toISOString(),
        fingerprintSha256: HASH_A,
      },
      key("manual-reconcile"),
    );
    expect(validateApplication(applied)).toBe(true);
    expect(applied.status).toBe("applied");
    expect((await manualService.history(owner, created.id, {})).entries.at(-1)).toMatchObject({
      kind: "submission_confirmed",
      toStatus: "applied",
    });
  });

  it("does not submit when the live form no longer matches the approved packet", async () => {
    const owner = uuidv7();
    const created = await service.create(owner, newJob(), key("create"));
    const prepared = await service.preparePacket(
      owner,
      created.id,
      { expectedRevision: created.revision },
      key("packet"),
    );
    const approved = await service.approve(
      owner,
      created.id,
      {
        expectedRevision: prepared.revision,
        packetHash: prepared.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: [],
      },
      key("approve"),
    );
    const start = await service.startSubmission(
      owner,
      created.id,
      {
        expectedRevision: approved.revision,
        adapterId: "greenhouse",
        adapterVersion: "1.0.0",
        observedFormHash: "f".repeat(64),
      },
      key("start"),
    );
    expect(validateStart(start)).toBe(true);
    expect(start).toMatchObject({
      outcome: "approval_invalidated",
      invalidationReasons: ["form_changed"],
    });
    expect(start.attemptId).toBeUndefined();
    expect(start.application.status).toBe("review_required");
    expect(start.application.approval).toBeUndefined();
  });

  it("finds only this owner's applications for one job, newest first, so a live one can be reopened", async () => {
    const owner = uuidv7();
    const jobA = newJob();
    const jobB = newJob();
    const first = await service.create(owner, jobA, key("filter-a1"));
    await service.create(owner, jobB, key("filter-b1"));
    const onlyA = await service.search(owner, { jobId: jobA });
    expect(validatePage(onlyA)).toBe(true);
    expect(onlyA.items.map((item) => item.id)).toEqual([first.id]);
    expect((await service.search(owner, { jobId: jobB })).items).toHaveLength(1);
    expect((await service.search(owner, { jobId: newJob() })).items).toHaveLength(0);
    // Another candidate never sees this owner's application for the same job.
    expect((await service.search(uuidv7(), { jobId: jobA })).items).toHaveLength(0);

    // After a cancellation the candidate may start again; the newest application comes first.
    await service.cancel(owner, first.id, first.revision, key("filter-cancel"));
    const restarted = await service.create(owner, jobA, key("filter-a2"));
    const both = await service.search(owner, { jobId: jobA });
    expect(both.items.map((item) => item.id)).toEqual([restarted.id, first.id]);
    expect(both.items[0]?.status).not.toBe("cancelled");
    expect(both.items[1]?.status).toBe("cancelled");
  });

  it("pages owner applications with a strict cursor and never leaks another owner", async () => {
    const owner = uuidv7();
    for (let index = 0; index < 3; index += 1) {
      await service.create(owner, newJob(), key(`create-${index}`));
    }
    const first = await service.search(owner, { limit: 2 });
    expect(validatePage(first)).toBe(true);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.search(owner, { limit: 2, cursor: first.nextCursor ?? "" });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const seen = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(seen.size).toBe(3);

    await expect(service.search(owner, { cursor: "not-a-cursor" })).rejects.toThrow(
      InvalidApplicationCursorError,
    );
    const forged = Buffer.from(
      JSON.stringify({ u: "2030-01-01T00:00:00.000Z", i: "nope" }),
    ).toString("base64url");
    await expect(service.search(owner, { cursor: forged })).rejects.toThrow(
      InvalidApplicationCursorError,
    );
    expect((await service.search(uuidv7(), {})).items).toHaveLength(0);
    liveJobRevision = HASH_A;
  });
});
