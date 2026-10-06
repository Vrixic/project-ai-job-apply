import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { coverLetterContext, ModelGateway, type ModelProvider } from "@ai-job-apply/ai-sdk";
import {
  type ApplicationStoreOptions,
  type CoverLetterPreparationPort,
  createApplicationsDatabase,
  type FieldDefinition,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import {
  CoverLetterGenerationService,
  type CoverLetterObjectStore,
  CoverLetterReadService,
  PostgresCoverLetterReadStore,
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import type { GraphFact } from "@ai-job-apply/domain";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApplicationPreparationActivityHandler } from "./application-preparation-activity.js";
import type { ApplicationPreparationDurableInput } from "./application-preparation-contract.js";
import {
  createPreparationStarter,
  PreparationDispatchPendingError,
} from "./application-preparation-dispatch.js";
import { createApplicationPreparationDurableHandler } from "./application-preparation-durable.js";
import {
  createPreparationReconciler,
  createPreparationTerminalHandler,
} from "./application-preparation-recovery.js";

const { createSyntheticPacketProtection } = await import(
  new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const packetProtection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  destroy(): void;
};

const databaseUrl = process.env.DATABASE_URL;
const execute = promisify(execFile);
const activityArn =
  "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation-activity:7";
const HASH = "a".repeat(64);
const START = new Date("2026-10-02T12:00:00Z");

(databaseUrl ? describe : describe.skip)(
  "real PostgreSQL preparation/grounding/artifact/packet workflow",
  () => {
    const client = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
      maxConnections: 6,
    });
    let now = START;
    const definitions = new Map<string, FieldDefinition>([
      [
        "documents.cover_letter",
        {
          key: "documents.cover_letter",
          label: "Cover letter",
          valueType: "file",
          sensitivity: "confidential",
          answerPolicy: "explicit_each_time",
        },
      ],
    ]);
    const applications = new PostgresApplicationStore(client, () => now, {
      definitions,
      restrictedPackets: packetProtection.options,
    });
    const controlClient = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
      maxConnections: 1,
    });
    const work = new PostgresCoverLetterWorkStore(controlClient, () => true);
    const objects = new Map<string, Uint8Array>();
    const objectStore: CoverLetterObjectStore = {
      async putIfAbsent(input) {
        const prior = objects.get(input.objectKey);
        if (prior && !Buffer.from(prior).equals(Buffer.from(input.bytes)))
          throw new Error("Synthetic conflicting bytes");
        objects.set(input.objectKey, Uint8Array.from(input.bytes));
        return { objectVersion: "synthetic-version-v1", created: !prior };
      },
      async read(input) {
        const bytes = objects.get(input.objectKey);
        if (!bytes) throw new Error("Synthetic missing bytes");
        return Uint8Array.from(bytes);
      },
      async find(input) {
        return objects.has(input.objectKey) ? { objectVersion: "synthetic-version-v1" } : null;
      },
    };
    const documents = new PostgresCoverLetterStore(client, objectStore, {
      // Fixture-only preceding provider settlement for the offline legacy generator. This
      // neither composes isolated production dispatch nor certifies remote model quiescence.
      async claimFinalDocument(binding) {
        const prior = await controlClient`SELECT id FROM documents.cover_letter_work_authorizations
          WHERE document_id = ${binding.documentId} AND purpose = 'provider_dispatch'`;
        if (!prior[0]) {
          const { authorization } = await work.issue({
            ...binding,
            purpose: "provider_dispatch",
            requestSha256: HASH,
            consentExpiresAt: new Date(Date.now() + 60_000),
          });
          expect((await work.claim(authorization)).kind).toBe("claimed");
          await work.recordSettled(authorization);
        }
        return work.claimFinalDocument(binding);
      },
      recordSettled: work.recordSettled.bind(work),
    });

    beforeAll(async () => {
      for (const service of ["profile", "applications", "documents"]) {
        const path = fileURLToPath(
          new URL(`../../services/${service}/dist/src/migrate.js`, import.meta.url),
        );
        const options = { env: { ...process.env, DATABASE_URL: databaseUrl } };
        const first = await execute(process.execPath, [path], options);
        const replay = await execute(process.execPath, [path], options);
        expect(replay.stdout).toBe(first.stdout);
      }
      // Real PostgreSQL I/O must retain native timers; SDK fake time also affects pool deadlines.
      await LocalDurableTestRunner.setupTestEnvironment({ skipTime: false });
    }, 30_000);
    afterAll(async () => {
      packetProtection.destroy();
      await LocalDurableTestRunner.teardownTestEnvironment();
      await client.end();
      await controlClient.end();
    });

    async function withFixture(
      run: (fixture: Awaited<ReturnType<typeof prepare>>) => Promise<void>,
      enabled = true,
    ) {
      const owner = uuidv7();
      await client`INSERT INTO identity.users (id) VALUES (${owner})`;
      try {
        await run(await prepare(enabled, owner));
      } finally {
        const requestId = uuidv7();
        const operationId = uuidv7();
        await client`INSERT INTO platform.operations (id, user_id, kind, state) VALUES (${operationId}, ${owner}, 'account_deletion', 'queued')`;
        await client`INSERT INTO profile.account_deletion_requests (id, user_id, operation_id, policy_version, state, version, confirmed_at, backup_expires_at) VALUES (${requestId}, ${owner}, ${operationId}, 'synthetic-preparation-workflow-v1', 'quarantined', 2, now(), now() + interval '35 days')`;
        await client`INSERT INTO privacy.account_deletion_ledger (request_id, subject_digest, policy_version, policy_sha256, state, owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at) VALUES (${requestId}, ${HASH}, 'synthetic-preparation-workflow-v1', ${HASH}, 'quarantined', '{"applications":"pending","documents":"pending"}'::jsonb, '{}'::jsonb, now(), now() + interval '35 days')`;
        const ownedDocuments = await client<Array<{ id: string }>>`
          SELECT id FROM documents.cover_letters WHERE user_id = ${owner}
        `;
        for (const document of ownedDocuments) {
          await work.revokeUnclaimed(owner, document.id);
          objects.delete(`normalized/${document.id}/cover-letter.v1.json`);
        }
        await client`SELECT applications.delete_candidate_data(${owner}::uuid, ${requestId}::uuid)`;
        await client`SELECT documents.delete_candidate_data(${owner}::uuid, ${requestId}::uuid, true)`;
        await client`DELETE FROM identity.users WHERE id = ${owner}`;
        await client`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
      }
    }
    async function prepare(enabled: boolean, owner: string) {
      now = START;
      const created = await applications.createApplication({
        ownerUserId: owner,
        canonicalJobId: uuidv7(),
        idempotencyKey: uuidv7(),
      });
      const applicationId = created.view.application.id;
      const fact: GraphFact = {
        id: uuidv7(),
        kind: "skill",
        key: "skill",
        value: "TypeScript",
        verification: "confirmed",
        sensitivity: "standard",
        source: { type: "user", reference: "synthetic" },
        version: 1,
      };
      const job = {
        title: "Engineer",
        company: "Synthetic",
        description: "Build reliable systems.",
      };
      const source = {
        load: vi.fn(async (user: string, app: string) => {
          if (user !== owner || app !== applicationId) throw new Error("Synthetic foreign owner");
          return { facts: [fact], job };
        }),
      };
      const complete = vi.fn<ModelProvider["complete"]>(async () => ({
        text: JSON.stringify({
          paragraphs: [{ text: "I have experience with TypeScript.", factIds: [fact.id] }],
        }),
      }));
      // Synthetic offline provider and object transport. No live credentials or network calls.
      const gateway = new ModelGateway(
        { identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" }, complete },
        { enabled: () => enabled, clock: () => now },
      );
      const service = new CoverLetterGenerationService(documents, source, gateway, () => now);
      const readService = new CoverLetterReadService(
        new PostgresCoverLetterReadStore(client, objectStore),
        source,
        () => now,
      );
      const context = coverLetterContext({ facts: [fact], job, now });
      const queued = await applications.queuePreparation({
        ownerUserId: owner,
        applicationId,
        idempotencyKey: uuidv7(),
        context,
        request: {
          expectedRevision: 1,
          coverLetter: {
            disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
          },
        },
        packet: { jobRevision: HASH, form: null, fields: [], artifactHashes: {} },
      });
      const preparationId = queued.preparation.id;
      const [outbox] = await client<
        Array<{ id: string; payload: { preparationId: string } }>
      >`SELECT id, payload FROM applications.preparation_outbox WHERE preparation_id = ${preparationId}`;
      if (!outbox) throw new Error("Synthetic outbox missing");
      expect(outbox.payload).toEqual({ preparationId });
      const input: ApplicationPreparationDurableInput = {
        schemaVersion: 1,
        eventId: outbox.id,
        eventType: "application.packet-preparation.requested.v1",
        data: outbox.payload,
      };
      const runner = new LocalDurableTestRunner({
        handlerFunction: createApplicationPreparationDurableHandler(activityArn),
      });
      return {
        readService,
        preparation: {
          context: readService.context.bind(readService),
          generate: service.generate.bind(service),
          recover: service.recover.bind(service),
        },
        owner,
        applicationId,
        preparationId,
        input,
        runner,
        service,
        complete,
        source,
        fact,
      };
    }

    it("runs the real owned transactions through durable replay to a hash-bound mandatory-review packet", async () => {
      await withFixture(async (fixture) => {
        const handler = createApplicationPreparationActivityHandler(
          applications,
          fixture.preparation,
        );
        fixture.runner.registerFunction(activityArn, handler);
        const result = await fixture.runner.run({ payload: fixture.input });
        expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
        expect(result.getResult()).toMatchObject({
          preparationId: fixture.preparationId,
          state: "completed",
        });
        const operation = await applications.getPreparation(
          fixture.owner,
          fixture.applicationId,
          fixture.preparationId,
        );
        expect(operation.state).toBe("succeeded");
        const view = await applications.getApplication(fixture.owner, fixture.applicationId);
        expect(view.application.status).toBe("review_required");
        expect(view.currentPacket?.version).toBe(2);
        expect(view.currentPacket?.fields).toHaveLength(1);
        expect(view.currentPacket?.fields[0]).toMatchObject({
          fieldKey: "documents.cover_letter",
          origin: "generated",
          requiresReview: true,
          reasons: expect.arrayContaining(["generated_content"]),
        });
        const hash = view.currentPacket?.artifactHashes.coverLetter;
        expect(hash).toMatch(/^[a-f0-9]{64}$/u);
        if (!hash) throw new Error("Synthetic packet binding missing");
        expect(await fixture.readService.binding(fixture.owner, fixture.applicationId, hash)).toBe(
          hash,
        );
        expect(
          await fixture.readService.preview(fixture.owner, fixture.applicationId, hash),
        ).toMatchObject({ reviewRequired: true, matchesPacket: true });
        expect(
          await fixture.readService.file(fixture.owner, fixture.applicationId, hash, "pdf"),
        ).toMatchObject({ contentSha256: hash });
        expect(
          await fixture.readService.file(fixture.owner, fixture.applicationId, hash, "docx"),
        ).toMatchObject({ contentSha256: hash });
        const repeat = {
          schemaVersion: 1,
          workflowDefinitionVersion: 1,
          eventId: fixture.input.eventId,
          preparationId: fixture.preparationId,
          action: "advance",
        };
        expect(await handler(repeat)).toMatchObject({ outcome: "completed" });
        expect(await handler({ ...repeat, action: "fail" })).toMatchObject({
          outcome: "completed",
        });
        expect(
          (
            await applications.getPreparation(
              fixture.owner,
              fixture.applicationId,
              fixture.preparationId,
            )
          ).state,
        ).toBe("succeeded");
        expect(fixture.complete).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(fixture.input)).not.toContain("TypeScript");
        expect(JSON.stringify(result.getResult())).not.toContain("TypeScript");
      });
    });

    it("recovers the persisted draft after a transient final context read without another generation", async () => {
      await withFixture(async (fixture) => {
        let checks = 0;
        const port: CoverLetterPreparationPort = {
          context: async (identity) => {
            if (++checks === 2) throw new Error("Synthetic context outage");
            return fixture.readService.context(identity);
          },
          recover: (identity) => fixture.service.recover(identity),
          generate: (identity) => fixture.service.generate(identity),
        };
        fixture.runner.registerFunction(
          activityArn,
          createApplicationPreparationActivityHandler(applications, port),
        );
        expect((await fixture.runner.run({ payload: fixture.input })).getStatus()).toBe(
          ExecutionStatus.SUCCEEDED,
        );
        expect(
          (
            await applications.getPreparation(
              fixture.owner,
              fixture.applicationId,
              fixture.preparationId,
            )
          ).state,
        ).toBe("succeeded");
        expect(fixture.complete).toHaveBeenCalledTimes(1);
        expect(checks).toBe(4);
        const rows =
          await client`SELECT id FROM documents.cover_letters WHERE user_id = ${fixture.owner}`;
        expect(rows).toHaveLength(1);
      });
    });

    it("records disabled generation as a failed operation, not a successful cover letter", async () => {
      await withFixture(async (fixture) => {
        fixture.runner.registerFunction(
          activityArn,
          createApplicationPreparationActivityHandler(applications, fixture.preparation),
        );
        expect((await fixture.runner.run({ payload: fixture.input })).getStatus()).toBe(
          ExecutionStatus.SUCCEEDED,
        );
        expect(
          await applications.getPreparation(
            fixture.owner,
            fixture.applicationId,
            fixture.preparationId,
          ),
        ).toMatchObject({ state: "failed", errorCode: "generation_unavailable" });
        const view = await applications.getApplication(fixture.owner, fixture.applicationId);
        expect(view.currentPacket?.version).toBe(1);
        expect(view.currentPacket?.artifactHashes.coverLetter).toBeUndefined();
        expect(fixture.complete).not.toHaveBeenCalled();
      }, false);
    });

    it("recovers a lost Invoke ACK through owned nudges without another durable/model execution", async () => {
      await withFixture(async (fixture) => {
        const functionArn =
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation:7";
        const name = `preparation-${fixture.input.eventId}`;
        const executionArn = `${functionArn}/durable-execution/${name}/synthetic-id`;
        fixture.runner.registerFunction(
          activityArn,
          createApplicationPreparationActivityHandler(applications, fixture.preparation),
        );
        let executed = false;
        const invoke = vi.fn(
          async (input: {
            functionArn: string;
            executionName: string;
            payload: ApplicationPreparationDurableInput;
          }) => {
            expect(input).toEqual({ functionArn, executionName: name, payload: fixture.input });
            if (!executed) {
              executed = true;
              expect((await fixture.runner.run({ payload: input.payload })).getStatus()).toBe(
                ExecutionStatus.SUCCEEDED,
              );
              throw new Error("Synthetic lost Invoke ACK");
            }
            return { executionArn };
          },
        );
        const starter = createPreparationStarter(functionArn, applications, { start: invoke });
        await expect(starter(fixture.input)).rejects.toThrow(PreparationDispatchPendingError);
        expect(
          (await applications.getPreparationDispatch(fixture.input.eventId))?.executionArn,
        ).toBeNull();
        now = new Date(START.getTime() + 60_000);
        const recoveredStarter = createPreparationStarter(
          functionArn.replace(":7", ":8"),
          applications,
          { start: invoke },
        );
        const status = {
          read: vi.fn(async () => ({
            status: "SUCCEEDED" as const,
            startTimestamp: START,
            endTimestamp: new Date(START.getTime() + 1_000),
          })),
        };
        const reconciler = createPreparationReconciler(
          applications,
          { publish: recoveredStarter },
          status,
          { dispatchEnabled: true },
        );
        expect(await reconciler()).toMatchObject({ sent: 1, settled: 0, failed: 0 });
        now = new Date(START.getTime() + 120_000);
        expect(await reconciler()).toMatchObject({ inspected: 1, settled: 1, sent: 0, failed: 0 });
        expect(
          (await applications.getPreparationDispatch(fixture.input.eventId))?.terminalStatus,
        ).toBe("SUCCEEDED");
        expect(
          (
            await applications.getPreparation(
              fixture.owner,
              fixture.applicationId,
              fixture.preparationId,
            )
          ).state,
        ).toBe("succeeded");
        expect(fixture.complete).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(2);
      });
    });

    it("settles a lost-start terminal event with owned bindings and independent metadata", async () => {
      await withFixture(async (fixture) => {
        const functionArn =
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation:7";
        const name = `preparation-${fixture.input.eventId}`;
        const executionArn = `${functionArn}/durable-execution/${name}/synthetic-id`;
        const starter = createPreparationStarter(functionArn, applications, {
          start: async () => {
            throw Error("Synthetic ambiguous start");
          },
        });
        await expect(starter(fixture.input)).rejects.toThrow(PreparationDispatchPendingError);
        now = new Date(START.getTime() + 1_000);
        const read = vi.fn(async () => ({
          status: "FAILED" as const,
          startTimestamp: START,
          endTimestamp: now,
        }));
        const handler = createPreparationTerminalHandler(
          functionArn.replace(":7", ":8"),
          applications,
          { read },
          () => now,
        );
        const event = {
          version: "0",
          id: uuidv7(),
          source: "aws.lambda",
          "detail-type": "Durable Execution Status Change",
          account: "123456789012",
          region: "us-east-2",
          resources: [],
          time: now.toISOString(),
          detail: {
            functionArn,
            durableExecutionArn: executionArn,
            durableExecutionName: name,
            status: "FAILED",
            startTimestamp: START.toISOString(),
            endTimestamp: now.toISOString(),
          },
        };
        expect(await handler(event)).toEqual({ handled: true });
        expect(await handler(event)).toEqual({ handled: true });
        expect(
          (await applications.getPreparationDispatch(fixture.input.eventId))?.executionArn,
        ).toBe(executionArn);
        expect(
          await applications.getPreparation(
            fixture.owner,
            fixture.applicationId,
            fixture.preparationId,
          ),
        ).toMatchObject({ state: "failed", errorCode: "generation_unavailable" });
        expect(
          await client`SELECT action FROM applications.preparation_audit WHERE preparation_id = ${fixture.preparationId} AND action = 'failed'`,
        ).toHaveLength(1);
        expect(read).toHaveBeenCalledTimes(2);
        expect(fixture.complete).not.toHaveBeenCalled();
      });
    });

    it("refuses queued consent expiry before a Documents reservation or model call", async () => {
      await withFixture(async (fixture) => {
        now = new Date(START.getTime() + 15 * 60_000 + 1);
        fixture.runner.registerFunction(
          activityArn,
          createApplicationPreparationActivityHandler(applications, fixture.preparation),
        );
        expect((await fixture.runner.run({ payload: fixture.input })).getStatus()).toBe(
          ExecutionStatus.SUCCEEDED,
        );
        expect(
          await applications.getPreparation(
            fixture.owner,
            fixture.applicationId,
            fixture.preparationId,
          ),
        ).toMatchObject({
          state: "failed",
          errorCode: "disclosure_expired",
          generationClaimedAt: null,
        });
        expect(
          await client`SELECT id FROM documents.cover_letters WHERE user_id = ${fixture.owner}`,
        ).toHaveLength(0);
        expect(fixture.complete).not.toHaveBeenCalled();
      });
    });
  },
);
