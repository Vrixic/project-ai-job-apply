import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createApplicationsDatabase } from "@ai-job-apply/applications-service";
import { lockNativeMaterialApplicationAdmission } from "@ai-job-apply/applications-service/native-material-runtime";
import {
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import {
  createNativeLaunchControlClient,
  type NativeLaunchControlInput,
} from "@ai-job-apply/documents-service/native-launch-control";
import {
  type NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "@ai-job-apply/documents-service/native-material-registry";
import { nativeTaskLaunchConfiguration } from "@ai-job-apply/documents-service/native-task-launch";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createNativeMaterialLaunchLambda,
  createNativeMaterialLaunchRuntime,
} from "./native-material-launch-lambda.js";

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
    const runtimes: Array<ReturnType<typeof createNativeMaterialLaunchRuntime>> = [];
    beforeAll(async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const owner of ["profile", "applications", "documents"]) {
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
    ): Promise<Extract<NativeLaunchControlInput, { action: "launch" }>> {
      const owner = uuidv7();
      const application = uuidv7();
      const document = uuidv7();
      await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
      await sql`INSERT INTO applications.applications (id,owner_user_id,canonical_job_id,status,created_at,updated_at)
      VALUES (${application},${owner},${uuidv7()},'preparing',clock_timestamp(),clock_timestamp())`;
      await documents.reserve({
        id: document,
        ownerUserId: owner,
        applicationId: application,
        jobRevision: "a".repeat(64),
        confirmedFactsHash: "b".repeat(64),
      });
      const grant = (
        await work.issue({
          ownerUserId: owner,
          documentId: document,
          purpose: "provider_dispatch",
          requestSha256: "c".repeat(64),
          consentExpiresAt: new Date(Date.now() + consentLifetimeMs),
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
