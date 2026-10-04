import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ModelGateway } from "@ai-job-apply/ai-sdk";
import {
  createApplicationsDatabase,
  type FieldDefinition,
  PostgresApplicationStore,
  type PreparationRecord,
} from "@ai-job-apply/applications-service";
import {
  COVER_LETTER_PROVIDER_MODEL,
  CoverLetterProviderControlClient,
  type CoverLetterProviderObjects,
  type CoverLetterProviderSlot,
  coverLetterProviderSha256,
  createCoverLetterIsolatedProviderHandler,
} from "@ai-job-apply/documents-service/cover-letter-provider";
import {
  type CoverLetterObjectStore,
  CoverLetterProviderInvoker,
  createCoverLetterProviderControlHandler,
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import { createDatabase, PostgresProfileStore } from "@ai-job-apply/profile-service";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApplicationPreparationActivityHandler } from "./application-preparation-activity.js";
import { createIsolatedCoverLetterPreparationPort } from "./application-preparation-documents.js";
import { createApplicationPreparationDurableHandler } from "./application-preparation-durable.js";

const requested = process.env.PRIVATE_PREPARATION_INTEGRATION === "1";
const databaseUrl = process.env.PRIVATE_PREPARATION_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/private_preparation_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("PrivatePreparationIntegrationTargetRejected");
}
const execute = promisify(execFile);

