import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import {
  type ApplicationStoreOptions,
  createApplicationsDatabase,
  createPreparationActivity,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { lockNativeMaterialApplicationAdmission } from "@ai-job-apply/applications-service/native-material-runtime";
import {
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
  PostgresNativeMaterialReadyStore,
  PostgresTemporaryMaterialCompletionStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import {
  createNativeLaunchControlClient,
  type NativeLaunchControlInput,
} from "@ai-job-apply/documents-service/native-launch-control";
import { createNativeMaterialControls } from "@ai-job-apply/documents-service/native-material-controls";
import {
  type NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "@ai-job-apply/documents-service/native-material-registry";
import { createNativeOwnerControlStore } from "@ai-job-apply/documents-service/native-owner-control-store";
import { createNativeOwnerEvidenceClient } from "@ai-job-apply/documents-service/native-owner-evidence-client";
import { createNativeOwnerRpcClient } from "@ai-job-apply/documents-service/native-owner-rpc-client";
import { nativeOwnerJson } from "@ai-job-apply/documents-service/native-owner-rpc-contract";
import { nativeTaskLaunchConfiguration } from "@ai-job-apply/documents-service/native-task-launch";
import { PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  PostgresProfileStore,
  profileFactToGraphFact,
} from "@ai-job-apply/profile-service";
import { type InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createNativeCoverLetterPreparationPort } from "./application-preparation-native.js";
import { createNativeApplicationPreparationRuntime } from "./native-application-preparation-lambda.js";
import {
  createNativeMaterialLaunchLambda,
  createNativeMaterialLaunchRuntime,
} from "./native-material-launch-lambda.js";
import {
  createNativeOwnerRpcLambda,
  createNativeOwnerRpcRuntime,
} from "./native-owner-rpc-lambda.js";

const requested = process.env.NATIVE_MATERIAL_LAUNCH_INTEGRATION === "1";
const url = process.env.NATIVE_MATERIAL_LAUNCH_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(url ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/native_material_launch_control" ||
    target.search ||
    target.hash
  )
    throw Error("SyntheticNativeLaunchDatabaseRejected");
}
const config = nativeTaskLaunchConfiguration({
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:7",
  containerName: "native-material",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/native@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/native-execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "DISABLED",
});
const target = "arn:aws:lambda:us-east-2:123456789012:function:private-native-launch:9";
type ECS = NonNullable<Parameters<typeof createNativeMaterialLaunchRuntime>[4]>;
const { createSyntheticPacketProtection } = await import(
  new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const packetProtection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  destroy(): void;
};
afterAll(() => packetProtection.destroy());
describe.runIf(requested)(
  "actual private native launcher SQL composition; simulated Lambda/ECS/secret transport",
  () => {
    const sql = createApplicationsDatabase(url ?? "postgres://invalid", { maxConnections: 2 });
    const work = new PostgresCoverLetterWorkStore(sql, () => true);
    const documents = new PostgresCoverLetterStore(sql, {
      putIfAbsent: async () => {
        throw Error("SyntheticObjectCapabilityDenied");
      },
      read: async () => {
        throw Error("SyntheticObjectCapabilityDenied");
      },
    });
    const runtimes: Array<{ close(): Promise<void> }> = [];
    beforeAll(async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of ["profile", "jobs", "applications", "documents"]) {
        const path = fileURLToPath(
          new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url),
        );
        const execute = promisify(execFile);
        const first = await execute(process.execPath, [path], {
          env: { ...environment, NODE_ENV: "test", DATABASE_URL: url },
        });
        const replay = await execute(process.execPath, [path], {
          env: { ...environment, NODE_ENV: "test", DATABASE_URL: url },
        });
        expect(replay.stdout).toBe(first.stdout);
      }
    }, 90_000);
    afterAll(async () => {
      await Promise.all(runtimes.map((runtime) => runtime.close()));
      await sql.end();
    });
    async function original(
      consentLifetimeMs = 900_000,
      seedEvidence?: (owner: string) => Promise<{
        jobId: string;
        context: { jobContextHash: string; confirmedFactsHash: string };
      }>,
      prepare = false,
    ): Promise<Extract<NativeLaunchControlInput, { action: "launch" }>> {
      const owner = uuidv7();
      let application = uuidv7();
      let document = uuidv7();
      await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
      const seeded = await seedEvidence?.(owner);
      let expiry = new Date(Date.now() + consentLifetimeMs);
      if (prepare && seeded) {
        const applicationStore = new PostgresApplicationStore(sql, () => new Date(), {
          definitions: defaultFieldDefinitions(),
          restrictedPackets: packetProtection.options,
        });
        const created = await applicationStore.createApplication({
          ownerUserId: owner,
          canonicalJobId: seeded.jobId,
          idempotencyKey: `create-${uuidv7()}`,
        });
        application = created.view.application.id;
        const queued = await applicationStore.queuePreparation({
          ownerUserId: owner,
          applicationId: application,
          idempotencyKey: `prepare-${uuidv7()}`,
          context: seeded.context,
          request: {
            expectedRevision: 1,
            coverLetter: {
              disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
            },
          },
          packet: {
            jobRevision: seeded.context.jobContextHash,
            form: null,
            fields: [],
            artifactHashes: { resume: "a".repeat(64) },
          },
        });
        document = queued.preparation.id;
        expiry = queued.preparation.expiresAt;
        const [event] = await sql<
          Array<{ id: string }>
        >`SELECT id FROM applications.preparation_outbox WHERE preparation_id=${document}`;
        if (
          !event ||
          (await applicationStore.claimPreparationGeneration(event.id, document, seeded.context))
            .kind !== "claimed"
        )
          throw Error("SyntheticPreparationClaimMissing");
      } else
        await sql`INSERT INTO applications.applications (id,owner_user_id,canonical_job_id,status,created_at,updated_at)
      VALUES (${application},${owner},${seeded?.jobId ?? uuidv7()},'preparing',clock_timestamp(),clock_timestamp())`;
      if (prepare)
        await documents.reserve({
          id: uuidv7(),
          ownerUserId: owner,
          applicationId: application,
          jobRevision: seeded?.context.jobContextHash ?? "a".repeat(64),
          confirmedFactsHash: seeded?.context.confirmedFactsHash ?? "b".repeat(64),
        });
      await documents.reserve({
        id: document,
        ownerUserId: owner,
        applicationId: application,
        jobRevision: seeded?.context.jobContextHash ?? "a".repeat(64),
        confirmedFactsHash: seeded?.context.confirmedFactsHash ?? "b".repeat(64),
      });
      const grant = (
        await work.issue({
          ownerUserId: owner,
          documentId: document,
          purpose: "provider_dispatch",
          requestSha256: "c".repeat(64),
          consentExpiresAt: expiry,
        })
      ).authorization;
      if (!grant) throw Error("SyntheticOriginalGrantMissing");
      return {
        schemaVersion: 1,
        action: "launch",
        ownerUserId: owner,
        applicationId: application,
        original: {
          id: grant.id,
          documentId: document,
          purpose: "provider_dispatch",
          requestSha256: grant.requestSha256,
        },
        previousEpochId: null,
      };
    }
    function fixture() {
      const commands: string[] = [];
      let sentTask: object | undefined;
      const effects = { failRun: false, wrongOwner: false, afterRun: async () => undefined };
      const send: ECS["send"] = vi.fn(async (command) => {
        const name = command.constructor.name;
        commands.push(name);
        if (name === "DescribeTaskDefinitionCommand")
          return {
            taskDefinition: {
              taskDefinitionArn: config.taskDefinitionArn,
              status: "ACTIVE",
              networkMode: "awsvpc",
              requiresCompatibilities: ["FARGATE"],
              runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "X86_64" },
              cpu: config.cpu,
              memory: config.memory,
              executionRoleArn: config.executionRoleArn,
              taskRoleArn: config.taskRoleArn,
              containerDefinitions: [
                {
                  name: config.containerName,
                  image: config.image,
                  essential: true,
                  user: "65532:65532",
                  readonlyRootFilesystem: true,
                  entryPoint: ["/usr/local/bin/node"],
                  command: ["native-material/main.mjs"],
                  workingDirectory: "/materials",
                  linuxParameters: { capabilities: { drop: ["ALL"] } },
                  ulimits: [{ name: "core", softLimit: 0, hardLimit: 0 }],
                },
              ],
            },
          };
        if (name === "RunTaskCommand") {
          const request = command.input as { startedBy: string; overrides: object };
          const taskArn = `arn:aws:ecs:us-east-2:123456789012:task/native/${request.startedBy.replaceAll("-", "")}`;
          sentTask = {
            taskArn,
            clusterArn: config.clusterArn,
            taskDefinitionArn: config.taskDefinitionArn,
            startedBy: request.startedBy,
            launchType: "FARGATE",
            platformVersion: "1.4.0",
            enableExecuteCommand: false,
            lastStatus: "PENDING",
            containers: [{ name: config.containerName, taskArn }],
            overrides: structuredClone(request.overrides),
          };
          await effects.afterRun();
          if (effects.failRun) throw Error("SyntheticLostRunAck");
        }
        if (!sentTask) throw Error("SyntheticTaskMissing");
        const observed = structuredClone(sentTask) as {
          overrides: {
            containerOverrides: Array<{ environment: Array<{ name: string; value: string }> }>;
          };
        };
        if (effects.wrongOwner) {
          const value = observed.overrides.containerOverrides[0]?.environment.find(
            (entry) => entry.name === "NATIVE_MATERIAL_OWNER_USER_ID",
          );
          if (value) value.value = uuidv7();
        }
        return { tasks: [observed], failures: [] };
      });
      const env: Record<string, string | undefined> = {
        NATIVE_MATERIAL_LAUNCH_CONTROL_ENABLED: "true",
        NATIVE_MATERIAL_NEW_LAUNCH_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "private-native-launch",
        AWS_LAMBDA_FUNCTION_VERSION: "9",
        AWS_SESSION_TOKEN: "synthetic-session",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
        NATIVE_MATERIAL_LAUNCH_CONFIGURATION_JSON: JSON.stringify(config),
      };
      const handler = createNativeMaterialLaunchLambda({
        environment: () => env,
        resolveDatabaseUrl: async () => url as string,
        createRuntime: (database, settings, enabled, launchEnabled) => {
          const runtime = createNativeMaterialLaunchRuntime(
            database,
            settings,
            enabled,
            launchEnabled,
            { send },
          );
          runtimes.push(runtime);
          return runtime;
        },
      });
      const invoke = vi.fn(async (command: InvokeCommand) => {
        if (!(command.input.Payload instanceof Uint8Array))
          throw Error("SyntheticMetadataPayloadRejected");
        const result = await handler(JSON.parse(new TextDecoder().decode(command.input.Payload)), {
          invokedFunctionArn: target,
        });
        return {
          StatusCode: 200,
          ExecutedVersion: "9",
          Payload: new TextEncoder().encode(JSON.stringify(result)),
        };
      });
      const client = createNativeLaunchControlClient({
        functionArn: target,
        enabled: () => true,
        launchEnabled: () => true,
        testClient: { send: invoke },
      });
      return { env, handler, client, commands, effects };
    }
    async function unchangedWork(request: Extract<NativeLaunchControlInput, { action: "launch" }>) {
      const [row] =
        await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id=${request.original.id}`;
      expect(row?.state).toBe("issued");
    }
    const evidenceRegistry = () =>
      new PostgresNativeMaterialRegistry(sql, () => true, lockNativeMaterialApplicationAdmission);
    it("admits exact bound evidence metadata and releases owning locks without consuming provider work", async () => {
      const request = await original();
      const captured = await fixture().client.launch(request);
      const binding = { ...captured, original: request.original };
      const registry = evidenceRegistry();
      await expect(registry.checkEvidenceAdmission(binding)).resolves.toBeUndefined();
      const independent = createApplicationsDatabase(url as string, { maxConnections: 1 });
      try {
        await independent.begin(async (tx) => {
          await tx`SELECT id FROM applications.applications WHERE id=${request.applicationId} FOR UPDATE NOWAIT`;
          await tx`SELECT id FROM documents.native_material_allocations WHERE id=${captured.scope.allocationId} FOR UPDATE NOWAIT`;
          await tx`SELECT epoch_id FROM documents.native_material_admission WHERE epoch_id=${captured.scope.epochId} FOR UPDATE NOWAIT`;
        });
      } finally {
        await independent.end();
      }
      await unchangedWork(request);
    });
    it.each(["scope", "task", "deployment", "work", "hash"])(
      "refuses foreign evidence %s without consuming work",
      async (fault) => {
        const request = await original();
        const captured = await fixture().client.launch(request);
        const binding = structuredClone({ ...captured, original: request.original });
        if (fault === "scope") binding.scope.epochId = uuidv7();
        if (fault === "task")
          binding.allocation.taskArn = binding.allocation.taskArn.replace(
            /.$/u,
            binding.allocation.taskArn.endsWith("a") ? "b" : "a",
          );
        if (fault === "deployment")
          binding.allocation.taskDefinitionArn = binding.allocation.taskDefinitionArn.replace(
            ":7",
            ":8",
          );
        if (fault === "work") binding.original.id = uuidv7();
        if (fault === "hash") binding.original.requestSha256 = "d".repeat(64);
        await expect(evidenceRegistry().checkEvidenceAdmission(binding)).rejects.toThrow(
          "NativeMaterialRegistryUnavailable",
        );
        await unchangedWork(request);
      },
    );
    it("does not reuse recovery-after-seal permission as evidence admission", async () => {
      const request = await original();
      const f = fixture();
      const captured = await f.client.launch(request);
      const binding = { ...captured, original: request.original };
      const registry = evidenceRegistry();
      await registry.sealApplication(request.ownerUserId, request.applicationId);
      await expect(registry.checkEvidenceAdmission(binding)).rejects.toThrow(
        "NativeMaterialRegistryUnavailable",
      );
      await expect(
        f.client.recover({
          schemaVersion: 1,
          action: "recover",
          scope: captured.scope,
          taskArn: captured.allocation.taskArn,
        }),
      ).resolves.toEqual(captured);
      await unchangedWork(request);
    });
    it.each(["quarantine", "terminal"])("refuses evidence after owning %s", async (fault) => {
      const request = await original();
      const captured = await fixture().client.launch(request);
      if (fault === "terminal")
        await sql`UPDATE applications.applications SET status='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=${request.applicationId}`;
      else
        await sql`UPDATE identity.users SET account_state='quarantined', quarantined_at=clock_timestamp() WHERE id=${request.ownerUserId}`;
      await expect(
        evidenceRegistry().checkEvidenceAdmission({ ...captured, original: request.original }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await unchangedWork(request);
    });
    it("refuses original pending allocation before positive task binding", async () => {
      const request = await original();
      const registry = evidenceRegistry();
      const intent = await registry.admit({
        ownerUserId: request.ownerUserId,
        applicationId: request.applicationId,
        original: request.original,
        previousEpochId: null,
        deployment: {
          clusterArn: config.clusterArn,
          taskDefinitionArn: config.taskDefinitionArn,
          containerName: config.containerName,
        },
      });
      const scope = {
        allocationId: intent.allocationId,
        ownerUserId: intent.ownerUserId,
        applicationId: intent.applicationId,
        generationId: intent.generationId,
        epochId: intent.epochId,
      };
      const allocation = {
        allocationId: intent.allocationId,
        ownerUserId: intent.ownerUserId,
        applicationId: intent.applicationId,
        generationId: intent.generationId,
        clusterArn: config.clusterArn,
        taskDefinitionArn: config.taskDefinitionArn,
        containerName: config.containerName,
        taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${intent.allocationId.replaceAll("-", "")}`,
      };
      await expect(
        registry.checkEvidenceAdmission({ scope, allocation, original: request.original }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await unchangedWork(request);
    });
    it("rejects expired unclaimed work without extending its admission", async () => {
      const request = await original(2_000);
      const captured = await fixture().client.launch(request);
      const registry = evidenceRegistry();
      const binding = { ...captured, original: request.original };
      await registry.checkEvidenceAdmission(binding);
      await new Promise((resolve) => setTimeout(resolve, 2_100));
      await expect(registry.checkEvidenceAdmission(binding)).rejects.toThrow(
        "NativeMaterialRegistryUnavailable",
      );
      await unchangedWork(request);
    });
    it("does not deadlock evidence admission with the original owning provider claim", async () => {
      const request = await original();
      const captured = await fixture().client.launch(request);
      const registry = evidenceRegistry();
      const result = await Promise.all([
        registry.checkEvidenceAdmission({ ...captured, original: request.original }),
        work.claim(request.original),
      ]);
      expect(result[1]).toEqual({ kind: "claimed" });
      await registry.checkEvidenceAdmission({ ...captured, original: request.original });
      await work.settleProviderDispatch(request.original);
      await registry.checkEvidenceAdmission({ ...captured, original: request.original });
    });
    it("rejects revoked work while allocation metadata remains bound", async () => {
      const request = await original();
      const captured = await fixture().client.launch(request);
      await work.revokeUnclaimed(request.ownerUserId, request.original.documentId);
      await expect(
        evidenceRegistry().checkEvidenceAdmission({ ...captured, original: request.original }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
    });
    it("connects exact sender/receiver/owning SQL and replays the same task without a second RunTask", async () => {
      const request = await original();
      const f = fixture();
      const captured = await f.client.launch(request);
      expect(captured.scope.generationId).toBe(request.original.documentId);
      const replay = await f.client.launch(request);
      expect(replay).toEqual(captured);
      expect(f.commands.filter((name) => name === "RunTaskCommand")).toHaveLength(1);
      const [row] =
        await sql`SELECT state,task_arn,launch_claimed_at FROM documents.native_material_allocations WHERE id=${captured.scope.allocationId}`;
      expect(row?.state).toBe("bound");
      expect(row?.task_arn).toBe(captured.allocation.taskArn);
      expect(row?.launch_claimed_at).toBeInstanceOf(Date);
      await unchangedWork(request);
    });
    it.each(["owner", "work", "hash", "terminal"])(
      "refuses foreign/original/terminal %s before ECS",
      async (change) => {
        const originalRequest = await original();
        const request = structuredClone(originalRequest);
        const f = fixture();
        if (change === "owner") request.ownerUserId = uuidv7();
        if (change === "work") request.original.id = uuidv7();
        if (change === "hash") request.original.requestSha256 = "d".repeat(64);
        if (change === "terminal")
          await sql`UPDATE applications.applications SET status='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=${request.applicationId}`;
        await expect(f.client.launch(request)).rejects.toThrow("NativeLaunchControlUnavailable");
        expect(f.commands).toHaveLength(0);
        const [count] =
          await sql`SELECT count(*)::int AS count FROM documents.native_material_allocations WHERE document_id=${originalRequest.original.documentId}`;
        expect(count?.count).toBe(0);
        await unchangedWork(originalRequest);
      },
    );
    it("recovers a lost actual task ACK after sealing and launch shutdown without new work", async () => {
      const request = await original();
      const f = fixture();
      f.effects.failRun = true;
      await expect(f.client.launch(request)).rejects.toThrow();
      const [row] =
        await sql`SELECT id,epoch_id,state,task_arn,launch_claimed_at FROM documents.native_material_allocations WHERE document_id=${request.original.documentId}`;
      expect(row?.state).toBe("pending");
      expect(row?.task_arn).toBe(null);
      expect(row?.launch_claimed_at).toBeInstanceOf(Date);
      await new PostgresNativeMaterialRegistry(sql, () => true).sealApplication(
        request.ownerUserId,
        request.applicationId,
      );
      f.env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = "false";
      const scope: NativeMaterialLaunchScope = {
        allocationId: String(row?.id),
        ownerUserId: request.ownerUserId,
        applicationId: request.applicationId,
        generationId: request.original.documentId,
        epochId: String(row?.epoch_id),
      };
      const taskArn = `arn:aws:ecs:us-east-2:123456789012:task/native/${scope.allocationId.replaceAll("-", "")}`;
      await expect(
        f.client.recover({ schemaVersion: 1, action: "recover", scope, taskArn }),
      ).resolves.toMatchObject({ scope });
      expect(f.commands.filter((name) => name === "RunTaskCommand")).toHaveLength(1);
      await unchangedWork(request);
    });
    it("captures a fulfilled reply before withholding a shutdown acknowledgement", async () => {
      const request = await original();
      const f = fixture();
      f.effects.afterRun = async () => {
        f.env.NATIVE_MATERIAL_NEW_LAUNCH_ENABLED = "false";
      };
      await expect(f.client.launch(request)).rejects.toThrow();
      const [row] =
        await sql`SELECT state,task_arn FROM documents.native_material_allocations WHERE document_id=${request.original.documentId}`;
      expect(row?.state).toBe("bound");
      expect(row?.task_arn).toMatch(/^arn:aws:ecs:/u);
      await unchangedWork(request);
    });
    it("leaves a wrong-owner observed task pending without recording or retrying it", async () => {
      const request = await original();
      const f = fixture();
      f.effects.wrongOwner = true;
      await expect(f.client.launch(request)).rejects.toThrow();
      await expect(f.client.launch(request)).rejects.toThrow();
      const [row] =
        await sql`SELECT state,task_arn FROM documents.native_material_allocations WHERE document_id=${request.original.documentId}`;
      expect(row?.state).toBe("pending");
      expect(row?.task_arn).toBe(null);
      expect(f.commands.filter((name) => name === "RunTaskCommand")).toHaveLength(1);
      await unchangedWork(request);
    });
    it("serializes independent Lambda runtimes to one durable launch", async () => {
      const request = await original();
      const first = fixture();
      const second = fixture();
      const results = await Promise.allSettled([
        first.client.launch(request),
        second.client.launch(request),
      ]);
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
      expect(
        [...first.commands, ...second.commands].filter((name) => name === "RunTaskCommand"),
      ).toHaveLength(1);
      const [count] =
        await sql`SELECT count(*)::int AS count FROM documents.native_material_allocations WHERE document_id=${request.original.documentId}`;
      expect(count?.count).toBe(1);
      await unchangedWork(request);
    });
    it("runs fresh native preparation through real owner pools and recovers original ready work after a lost launch ACK", async () => {
      const owner = uuidv7();
      await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
      const profilePool = createDatabase(url ?? "postgres://invalid", { maxConnections: 1 });
      runtimes.push({ close: () => profilePool.client.end() });
      const profile = new PostgresProfileStore(profilePool);
      await profile.createProfileFact(
        owner,
        { kind: "skill", key: "language", value: "TypeScript", sensitivity: "standard" },
        uuidv7(),
        "synthetic-native-preparation",
      );
      const facts = (await profile.listProfileFacts(owner)).facts.map(profileFactToGraphFact);
      const catalog = new PostgresJobCatalog(sql, {
        searchCursorKeys: {
          active: { id: "synthetic-native-preparation", key: Buffer.alloc(32, 1) },
        },
      });
      const runId = uuidv7(),
        now = new Date();
      const posting = await catalog.recordObservation({
        provider: "greenhouse",
        provenance: "authorized_fixture",
        companyName: `Synthetic ${runId}`,
        title: "Engineer",
        locations: ["Remote"],
        description: "Build reliable synthetic systems.",
        sourceUrl: `https://jobs.example.test/${runId}`,
        atsTenant: runId,
        externalJobId: runId,
        observedAt: now,
        adapterVersion: "synthetic-v1",
      });
      const activePosting = await catalog.getActiveJob(posting.job.id, now);
      if (!activePosting) throw Error("SyntheticFreshPostingUnavailable");
      const context = coverLetterContext({
        facts,
        job: {
          title: activePosting.title,
          company: activePosting.company.name,
          description: activePosting.description,
        },
        now,
      });
      const applications = new PostgresApplicationStore(sql, () => new Date(), {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: packetProtection.options,
      });
      const created = await applications.createApplication({
        ownerUserId: owner,
        canonicalJobId: posting.job.id,
        idempotencyKey: `create-${runId}`,
      });
      const queued = await applications.queuePreparation({
        ownerUserId: owner,
        applicationId: created.view.application.id,
        idempotencyKey: `prepare-${runId}`,
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
          artifactHashes: { resume: "a".repeat(64) },
        },
      });
      const [event] = await sql<
        Array<{ id: string }>
      >`SELECT id FROM applications.preparation_outbox WHERE preparation_id=${queued.preparation.id}`;
      if (!event) throw Error("SyntheticFreshPreparationEventMissing");
      const f = fixture();
      const transport = vi.spyOn(LambdaClient.prototype, "send");
      transport.mockImplementation((async (command: InvokeCommand) => {
        expect(command.input.FunctionName).toBe(target);
        if (!(command.input.Payload instanceof Uint8Array))
          throw Error("SyntheticNativePayloadRejected");
        const request = JSON.parse(new TextDecoder().decode(command.input.Payload)) as Extract<
          NativeLaunchControlInput,
          { action: "launch" }
        >;
        await f.client.launch(request);
        expect(
          await work.claimProviderDispatch({
            documentId: request.original.documentId,
            requestSha256: request.original.requestSha256,
            consentExpiresAt: queued.preparation.expiresAt,
          }),
        ).toEqual({ kind: "claimed", reference: request.original });
        await work.settleProviderDispatch(request.original);
        const metadata = await documents.generationMetadata({
          id: request.original.documentId,
          ownerUserId: owner,
          applicationId: request.applicationId,
          jobRevision: context.jobContextHash,
          confirmedFactsHash: context.confirmedFactsHash,
        });
        if (!metadata) throw Error("SyntheticNativeReservationMissing");
        const completedAtMs = Date.now();
        const ready = {
          schemaVersion: 1 as const,
          material: {
            schemaVersion: 1 as const,
            kind: "cover_letter" as const,
            ownerUserId: owner,
            applicationId: request.applicationId,
            generationId: request.original.documentId,
            version: metadata.version,
            contentSha256: "d".repeat(64),
            completedAtMs,
            expiresAtMs: completedAtMs + 1_800_000,
          },
          sourceFactIds: facts.map((fact) => fact.id),
          confidence: 1,
        };
        expect(
          await new PostgresTemporaryMaterialCompletionStore(
            sql,
            () => true,
          ).claimOriginalCompletion(request.original, ready.material),
        ).toBe("claimed");
        expect(
          await new PostgresNativeMaterialReadyStore(sql, () => true).publish(
            request.original,
            ready,
          ),
        ).toBe(true);
        throw Error("SyntheticLostOriginalLaunchAck");
      }) as unknown as LambdaClient["send"]);
      const runtime = createNativeApplicationPreparationRuntime(
        url ?? "postgres://invalid",
        {
          target: "arn:aws:lambda:us-east-2:123456789012:function:native-preparation:11",
          secretId: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db",
          launcher: target,
          packet: {
            encryptionKeyArn:
              "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111",
            fingerprintKeyArn:
              "arn:aws:kms:us-east-2:123456789012:key/22222222-2222-4222-8222-222222222222",
          },
        },
        () => true,
        () => true,
        { packetProtection: packetProtection.options },
      );
      runtimes.push(runtime);
      const input = {
        schemaVersion: 1 as const,
        workflowDefinitionVersion: 1 as const,
        action: "advance" as const,
        eventId: event.id,
        preparationId: queued.preparation.id,
      };
      try {
        expect(await runtime.run(input)).toMatchObject({
          outcome: "retryable_failure",
          errorCode: "generation_in_progress",
        });
        expect(await runtime.run(input)).toMatchObject({ outcome: "completed" });
        expect(
          (await applications.getPreparationForEvent(event.id, queued.preparation.id)).state,
        ).toBe("succeeded");
        expect(await runtime.run(input)).toMatchObject({ outcome: "completed" });
        expect(transport).toHaveBeenCalledOnce();
        expect(f.commands.filter((name) => name === "RunTaskCommand")).toHaveLength(1);
        const [inventory] = await sql<Array<{ documents: number; grants: number; slots: number }>>`
          SELECT (SELECT count(*)::int FROM documents.cover_letters WHERE id=${queued.preparation.id}) AS documents,
            count(*)::int AS grants, count(*) FILTER (WHERE purpose='private_slots')::int AS slots
          FROM documents.cover_letter_work_authorizations WHERE document_id=${queued.preparation.id}`;
        expect(inventory).toEqual({ documents: 1, grants: 1, slots: 0 });
      } finally {
        transport.mockRestore();
      }
    });
    it("authenticates the original task through real owner SQL claim, settlement, completion and sealed refusal", async () => {
      const profilePool = createDatabase(url ?? "postgres://invalid", { maxConnections: 1 });
      runtimes.push({ close: () => profilePool.client.end() });
      const profile = new PostgresProfileStore(profilePool);
      const catalog = new PostgresJobCatalog(sql, {
        searchCursorKeys: { active: { id: "synthetic-native", key: Buffer.alloc(32, 1) } },
      });
      const runId = uuidv7();
      const observedAt = new Date();
      const posting = await catalog.recordObservation({
        provider: "greenhouse",
        provenance: "authorized_fixture",
        companyName: `Synthetic ${runId}`,
        title: "Engineer",
        locations: ["Remote"],
        description: "Build reliable synthetic systems.",
        sourceUrl: `https://jobs.example.test/${runId}`,
        atsTenant: runId,
        externalJobId: runId,
        observedAt,
        adapterVersion: "synthetic-v1",
      });
      const activeJob = await catalog.getActiveJob(posting.job.id, observedAt);
      if (!activeJob) throw Error("SyntheticActivePostingMissing");
      const job = {
        title: activeJob.title,
        company: activeJob.company.name,
        description: activeJob.description,
      };
      const request = await original(
        900_000,
        async (owner) => {
          await profile.createProfileFact(
            owner,
            {
              kind: "skill",
              key: "programming_language",
              value: "TypeScript",
              sensitivity: "standard",
            },
            uuidv7(),
            "synthetic-native-rpc",
          );
          const facts = (await profile.listProfileFacts(owner)).facts.map(profileFactToGraphFact);
          return {
            jobId: posting.job.id,
            context: coverLetterContext({ facts, job, now: observedAt }),
          };
        },
        true,
      );
      const facts = (await profile.listProfileFacts(request.ownerUserId)).facts.map(
        profileFactToGraphFact,
      );
      const approvedContext = coverLetterContext({ facts, job, now: observedAt });
      const f = fixture();
      const capture = await f.client.launch(request);
      const binding = {
        scope: capture.scope,
        allocation: capture.allocation,
        original: request.original,
      };
      const rpcTarget = "arn:aws:lambda:us-east-2:123456789012:function:private-native-owner:11";
      const taskId = capture.allocation.taskArn.split("/").at(-1);
      const env = {
        NATIVE_OWNER_RPC_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "private-native-owner",
        AWS_LAMBDA_FUNCTION_VERSION: "11",
        AWS_SESSION_TOKEN: "synthetic-lambda-session",
        DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db",
        NATIVE_OWNER_RPC_DEPLOYMENT_JSON: JSON.stringify({
          taskRoleArn: config.taskRoleArn,
          clusterArn: config.clusterArn,
          taskDefinitionArn: config.taskDefinitionArn,
          containerName: config.containerName,
        }),
      };
      const resolve = vi.fn(async () => url ?? "postgres://invalid");
      const authentication = vi.fn(
        async () =>
          new Response(
            `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-task/${taskId}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${taskId}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
            { headers: { "content-type": "text/xml" } },
          ),
      );
      const receiver = createNativeOwnerRpcLambda({
        environment: () => env,
        resolveDatabaseUrl: resolve,
        testFetch: authentication,
        createRuntime: (...args) => {
          const runtime = createNativeOwnerRpcRuntime(...args);
          runtimes.push(runtime);
          return runtime;
        },
      });
      const send = vi.fn(async (command: InvokeCommand) => {
        const raw = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
        const reply = await receiver(raw, { invokedFunctionArn: rpcTarget });
        return {
          StatusCode: 200,
          ExecutedVersion: "11",
          Payload: new TextEncoder().encode(nativeOwnerJson(reply)),
        };
      });
      const credentials = {
        accessKeyId: `ASIA${"A".repeat(16)}`,
        secretAccessKey: "synthetic-only-signing-secret",
        sessionToken: "synthetic-task-token",
      };
      const remote = createNativeOwnerRpcClient({
        binding,
        targetArn: rpcTarget,
        enabled: () => true,
        testCredentials: credentials,
        testClient: { send },
      });
      authentication.mockResolvedValueOnce(new Response("denied", { status: 403 }));
      await expect(remote.checkAdmission(binding)).rejects.toThrow("NativeOwnerRpcUnavailable");
      expect(resolve).not.toHaveBeenCalled();
      await remote.checkAdmission(binding);
      expect(resolve).toHaveBeenCalledOnce();
      const principalIssuer = "https://native-principal.synthetic.invalid/";
      await expect(remote.principal(principalIssuer)).rejects.toThrow("NativeOwnerRpcUnavailable");
      const principalSubject = `synthetic-candidate-${request.ownerUserId}`;
      await sql`INSERT INTO identity.external_identities (issuer,subject,user_id)
        VALUES (${principalIssuer},${principalSubject},${request.ownerUserId})`;
      expect(await remote.principal(principalIssuer)).toEqual({
        issuer: principalIssuer,
        subject: principalSubject,
      });
      await expect(remote.principal("https://other.synthetic.invalid/")).rejects.toThrow(
        "NativeOwnerRpcUnavailable",
      );
      await sql`INSERT INTO identity.external_identities (issuer,subject,user_id)
        VALUES (${principalIssuer},${`${principalSubject}-ambiguous`},${request.ownerUserId})`;
      await expect(remote.principal(principalIssuer)).rejects.toThrow("NativeOwnerRpcUnavailable");
      await sql`DELETE FROM identity.external_identities WHERE issuer=${principalIssuer} AND subject=${`${principalSubject}-ambiguous`}`;
      const bootstrap = await remote.bootstrap();
      expect(bootstrap).toMatchObject({
        documentVersion: 2,
        id: request.original.documentId,
        ownerUserId: request.ownerUserId,
        applicationId: request.applicationId,
        jobContextHash: approvedContext.jobContextHash,
        confirmedFactsHash: approvedContext.confirmedFactsHash,
        noticeVersion: "openai-cover-letter.v1",
      });
      const [originalConsent] = await sql<
        Array<{ consent: Date }>
      >`SELECT consent_expires_at AS consent FROM documents.cover_letter_work_authorizations WHERE id=${request.original.id}`;
      expect(bootstrap.expiresAt).toEqual(originalConsent?.consent);
      expect(bootstrap.expiresAt.getTime() - bootstrap.approvedAt.getTime()).toBe(900_000);
      const documentControls = createNativeOwnerControlStore(
        url ?? "postgres://invalid",
        rpcTarget,
        () => true,
      );
      runtimes.push(documentControls);
      const storedBootstrap = {
        ...bootstrap,
        approvedAt: bootstrap.approvedAt.toISOString(),
        expiresAt: bootstrap.expiresAt.toISOString(),
      };
      await expect(
        documentControls.checkBootstrap(binding, { ...storedBootstrap, documentVersion: 1 }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      await documentControls.checkBootstrap(binding, storedBootstrap);
      await expect(
        documentControls.checkBootstrap(binding, {
          ...storedBootstrap,
          approvedAt: new Date(bootstrap.approvedAt.getTime() + 1).toISOString(),
          expiresAt: new Date(bootstrap.expiresAt.getTime() + 1).toISOString(),
        }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      await expect(
        documentControls.checkBootstrap(binding, {
          ...storedBootstrap,
          confirmedFactsHash: "f".repeat(64),
        }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      const evidence = createNativeOwnerEvidenceClient({
        binding,
        targetArn: rpcTarget,
        enabled: () => true,
        testCredentials: credentials,
        testClient: { send },
        context: approvedContext,
      });
      expect(await evidence.source.load(request.ownerUserId, request.applicationId)).toEqual({
        facts,
        job,
      });
      const wrongContext = createNativeOwnerEvidenceClient({
        binding,
        targetArn: rpcTarget,
        enabled: () => true,
        testCredentials: credentials,
        testClient: { send },
        context: { ...approvedContext, confirmedFactsHash: "f".repeat(64) },
      });
      await expect(
        wrongContext.source.load(request.ownerUserId, request.applicationId),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      const [grant] = await sql<
        Array<{ consent: Date }>
      >`SELECT consent_expires_at AS consent FROM documents.cover_letter_work_authorizations WHERE id=${request.original.id}`;
      if (!grant) throw Error("SyntheticGrantMissing");
      const controls = createNativeMaterialControls({
        allocation: binding.allocation,
        original: binding.original,
        documentVersion: bootstrap.documentVersion,
        consentExpiresAt: grant.consent.toISOString(),
        workFunctionArn: rpcTarget,
        completionFunctionArn: rpcTarget,
        enabled: () => true,
        nativeRpc: { binding, testCredentials: credentials },
        testClient: { send },
      });
      expect(
        await controls.work.claimProviderDispatch({
          documentId: binding.original.documentId,
          requestSha256: binding.original.requestSha256,
          consentExpiresAt: grant.consent,
        }),
      ).toEqual({ kind: "claimed", reference: binding.original });
      await controls.work.settleProviderDispatch(binding.original);
      const completedAtMs = Date.now();
      const ready = {
        schemaVersion: 1 as const,
        material: {
          schemaVersion: 1 as const,
          kind: "cover_letter" as const,
          ownerUserId: request.ownerUserId,
          applicationId: request.applicationId,
          generationId: request.original.documentId,
          version: bootstrap.documentVersion,
          contentSha256: "d".repeat(64),
          completedAtMs,
          expiresAtMs: completedAtMs + 1_800_000,
        },
        sourceFactIds: facts.map((fact) => fact.id),
        confidence: 1,
      };
      await expect(remote.run({ action: "publish_ready", input: ready })).rejects.toThrow(
        "NativeOwnerRpcUnavailable",
      );
      await expect(
        remote.run({
          action: "completion",
          input: {
            schemaVersion: 1,
            action: "claim_original_completion",
            work: binding.original,
            material: {
              schemaVersion: 1,
              kind: "cover_letter",
              ownerUserId: request.ownerUserId,
              applicationId: request.applicationId,
              generationId: request.original.documentId,
              version: 1,
              contentSha256: "d".repeat(64),
              completedAtMs,
              expiresAtMs: completedAtMs + 1_800_000,
            },
          },
        }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");

      expect(
        await controls.completion.claimOriginalCompletion({
          schemaVersion: 1,
          kind: "cover_letter",
          ownerUserId: request.ownerUserId,
          applicationId: request.applicationId,
          generationId: request.original.documentId,
          version: bootstrap.documentVersion,
          contentSha256: "d".repeat(64),
          completedAtMs,
          expiresAtMs: completedAtMs + 1_800_000,
        }),
      ).toBe("claimed");
      const [row] =
        await sql`SELECT w.state,d.material_work_id,d.material_completed_at_ms FROM documents.cover_letter_work_authorizations w
        JOIN documents.cover_letters d ON d.id=w.document_id WHERE w.id=${request.original.id}`;
      expect(row?.state).toBe("settled");
      expect(row?.material_work_id).toBe(request.original.id);
      expect(Number(row?.material_completed_at_ms)).toBe(completedAtMs);
      await expect(
        remote.run({
          action: "publish_ready",
          input: { ...ready, material: { ...ready.material, version: 1 } },
        }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      expect(
        await new PostgresNativeMaterialReadyStore(sql, () => true).readAllocation(ready.material),
      ).toBeNull();
      await controls.publishReady(ready);
      const readyStore = new PostgresNativeMaterialReadyStore(sql, () => true);
      const readyIdentity = {
        id: request.original.documentId,
        ownerUserId: request.ownerUserId,
        applicationId: request.applicationId,
        jobContextHash: approvedContext.jobContextHash,
        confirmedFactsHash: approvedContext.confirmedFactsHash,
        noticeVersion: "openai-cover-letter.v1",
        approvedAt: bootstrap.approvedAt,
        expiresAt: bootstrap.expiresAt,
      };
      expect(await readyStore.read(readyIdentity)).toEqual(ready);
      expect(await readyStore.readAllocation(ready.material)).toBe(binding.scope.allocationId);
      let enabledChecks = 0;
      expect(
        await new PostgresNativeMaterialReadyStore(sql, () => ++enabledChecks === 1).readAllocation(
          ready.material,
        ),
      ).toBeNull();
      expect(
        await new PostgresNativeMaterialReadyStore(sql).readAllocation(ready.material),
      ).toBeNull();
      for (const changed of [
        { applicationId: uuidv7() },
        { generationId: uuidv7() },
        { version: ready.material.version + 1 },
        { contentSha256: "f".repeat(64) },
        { completedAtMs: completedAtMs - 1, expiresAtMs: completedAtMs + 1_800_000 - 1 },
      ])
        expect(await readyStore.readAllocation({ ...ready.material, ...changed })).toBeNull();
      await expect(
        readyStore.readAllocation({ ...ready.material, ownerUserId: uuidv7() }),
      ).rejects.toThrow("NativeMaterialReadyUnavailable");
      expect(await readyStore.read({ ...readyIdentity, id: uuidv7() })).toBeNull();
      expect(await readyStore.read({ ...readyIdentity, applicationId: uuidv7() })).toBeNull();
      expect(
        await readyStore.read({ ...readyIdentity, confirmedFactsHash: "f".repeat(64) }),
      ).toBeNull();
      expect(
        await readyStore.read({
          ...readyIdentity,
          expiresAt: new Date(bootstrap.expiresAt.getTime() + 1),
        }),
      ).toBeNull();
      const epochReader = new PostgresNativeMaterialRegistry(sql, () => true);
      await expect(
        epochReader.readPreviousEpoch(request.ownerUserId, request.applicationId),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      expect(await remote.run({ action: "publish_ready", input: ready })).toEqual({
        published: true,
      });
      await expect(
        remote.run({ action: "publish_ready", input: { ...ready, confidence: 0.5 } }),
      ).rejects.toThrow("NativeOwnerRpcUnavailable");
      await expect(controls.publishReady(ready)).rejects.toThrow(
        "NativeMaterialControlsUnavailable",
      );
      await expect(
        sql`UPDATE documents.cover_letters SET material_confidence=0.5 WHERE id=${request.original.documentId}`,
      ).rejects.toThrow();
      const [exported] = await sql<
        Array<{
          data: { documents: { coverLetters: Array<{ id: string; nativeReady?: unknown }> } };
        }>
      >`SELECT documents.export_candidate_data(${request.ownerUserId}::uuid) AS data`;
      expect(
        exported?.data.documents.coverLetters.find(
          (letter) => letter.id === request.original.documentId,
        )?.nativeReady,
      ).toEqual(ready);
      const activityStore = new PostgresApplicationStore(sql, () => new Date(), {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: packetProtection.options,
      });
      const nativePreparation = createNativeCoverLetterPreparationPort({
        owners: { applications: activityStore, profile, catalog },
        candidateLease: documents,
        documents,
        work,
        ready: readyStore,
        admission: epochReader,
        launcher: {
          launch: async () => {
            throw Error("SyntheticReplayLaunchForbidden");
          },
        },
        enabled: () => true,
      });
      const [preparationEvent] = await sql<Array<{ id: string }>>`
        SELECT id FROM applications.preparation_outbox WHERE preparation_id=${request.original.documentId}`;
      if (!preparationEvent) throw Error("SyntheticPreparationEventMissing");
      const activity = createPreparationActivity(activityStore, nativePreparation);
      expect(await activity(preparationEvent.id, request.original.documentId)).toEqual({
        preparationId: request.original.documentId,
        outcome: "completed",
      });
      const accepted = await activityStore.getPreparationForEvent(
        preparationEvent.id,
        request.original.documentId,
      );
      expect(accepted.state).toBe("succeeded");
      expect(await activity(preparationEvent.id, request.original.documentId)).toEqual({
        preparationId: request.original.documentId,
        outcome: "completed",
      });
      await new PostgresNativeMaterialRegistry(sql, () => true).sealApplication(
        request.ownerUserId,
        request.applicationId,
      );
      expect(await readyStore.read(readyIdentity)).toBeNull();
      expect(await readyStore.readAllocation(ready.material)).toBeNull();
      expect(await epochReader.readPreviousEpoch(request.ownerUserId, request.applicationId)).toBe(
        binding.scope.epochId,
      );
      await expect(remote.checkAdmission(binding)).rejects.toThrow("NativeOwnerRpcUnavailable");
      await expect(remote.run({ action: "publish_ready", input: ready })).rejects.toThrow(
        "NativeOwnerRpcUnavailable",
      );
      expect(resolve).toHaveBeenCalledOnce();
      expect(f.commands.filter((name) => name === "RunTaskCommand")).toHaveLength(1);
    });
    it("releases the actual application/allocation locks before its signed AWS operation", async () => {
      const request = await original();
      const f = fixture();
      f.effects.afterRun = async () => {
        await sql.begin(async (tx) => {
          await tx`SELECT id FROM applications.applications WHERE id=${request.applicationId} FOR UPDATE NOWAIT`;
          await tx`SELECT id FROM documents.native_material_allocations WHERE document_id=${request.original.documentId} FOR UPDATE NOWAIT`;
          await tx`SELECT id FROM documents.cover_letter_work_authorizations WHERE id=${request.original.id} FOR UPDATE NOWAIT`;
        });
      };
      await expect(f.client.launch(request)).resolves.toMatchObject({
        scope: { generationId: request.original.documentId },
      });
    });
  },
);