describe.skipIf(!requested)(
  "owned Applications activity through isolated Documents preparation",
  () => {
    const url = databaseUrl ?? "postgres://invalid";
    const profileDb = createDatabase(url, { maxConnections: 1 });
    const applicationsDb = createApplicationsDatabase(url, { maxConnections: 1 });
    const jobsDb = createJobCatalogDatabase(url, { maxConnections: 1 });
    const documentsDb = createApplicationsDatabase(url, { maxConnections: 1 });
    const workDb = createApplicationsDatabase(url, { maxConnections: 1 });
    const leaseDb = createApplicationsDatabase(url, { maxConnections: 1 });
    const profile = new PostgresProfileStore(profileDb);
    const catalog = new PostgresJobCatalog(jobsDb, {
      searchCursorKeys: { active: { id: "synthetic-v1", key: Buffer.alloc(32, 1) } },
    });
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
    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of ["profile", "jobs", "applications", "documents"]) {
        const path = fileURLToPath(
          new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url),
        );
        const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl } };
        const first = await execute(process.execPath, [path], options);
        expect((await execute(process.execPath, [path], options)).stdout).toBe(first.stdout);
      }
      await LocalDurableTestRunner.setupTestEnvironment({ skipTime: false });
    }, 90_000);
    afterAll(async () => {
      await LocalDurableTestRunner.teardownTestEnvironment();
      await Promise.all([
        profileDb.client.end(),
        applicationsDb.end(),
        jobsDb.end(),
        documentsDb.end(),
        workDb.end(),
        leaseDb.end(),
      ]);
    });

    it.each([
      "none",
      "durable_replay",
      "invoke_ack",
      "delayed_result",
      "grant_ack",
      "slot_ack",
      "quarantine",
    ] as const)(
      "connects accepted preparation, isolated dispatch and packet finalization: %s",
      async (fault) => {
        let now = new Date();
        let revealResult = fault !== "delayed_result";
        const applications = new PostgresApplicationStore(applicationsDb, () => now, {
          definitions,
        });
        const user = await profile.resolveUser(
          {
            issuer: "https://synthetic-preparation.invalid/",
            subject: uuidv7(),
            audience: ["ai-job-apply-api"],
            scopes: [],
          },
          "synthetic",
        );
        const fact = await profile.createProfileFact(
          user.id,
          {
            kind: "skill",
            key: "programming_language",
            value: "TypeScript",
            sensitivity: "standard",
          },
          uuidv7(),
          "synthetic",
        );
        const observed = await catalog.recordObservation({
          provider: "greenhouse",
          provenance: "authorized_fixture",
          companyName: `Synthetic ${uuidv7()}`,
          title: "Engineer",
          locations: ["Remote - US"],
          description: "Build reliable systems with TypeScript.",
          sourceUrl: `https://jobs.example.test/${uuidv7()}`,
          observedAt: now,
          atsTenant: uuidv7(),
          externalJobId: uuidv7(),
          adapterVersion: "synthetic.v1",
        });
        const { view } = await applications.createApplication({
          ownerUserId: user.id,
          canonicalJobId: observed.job.id,
          idempotencyKey: uuidv7(),
        });
        const applicationId = view.application.id;
        const finalBytes = new Map<string, Uint8Array>();
        const finalWrite = vi.fn<CoverLetterObjectStore["putIfAbsent"]>(async (input) => {
          const existing = finalBytes.get(input.objectKey);
          if (existing && !Buffer.from(existing).equals(Buffer.from(input.bytes)))
            throw Error("SyntheticImmutableConflict");
          finalBytes.set(input.objectKey, Uint8Array.from(input.bytes));
          return { objectVersion: "synthetic-final-v1", created: !existing };
        });
        const finalObjects: CoverLetterObjectStore = {
          putIfAbsent: finalWrite,
          find: async (input) =>
            finalBytes.has(input.objectKey) ? { objectVersion: "synthetic-final-v1" } : null,
          read: async (input) => {
            const bytes = finalBytes.get(input.objectKey);
            if (!bytes) throw Error("SyntheticAbsentFinalBytes");
            return Uint8Array.from(bytes);
          },
        };
        const work = new PostgresCoverLetterWorkStore(workDb, () => true);
        const documents = new PostgresCoverLetterStore(documentsDb, finalObjects, work);
        const candidateLease = new PostgresCoverLetterStore(leaseDb, finalObjects, work);
        const slots = new Map<CoverLetterProviderSlot, Uint8Array>();
        const reference = (bytes: Uint8Array) => ({
          objectVersion: "synthetic-slot-v1",
          etag: `"${coverLetterProviderSha256(bytes)}"`,
          sha256: coverLetterProviderSha256(bytes),
          sizeBytes: bytes.length,
        });
        const find: CoverLetterProviderObjects["find"] = async (_id, slot) => {
          const bytes = slots.get(slot);
          if (
            slot === "result" &&
            bytes &&
            !revealResult &&
            JSON.parse(new TextDecoder().decode(bytes)).state === "ready"
          )
            return undefined;
          return bytes ? reference(bytes) : undefined;
        };
        const read: CoverLetterProviderObjects["read"] = async (_id, slot) => {
          const bytes = slots.get(slot);
          if (!bytes) throw Error("SyntheticAbsentSlot");
          return Uint8Array.from(bytes);
        };
        const create = vi.fn<CoverLetterProviderObjects["putIfAbsent"]>(
          async (_id, slot, bytes) => {
            const prior = slots.get(slot);
            if (prior) return { created: false, reference: reference(prior) };
            slots.set(slot, Uint8Array.from(bytes));
            if (fault === "slot_ack" && slot === "dispatch")
              throw Error("SyntheticCommittedSlotAckLost");
            return { created: true, reference: reference(bytes) };
          },
        );
        const transition: CoverLetterProviderObjects["transitionIfMatch"] = async (
          _id,
          slot,
          prior,
          bytes,
        ) => {
          const existing = slots.get(slot);
          if (!existing || reference(existing).etag !== prior.etag) return { changed: false };
          slots.set(slot, Uint8Array.from(bytes));
          return { changed: true, reference: reference(bytes) };
        };
        const complete = vi.fn(async () => ({
          text: JSON.stringify({
            paragraphs: [{ text: "I have experience with TypeScript.", factIds: [fact.id] }],
          }),
        }));
        const controlArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:3";
        const control = createCoverLetterProviderControlHandler({
          functionArn: controlArn,
          work,
          enabled: () => true,
        });
        const isolated = createCoverLetterIsolatedProviderHandler({
          objects: { find, read, transitionIfMatch: transition },
          enabled: () => true,
          clock: () => now,
          gateway: new ModelGateway(
            { identity: COVER_LETTER_PROVIDER_MODEL, complete },
            { enabled: () => true, clock: () => now },
          ),
          work: new CoverLetterProviderControlClient(
            controlArn,
            {
              config: { maxAttempts: async () => 1 },
              send: async (command) => {
                const input = JSON.parse(
                  new TextDecoder().decode(command.input.Payload as Uint8Array),
                );
                const output = await control(input, { invokedFunctionArn: controlArn });
                return {
                  StatusCode: 200,
                  ExecutedVersion: "3",
                  Payload: new TextEncoder().encode(JSON.stringify(output)),
                };
              },
            },
            () => true,
          ),
        });
        const providerArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:7";
        const send = vi.fn(async (command: import("@aws-sdk/client-lambda").InvokeCommand) => {
          expect(command.input.FunctionName).toBe(providerArn);
          const text = new TextDecoder().decode(command.input.Payload as Uint8Array);
          expect(text).not.toContain("TypeScript");
          expect(text).not.toContain(user.id);
          const input = JSON.parse(text);
          expect(Object.keys(input)).toEqual(["schemaVersion", "documentId", "request"]);
          const output = await isolated(input);
          if (fault === "quarantine")
            await profileDb.client`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${user.id}`;
          if (fault === "invoke_ack") throw Error("SyntheticCommittedInvokeAckLost");
          return {
            StatusCode: 200,
            ExecutedVersion: "7",
            Payload: new TextEncoder().encode(JSON.stringify(output)),
          };
        });
        const issueProviderDispatch = vi.fn(
          async (input: Parameters<typeof work.issueProviderDispatch>[0]) => {
            const result = await work.issueProviderDispatch(input);
            if (fault === "grant_ack") throw Error("SyntheticCommittedGrantAckLost");
            return result;
          },
        );
        const port = createIsolatedCoverLetterPreparationPort({
          owners: { applications, profile, catalog },
          documents,
          candidateLease,
          objects: { find, read, putIfAbsent: create },
          work: {
            issue: work.issue.bind(work),
            claim: work.claim.bind(work),
            recordSettled: work.recordSettled.bind(work),
            issueProviderDispatch,
          },
          provider: new CoverLetterProviderInvoker(
            providerArn,
            { config: { maxAttempts: async () => 1 }, send },
            () => true,
          ),
          enabled: () => true,
          clock: () => now,
        });
        const placeholder: PreparationRecord = {
          id: uuidv7(),
          ownerUserId: user.id,
          applicationId,
          basePacketId: uuidv7(),
          expectedRevision: 1,
          jobContextHash: "a".repeat(64),
          confirmedFactsHash: "b".repeat(64),
          noticeVersion: "openai-cover-letter.v1",
          approvedAt: now,
          expiresAt: new Date(now.getTime() + 900_000),
          generationClaimedAt: null,
          state: "queued",
          resultPacketId: null,
          errorCode: null,
          createdAt: now,
          updatedAt: now,
        };
        const context = await port.context(placeholder);
        const queued = await applications.queuePreparation({
          ownerUserId: user.id,
          applicationId,
          idempotencyKey: uuidv7(),
          context,
          request: {
            expectedRevision: 1,
            coverLetter: {
              disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
            },
          },
          packet: {
            jobRevision: context.jobContextHash,
            form: null,
            fields: [],
            artifactHashes: {},
          },
        });
        const [outbox] = await applicationsDb<
          Array<{ id: string; payload: { preparationId: string } }>
        >`SELECT id, payload FROM applications.preparation_outbox WHERE preparation_id = ${queued.preparation.id}`;
        if (!outbox) throw Error("SyntheticMissingOutbox");
        const input = {
          schemaVersion: 1,
          workflowDefinitionVersion: 1,
          eventId: outbox.id,
          preparationId: queued.preparation.id,
          action: "advance",
        };
        const activity = createApplicationPreparationActivityHandler(applications, port);
        const first =
          fault === "durable_replay"
            ? await (async () => {
                const arn =
                  "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation-activity:9";
                const runner = new LocalDurableTestRunner({
                  handlerFunction: createApplicationPreparationDurableHandler(arn),
                });
                runner.registerFunction(arn, activity);
                const payload = {
                  schemaVersion: 1,
                  eventId: outbox.id,
                  eventType: "application.packet-preparation.requested.v1",
                  data: outbox.payload,
                };
                const result = await runner.run({ payload });
                expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
                expect(result.getResult()).toMatchObject({
                  preparationId: queued.preparation.id,
                  state: "completed",
                });
                expect(JSON.stringify(result.getResult())).not.toContain("TypeScript");
                return activity(input);
              })()
            : await activity(input);

        const succeeds = ["none", "durable_replay", "invoke_ack", "delayed_result"].includes(fault);
        if (fault === "delayed_result") {
          expect(first.outcome).toBe("retryable_failure");
          revealResult = true;
          now = new Date(queued.preparation.expiresAt.getTime() + 1);
        }
        const before =
          await workDb`SELECT * FROM documents.cover_letter_work_authorizations WHERE document_id = ${queued.preparation.id} ORDER BY id`;
        const replay = await activity(input);

        expect(replay.outcome).toBe(succeeds ? "completed" : "retryable_failure");
        if (fault === "quarantine")
          expect(replay).toMatchObject({ errorCode: "context_unavailable" });
        expect(complete).toHaveBeenCalledTimes(["grant_ack", "slot_ack"].includes(fault) ? 0 : 1);
        expect(send).toHaveBeenCalledTimes(["grant_ack", "slot_ack"].includes(fault) ? 0 : 1);
        expect(create.mock.calls.map((call) => call[1])).toEqual(["request", "result", "dispatch"]);
        expect(issueProviderDispatch).toHaveBeenCalledTimes(fault === "slot_ack" ? 0 : 1);
        expect(JSON.stringify(first)).not.toContain("TypeScript");
        expect(JSON.stringify(replay)).not.toContain(user.id);
        if (succeeds) {
          const result = await applications.getPreparation(
            user.id,
            applicationId,
            queued.preparation.id,
          );
          expect(result.state).toBe("succeeded");
          expect(result.approvedAt).toEqual(queued.preparation.approvedAt);
          expect(result.expiresAt).toEqual(queued.preparation.expiresAt);
          const view = await applications.getApplication(user.id, applicationId);
          expect(view.application.status).toBe("review_required");
          expect(view.currentPacket?.version).toBe(2);
          expect(view.currentPacket?.fields[0]).toMatchObject({
            fieldKey: "documents.cover_letter",
            origin: "generated",
            requiresReview: true,
          });
          expect(view.currentPacket?.artifactHashes.coverLetter).toMatch(/^[a-f0-9]{64}$/u);
          expect(finalWrite).toHaveBeenCalledTimes(1);
          expect(await activity(input)).toMatchObject({ outcome: "completed" });
          expect(send).toHaveBeenCalledTimes(1);
        } else {
          expect(finalWrite).not.toHaveBeenCalled();
          expect(
            await workDb`SELECT * FROM documents.cover_letter_work_authorizations WHERE document_id = ${queued.preparation.id} ORDER BY id`,
          ).toEqual(before);
          if (fault === "quarantine") {
            expect(await work.readDrainState(user.id, queued.preparation.id)).toBe("untracked");
            const [document] =
              await documentsDb`SELECT status FROM documents.cover_letters WHERE id = ${queued.preparation.id}`;
            expect(document?.status).toBe("pending");
          } else {
            await expect(
              documentsDb`DELETE FROM documents.cover_letters WHERE id = ${queued.preparation.id}`,
            ).rejects.toThrow();
          }
        }
      },
    );
  },
);
