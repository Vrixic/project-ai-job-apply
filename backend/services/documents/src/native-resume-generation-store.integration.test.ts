import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DescribeTaskDefinitionCommand, RunTaskCommand } from "@aws-sdk/client-ecs";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresCoverLetterStore } from "./cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import { createNativeResumeLocationReader } from "./native-material-location.js";
import { PostgresNativeMaterialRegistry } from "./native-material-registry.js";
import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeGenerationRecord,
  type NativeResumeOwnerQuery,
  type NativeResumeReservation,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import { createNativeResumeOwnerRpcClient } from "./native-resume-owner-rpc-client.js";
import { createNativeResumePreparationControlClient } from "./native-resume-preparation-control-client.js";
import { createNativeResumeSourceRpcClient } from "./native-resume-source-rpc-client.js";
import { createNativeResumeSourceStore } from "./native-resume-source-store.js";
import type { NativeResumeTaskBinding } from "./native-resume-task-binding.js";
import { createNativeResumeTaskLaunch } from "./native-resume-task-launch.js";
import type { NativeTaskRetirementReceipt } from "./native-task-allocation.js";
import { normalizeBlocks } from "./parsing/normalize.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

const requested = process.env.NATIVE_RESUME_LEDGER_INTEGRATION === "1";
const url = process.env.NATIVE_RESUME_LEDGER_TEST_DATABASE_URL;
if (requested) {
  const parsed = new URL(url ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/native_resume_ledger" ||
    parsed.search ||
    parsed.hash
  )
    throw Error("SyntheticNativeResumeLedgerDatabaseRejected");
}
describe.runIf(requested)("native resume generation ledger with real PostgreSQL", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
  let input: NativeResumeReservation;
  let ports: import("./native-resume-generation-store.js").NativeResumeGenerationOwnerPorts;
  let bindings: (job: Record<string, unknown>) => { jobRevision: string; jobContextSha256: string };
  let catalog: {
    recordObservation(input: Record<string, unknown>): Promise<{ job: { id: string } }>;
    getActiveJob(id: string): Promise<Record<string, unknown> | null>;
  };
  let admitAnyApplication: (
    owner: string,
    app: string,
    query: NativeResumeOwnerQuery,
  ) => Promise<void>;
  const store = () => new PostgresNativeResumeGenerationStore(sql, ports, () => true);
  const scope = (r: NativeResumeGenerationRecord) => ({
    ownerUserId: r.reservation.identity.ownerUserId,
    applicationId: r.reservation.identity.applicationId,
    generationId: r.reservation.identity.generationId,
    allocationId: r.allocationId,
    epochId: r.epochId,
  });
  const config = "f".repeat(64);
  let task: string;
  const reference = (
    r: NativeResumeGenerationRecord,
    completed = Date.now(),
  ): TemporaryMaterialReference => ({
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: r.reservation.identity.generationId,
    ownerUserId: r.reservation.identity.ownerUserId,
    applicationId: r.reservation.identity.applicationId,
    version: r.reservation.identity.version,
    contentSha256: "d".repeat(64),
    completedAtMs: completed,
    expiresAtMs: completed + 1800000,
  });
  async function bound() {
    const s = store(),
      r = await s.reserve(input);
    await s.claimLaunch(scope(r), config);
    return { s, r: await s.bindTask(scope(r), config, task) };
  }
  async function rpcFixture() {
    const { s, r } = await bound();
    if (!r.allocation) throw Error("SyntheticTaskUnavailable");
    const module = await import(
      fileURLToPath(
        new URL("../../../workflows/dist/src/native-resume-owner-rpc-lambda.js", import.meta.url),
      )
    );
    const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-owner:7";
    const binding: NativeResumeTaskBinding = {
      schemaVersion: 1,
      kind: "tailored_resume",
      scope: scope(r),
      allocation: r.allocation,
      configurationSha256: config,
    };
    const env: Record<string, string | undefined> = {
      NATIVE_RESUME_OWNER_RPC_ENABLED: "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "native-resume-owner",
      AWS_LAMBDA_FUNCTION_VERSION: "7",
      AWS_SESSION_TOKEN: "synthetic-session",
      DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-resume",
      NATIVE_RESUME_OWNER_RPC_DEPLOYMENT_JSON: JSON.stringify({
        ...input.deployment,
        taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
      }),
    };
    let owner: { close(): Promise<void> } | undefined;
    let secrets = 0;
    const session = task.split("/").at(-1);
    const handler = module.createNativeResumeOwnerRpcLambda({
      environment: () => env,
      resolveDatabaseUrl: async () => {
        secrets++;
        return url;
      },
      createRuntime: (...args: unknown[]) => {
        const result = module.createNativeResumeOwnerRpcRuntime(...args);
        owner = result;
        return result;
      },
      testFetch: async () =>
        new Response(
          `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-resume/${session}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${session}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
          { headers: { "content-type": "text/xml" } },
        ),
    });
    const connect = (candidate: NativeResumeTaskBinding = binding) =>
      createNativeResumeOwnerRpcClient({
        binding: candidate,
        targetArn: target,
        enabled: () => true,
        testCredentials: {
          accessKeyId: "ASIASYNTHETICEXAMPLE",
          secretAccessKey: "synthetic-local-signing-secret-only",
          sessionToken: "synthetic-local-signing-token-only",
        },
        testClient: {
          send: async (command) => {
            if (!(command.input.Payload instanceof Uint8Array))
              throw Error("SyntheticRpcPayloadUnavailable");
            const request = JSON.parse(new TextDecoder().decode(command.input.Payload));
            const result = await handler(request, { invokedFunctionArn: target });
            return {
              StatusCode: 200,
              ExecutedVersion: "7",
              Payload: new TextEncoder().encode(nativeOwnerJson(result)),
            };
          },
        },
      });
    return {
      s,
      r,
      binding,
      client: connect(),
      connect,
      env,
      handler,
      target,
      secrets: () => secrets,
      close: async () => {
        await owner?.close();
      },
    };
  }
  async function sourceFixture() {
    const document = {
      documentId: input.identity.baseDocumentId,
      version: input.identity.baseVersion,
      parserVersion: "parser-1",
      mediaType: "application/pdf" as const,
      sourceSha256: input.identity.baseSha256,
      blocks: normalizeBlocks([{ text: "Synthetic source-only engineering experience" }]),
      createdAt: "2026-10-07T00:00:00.000Z",
    };
    input.normalizedSha256 = createHash("sha256").update(JSON.stringify(document)).digest("hex");
    await sql`UPDATE documents.resume_documents SET normalized_sha256=${input.normalizedSha256} WHERE id=${input.identity.baseDocumentId}`;
    const { s, r } = await bound();
    if (!r.allocation) throw Error("SyntheticAllocationMissing");
    const binding: NativeResumeTaskBinding = {
      schemaVersion: 1,
      kind: "tailored_resume",
      scope: scope(r),
      allocation: r.allocation,
      configurationSha256: config,
    };
    const bootstrap = {
      identity: input.identity,
      normalizedSha256: input.normalizedSha256,
      canonicalJobId: input.application.canonicalJobId,
    };
    const sourceModule = await import(
      fileURLToPath(
        new URL("../../../workflows/dist/src/native-resume-source-rpc-lambda.js", import.meta.url),
      )
    );
    const jobs = await import(
      fileURLToPath(new URL("../../jobs/dist/src/native-resume-admission.js", import.meta.url))
    );
    let duringRead: () => Promise<void> = async () => {};
    let reads = 0,
      secrets = 0;
    let runtime: ReturnType<typeof createNativeResumeSourceStore> | undefined;
    const env: Record<string, string | undefined> = {
      NATIVE_RESUME_SOURCE_RPC_ENABLED: "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "native-resume-source",
      AWS_LAMBDA_FUNCTION_VERSION: "7",
      AWS_SESSION_TOKEN: "synthetic-only",
      DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db",
      NATIVE_RESUME_SOURCE_BUCKET: "synthetic-source",
      NATIVE_RESUME_SOURCE_KMS_KEY_ARN:
        "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000000",
      NATIVE_RESUME_SOURCE_RPC_DEPLOYMENT_JSON: JSON.stringify({
        ...input.deployment,
        taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
      }),
    };
    const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-source:7";
    const handler = sourceModule.createNativeResumeSourceRpcLambda({
      environment: () => env,
      resolveDatabaseUrl: async () => {
        secrets++;
        return url;
      },
      createRuntime: (connection: string, _configuration: unknown, enabled: () => boolean) => {
        runtime = createNativeResumeSourceStore({
          url: connection,
          ports,
          enabled,
          job: (scope, query) => jobs.readNativeResumeJobSource(scope, query, enabled),
          reader: {
            read: async () => {
              reads++;
              await duringRead();
              return structuredClone(document);
            },
          },
        });
        return runtime;
      },
      testFetch: async () =>
        new Response(
          `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-resume/${task.split("/").at(-1)}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${task.split("/").at(-1)}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
          { headers: { "content-type": "text/xml" } },
        ),
    });
    const client = createNativeResumeSourceRpcClient({
      binding,
      bootstrap,
      targetArn: target,
      enabled: () => true,
      testCredentials: {
        accessKeyId: "ASIASYNTHETICEXAMPLE",
        secretAccessKey: "synthetic-local-only",
        sessionToken: "synthetic-local-signing-token-only",
      },
      testClient: {
        send: async (command) => ({
          StatusCode: 200,
          ExecutedVersion: "7",
          Payload: new TextEncoder().encode(
            nativeOwnerJson(
              await handler(
                JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)),
                { invokedFunctionArn: target },
              ),
            ),
          ),
        }),
      },
    });
    return {
      s,
      r,
      document,
      bootstrap,
      env,
      client,
      reads: () => reads,
      secrets: () => secrets,
      setRead: (fn: () => Promise<void>) => {
        duringRead = fn;
      },
      close: async () => {
        await runtime?.close();
      },
    };
  }
  it("loads original source through authenticated Lambda and actual owning SQL composition", async () => {
    const f = await sourceFixture();
    try {
      expect(f.secrets()).toBe(0);
      expect(await f.client.load(f.bootstrap.identity)).toEqual({
        document: f.document,
        job: { title: "Software Engineer", description: "Synthetic resume ledger job context." },
      });
      expect(f.secrets()).toBe(1);
      expect(f.reads()).toBe(1);
      expect(await f.s.claimOriginalCompletion(scope(f.r), reference(f.r))).toBe("claimed");
      await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow(
        "NativeResumeSourceUnavailable",
      );
      expect(f.reads()).toBe(1);
    } finally {
      await f.close();
    }
  });
  it.each(["hold", "job", "seal"])(
    "withholds source after actual %s mutation during object read",
    async (change) => {
      const f = await sourceFixture();
      try {
        f.setRead(async () => {
          if (change === "hold")
            await sql`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
          else if (change === "job")
            await sql`UPDATE jobs.canonical_jobs SET description='Synthetic changed source job' WHERE id=${input.application.canonicalJobId}`;
          else await f.s.seal(input.identity.ownerUserId, input.identity.applicationId);
        });
        await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow(
          "NativeResumeSourceUnavailable",
        );
        expect(f.reads()).toBe(1);
      } finally {
        await f.close();
      }
    },
  );
  it("pins source Lambda configuration and refuses forbidden ambient credentials before secret access", async () => {
    const f = await sourceFixture();
    try {
      f.env.DATABASE_URL = "synthetic-forbidden";
      await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow();
      expect(f.secrets()).toBe(0);
      delete f.env.DATABASE_URL;
      await f.client.load(f.bootstrap.identity);
      f.env.NATIVE_RESUME_SOURCE_BUCKET = "changed-source";
      await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow();
      expect(f.reads()).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("holds only the candidate source lease across I/O and releases it before quarantine", async () => {
    const f = await sourceFixture();
    try {
      f.setRead(async () => {
        await expect(
          sql.begin(async (tx) => {
            await tx`SET LOCAL lock_timeout='100ms'`;
            await tx`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${input.identity.ownerUserId}`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      });
      await f.client.load(f.bootstrap.identity);
      await sql`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${input.identity.ownerUserId}`;
      await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow(
        "NativeResumeSourceUnavailable",
      );
      expect(f.reads()).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("runs signed resume controls through the actual lazy Lambda and owner ledger", async () => {
    const f = await rpcFixture();
    try {
      expect(f.secrets()).toBe(0);
      await f.client.checkAdmission(f.binding);
      expect(await f.client.bootstrap()).toEqual({
        identity: input.identity,
        normalizedSha256: input.normalizedSha256,
        canonicalJobId: input.application.canonicalJobId,
      });
      expect(f.secrets()).toBe(1);
      const ref = reference(f.r);
      expect(await f.client.claimOriginalCompletion(ref)).toBe("claimed");
      expect(await f.client.claimOriginalCompletion(ref)).toBe("already_completed");
      await expect(f.client.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
      expect(
        await f.client.claimOriginalCompletion({
          ...ref,
          completedAtMs: ref.completedAtMs + 1,
          expiresAtMs: ref.expiresAtMs + 1,
        }),
      ).toBe("unavailable");
      await f.client.publishReady(ref);
      expect(await f.s.readAllocation(ref)).toBe(f.r.allocationId);
      await sql`UPDATE jobs.canonical_jobs SET description='Synthetic changed RPC job' WHERE id=${input.application.canonicalJobId}`;
      await expect(f.client.checkAdmission(f.binding)).rejects.toThrow(
        "NativeResumeOwnerUnavailable",
      );
      await expect(f.s.readAllocation(ref)).rejects.toThrow();
    } finally {
      await f.close();
    }
  });
  it("refuses correctly signed but altered original ledger bindings", async () => {
    const f = await rpcFixture();
    try {
      for (const part of ["configuration", "epoch", "owner", "generation"] as const) {
        const changed = structuredClone(f.binding);
        if (part === "configuration") changed.configurationSha256 = "0".repeat(64);
        else if (part === "epoch") changed.scope.epochId = uuidv7();
        else if (part === "owner")
          changed.scope.ownerUserId = changed.allocation.ownerUserId = uuidv7();
        else changed.scope.generationId = changed.allocation.generationId = uuidv7();
        await expect(f.connect(changed).bootstrap()).rejects.toThrow(
          "NativeResumeOwnerUnavailable",
        );
      }
      await f.client.checkAdmission(f.binding);
      const [stored] =
        await sql`SELECT configuration_sha256,task_arn,content_sha256 FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`;
      expect(stored).toEqual({
        configuration_sha256: config,
        task_arn: task,
        content_sha256: null,
      });
    } finally {
      await f.close();
    }
  });
  it("refuses Lambda configuration drift and forbidden ambient credentials before secret resolution", async () => {
    const f = await rpcFixture();
    try {
      f.env.DATABASE_URL = "synthetic-forbidden";
      await expect(f.client.bootstrap()).rejects.toThrow();
      expect(f.secrets()).toBe(0);
      delete f.env.DATABASE_URL;
      await f.client.checkAdmission(f.binding);
      f.env.AWS_LAMBDA_FUNCTION_VERSION = "8";
      await expect(f.client.bootstrap()).rejects.toThrow();
      expect(f.secrets()).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("refuses a sealed or source-held original task through authenticated RPC", async () => {
    const f = await rpcFixture();
    try {
      await sql`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
      await expect(f.client.bootstrap()).rejects.toThrow("NativeResumeOwnerUnavailable");
      expect(await f.client.claimOriginalCompletion(reference(f.r))).toBe("unavailable");
      await sql`UPDATE documents.resume_documents SET security_hold=false WHERE id=${input.identity.baseDocumentId}`;
      await f.s.seal(input.identity.ownerUserId, input.identity.applicationId);
      await expect(f.client.checkAdmission(f.binding)).rejects.toThrow(
        "NativeResumeOwnerUnavailable",
      );
      expect(await f.client.claimOriginalCompletion(reference(f.r))).toBe("unavailable");
    } finally {
      await f.close();
    }
  });
  it("matches the existing Applications packet revision and exact resume context", async () => {
    const module = await import(
      fileURLToPath(new URL("../../applications/dist/src/packet-source.js", import.meta.url))
    );
    const job = await catalog.getActiveJob(input.application.canonicalJobId);
    if (!job) throw Error("SyntheticJobUnavailable");
    const company = job.company as { id: string; name: string };
    expect(input.application.jobRevision).toBe(
      module.jobRevisionHash({
        id: job.id,
        active: true,
        company: { id: company.id, name: company.name },
        title: job.title,
        locations: job.locations,
        department: job.department ?? null,
      }),
    );
    await store().reserve(input);
  });
  it("refuses changed posting text even when the packet's summary revision stays unchanged", async () => {
    await sql`UPDATE jobs.canonical_jobs SET description='Synthetic changed description'
      WHERE id=${input.application.canonicalJobId}`;
    await expect(store().reserve(input)).rejects.toThrow("NativeResumeGenerationUnavailable");
    expect(
      await sql`SELECT id FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`,
    ).toHaveLength(0);
  });
  it("refuses changed company, title and locations at every admission", async () => {
    const s = store(),
      r = await s.reserve(input);
    await sql`UPDATE jobs.canonical_jobs SET title='Synthetic changed title'
      WHERE id=${input.application.canonicalJobId}`;
    await expect(s.claimLaunch(scope(r), config)).rejects.toThrow();
    const active = await catalog.getActiveJob(input.application.canonicalJobId);
    if (!active) throw Error("SyntheticJobUnavailable");
    input.application.jobRevision = bindings(active).jobRevision;
    input.identity.jobContextSha256 = bindings(active).jobContextSha256;
    await sql`UPDATE jobs.companies SET display_name='Synthetic changed company'
      WHERE id=(SELECT company_id FROM jobs.canonical_jobs WHERE id=${input.application.canonicalJobId})`;
    await expect(s.reserve(input)).rejects.toThrow();
    await sql`UPDATE jobs.canonical_jobs SET locations='["Synthetic changed location"]'::jsonb
      WHERE id=${input.application.canonicalJobId}`;
    await expect(s.reserve(input)).rejects.toThrow();
  });
  it("refuses withdrawn sources, expiry and terminal status", async () => {
    await sql`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${input.application.canonicalJobId}`;
    await expect(store().reserve(input)).rejects.toThrow();
    await sql`UPDATE jobs.job_sources SET withdrawn_at=NULL WHERE job_id=${input.application.canonicalJobId}`;
    await sql`UPDATE jobs.canonical_jobs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${input.application.canonicalJobId}`;
    await expect(store().reserve(input)).rejects.toThrow();
    await sql`UPDATE jobs.canonical_jobs SET expires_at=clock_timestamp()+interval '1 day',status='blocked' WHERE id=${input.application.canonicalJobId}`;
    await expect(store().reserve(input)).rejects.toThrow();
  });
  it("holds catalog revision and source withdrawal fences until its caller transaction ends", async () => {
    await sql.begin(async (tx) => {
      await ports.application(input.application, tx as unknown as NativeResumeOwnerQuery);
      await ports.job(
        input.application,
        input.identity.jobContextSha256,
        tx as unknown as NativeResumeOwnerQuery,
      );
      for (const change of ["title", "source", "company", "alias"] as const) {
        await expect(
          sql.begin(async (other) => {
            await other`SET LOCAL lock_timeout='150ms'`;
            if (change === "title")
              await other`UPDATE jobs.canonical_jobs SET title='Synthetic concurrent title' WHERE id=${input.application.canonicalJobId}`;
            else if (change === "source")
              await other`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${input.application.canonicalJobId}`;
            else if (change === "company")
              await other`UPDATE jobs.companies SET display_name='Synthetic concurrent company' WHERE id=(SELECT company_id FROM jobs.canonical_jobs WHERE id=${input.application.canonicalJobId})`;
            else
              await other`UPDATE jobs.duplicate_candidates SET fingerprint=fingerprint WHERE false`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      }
    });
    await sql`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${input.application.canonicalJobId}`;
    await expect(store().reserve(input)).rejects.toThrow();
  });
  it("accepts active exact-member source evidence but refuses an alias as canonical intent", async () => {
    const alias = await catalog.recordObservation({
      provider: "greenhouse",
      provenance: "authorized_fixture",
      companyName: `Synthetic alias ${uuidv7()}`,
      title: "Other synthetic role",
      locations: ["Remote - US"],
      description: "Synthetic alias source.",
      sourceUrl: `https://jobs.example.test/${uuidv7()}`,
      observedAt: new Date(),
      atsTenant: `synthetic-${uuidv7()}`,
      externalJobId: "job-2",
      adapterVersion: "synthetic-v1",
    });
    const canonical = input.application.canonicalJobId;
    const [first, second] = [canonical, alias.job.id].sort();
    if (!first || !second) throw Error("SyntheticAliasUnavailable");
    await sql`INSERT INTO jobs.duplicate_candidates(job_id,candidate_job_id,classification,fingerprint,
      resolution,canonical_job_id,reviewed_at,reviewed_by,review_reason_code,resolution_version)
      VALUES (${first},${second},'exact','synthetic','exact',${canonical},clock_timestamp(),'synthetic','synthetic',1)`;
    await sql`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${canonical}`;
    expect((await catalog.getActiveJob(canonical))?.id).toBe(canonical);
    await store().reserve(input);
    await expect(
      sql.begin(async (tx) =>
        ports.job(
          { ...input.application, canonicalJobId: alias.job.id },
          input.identity.jobContextSha256,
          tx as unknown as NativeResumeOwnerQuery,
        ),
      ),
    ).rejects.toThrow("NativeResumeJobAdmissionUnavailable");
    await sql`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${alias.job.id}`;
    await expect(store().reserve(input)).rejects.toThrow();
  });
  it("withholds original ready material after source withdrawal without renewing completion", async () => {
    const { s, r } = await bound(),
      ref = reference(r);
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("claimed");
    await s.publishReady(scope(r), ref);
    expect(await s.readAllocation(ref)).toBe(r.allocationId);
    await sql`UPDATE jobs.job_sources SET withdrawn_at=last_verified_at WHERE job_id=${input.application.canonicalJobId}`;
    await expect(s.readAllocation(ref)).rejects.toThrow("NativeResumeGenerationUnavailable");
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("unavailable");
    const [record] =
      await sql`SELECT completed_at_ms::text AS completed, expires_at_ms::text AS expires
      FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`;
    expect(record).toEqual({
      completed: String(ref.completedAtMs),
      expires: String(ref.expiresAtMs),
    });
  });
  beforeAll(async () => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const path of [
      "../../profile/dist/src/migrate.js",
      "../../applications/dist/src/migrate.js",
      "../../jobs/dist/src/migrate.js",
      "../dist/src/migrate.js",
    ])
      for (let replay = 0; replay < 2; replay++)
        await promisify(execFile)(
          process.execPath,
          [fileURLToPath(new URL(path, import.meta.url))],
          { env: { ...inherited, DATABASE_URL: url } },
        );
    const ownerPorts = await import(
      fileURLToPath(
        new URL("../../../workflows/dist/src/native-resume-owner-ports.js", import.meta.url),
      )
    );
    ports = ownerPorts.createNativeResumeGenerationOwnerPorts(() => true);
    const jobs = await import(
      fileURLToPath(new URL("../../jobs/dist/src/persistence/catalog.js", import.meta.url))
    );
    catalog = new jobs.PostgresJobCatalog(sql, {
      searchCursorKeys: { active: { id: "synthetic-v1", key: Buffer.alloc(32, 1) } },
    });
    const jobOwner = await import(
      fileURLToPath(new URL("../../jobs/dist/src/native-resume-admission.js", import.meta.url))
    );
    bindings = jobOwner.nativeResumeJobBindings;
    const ordinary = await import(
      fileURLToPath(
        new URL("../../applications/dist/src/native-material-admission.js", import.meta.url),
      )
    );
    admitAnyApplication = ordinary.lockNativeMaterialApplicationAdmission;
  }, 60000);
  beforeEach(async () => {
    task = `arn:aws:ecs:us-east-2:123456789012:task/synthetic-resume/${uuidv7().replaceAll("-", "")}`;
    const owner = uuidv7(),
      app = uuidv7(),
      base = uuidv7(),
      packet = uuidv7();
    const observed = await catalog.recordObservation({
      provider: "greenhouse",
      provenance: "authorized_fixture",
      companyName: `Synthetic ${app}`,
      title: "Software Engineer",
      locations: ["Remote - US"],
      description: "Synthetic resume ledger job context.",
      sourceUrl: `https://jobs.example.test/${app}`,
      observedAt: new Date(),
      atsTenant: `synthetic-${app}`,
      externalJobId: "job-1",
      adapterVersion: "synthetic-v1",
    });
    const job = observed.job.id;
    const active = await catalog.getActiveJob(job);
    if (!active) throw Error("SyntheticJobUnavailable");
    const current = bindings(active);
    input = {
      identity: {
        generationId: uuidv7(),
        ownerUserId: owner,
        applicationId: app,
        version: 1,
        baseDocumentId: base,
        baseVersion: 1,
        baseSha256: "a".repeat(64),
        jobContextSha256: current.jobContextSha256,
      },
      application: {
        ownerUserId: owner,
        applicationId: app,
        canonicalJobId: job,
        expectedRevision: 2,
        packetId: packet,
        packetHash: "e".repeat(64),
        jobRevision: current.jobRevision,
      },
      normalizedSha256: "b".repeat(64),
      previousEpochId: null,
      deployment: {
        clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-resume",
        taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-resume:1",
        containerName: "synthetic",
      },
    };
    const applications = await import(
      fileURLToPath(new URL("../../applications/dist/src/index.js", import.meta.url))
    );
    input.application.packetHash = applications.computePacketHash({
      userId: input.identity.ownerUserId,
      applicationId: input.identity.applicationId,
      canonicalJobId: input.application.canonicalJobId,
      version: 1,
      jobRevision: input.application.jobRevision,
      form: null,
      fields: [],
      artifactHashes: {},
    });
    await sql.begin(async (tx) => {
      await tx`INSERT INTO identity.users(id) VALUES (${owner})`;
      await tx`INSERT INTO applications.applications(id,owner_user_id,canonical_job_id,status,revision,created_at,updated_at) VALUES (${app},${owner},${job},'review_required',1,clock_timestamp(),clock_timestamp())`;
      await tx`INSERT INTO applications.packets(id,application_id,owner_user_id,version,packet_hash,job_revision,fields,created_at) VALUES (${packet},${app},${owner},1,${input.application.packetHash},${input.application.jobRevision},'[]'::jsonb,clock_timestamp())`;
      await tx`UPDATE applications.applications SET current_packet_id=${packet},revision=2 WHERE id=${app}`;
      await tx`INSERT INTO documents.resume_documents(id,user_id,file_name,media_type,size_bytes,sha256,source_object_key,status,parser_version,normalized_object_key,normalized_object_version,normalized_sha256,page_count,character_count)
        VALUES (${base},${owner},'synthetic.pdf','application/pdf',625,${input.identity.baseSha256},${`quarantine/${base}/source`},'parsed','parser-1',${`normalized/${base}/source/parser-1/resume.json`},'synthetic-v1',${input.normalizedSha256},1,100)`;
    });
  });
  afterAll(async () => {
    await sql.end();
  });
  async function queuedResumeFixture() {
    const applications = await import(
      fileURLToPath(new URL("../../applications/dist/src/index.js", import.meta.url))
    );
    const requests = await import(
      fileURLToPath(
        new URL("../../applications/dist/src/native-resume-request-store.js", import.meta.url),
      )
    );
    const synthetic = await import(
      new URL("../../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
    );
    const protection = synthetic.createSyntheticPacketProtection();
    const applicationStore = new applications.PostgresApplicationStore(sql, () => new Date(), {
      definitions: applications.defaultFieldDefinitions(),
      restrictedPackets: protection.options,
      nativeResumePreparationEnabled: () => true,
    });
    const command = {
      ownerUserId: input.identity.ownerUserId,
      applicationId: input.identity.applicationId,
      expectedRevision: 2,
      idempotencyKey: `resume-${uuidv7()}`,
      packet: {
        jobRevision: input.application.jobRevision,
        form: null,
        fields: [],
        artifactHashes: {},
      },
    };
    return {
      applicationStore,
      command,
      protection,
      requests: new requests.PostgresNativeResumeRequestStore(sql, () => true),
    };
  }
  it("queues one original resume with the Prepare packet and dispatches its captured source", async () => {
    const f = await queuedResumeFixture();
    try {
      const created = await f.applicationStore.createPacket(f.command);
      expect(created.view.application.revision).toBe(3);
      expect((await f.applicationStore.createPacket(f.command)).replayed).toBe(true);
      const rows = await sql`SELECT id,resume_packet_id,payload FROM applications.outbox
        WHERE application_id=${input.identity.applicationId} AND event_type='application.resume-preparation.requested.v1'`;
      expect(rows).toHaveLength(1);
      const event = rows[0];
      expect(event?.resume_packet_id).toBe(created.view.currentPacket.id);
      expect(Object.keys(event?.payload).sort()).toEqual([
        "applicationId",
        "revision",
        "status",
        "userId",
      ]);
      expect(await f.requests.pending()).toContain(event?.id);
      const dispatchModule = await import(
        fileURLToPath(
          new URL("../../../workflows/dist/src/native-resume-request-dispatch.js", import.meta.url),
        )
      );
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-durable:9";
      const calls: unknown[] = [];
      const dispatch = dispatchModule.createNativeResumeRequestDispatcher({
        requests: f.requests,
        generations: store(),
        deployment: input.deployment,
        workflowArn: target,
        jobContext: async () => input.identity.jobContextSha256,
        enabled: () => true,
        invoker: {
          send: async (command: InvokeCommand) => {
            if (!(command.input.Payload instanceof Uint8Array)) throw Error("ExpectedBytePayload");
            const payload = JSON.parse(new TextDecoder().decode(command.input.Payload));
            calls.push(payload);
            expect(command.input).toMatchObject({
              FunctionName: target,
              InvocationType: "Event",
              DurableExecutionName: `resume-${event?.id}`,
            });
            expect(payload.reservation.identity).toMatchObject({
              generationId: event?.id,
              baseDocumentId: input.identity.baseDocumentId,
            });
            expect(payload.reservation.application).toMatchObject({
              packetId: created.view.currentPacket.id,
              expectedRevision: 3,
            });
            return {
              StatusCode: 202,
              DurableExecutionArn: `${target}/durable-execution/resume-${event?.id}/synthetic`,
            };
          },
        },
      });
      expect(await dispatch(event?.id)).toBe("started");
      expect(await dispatch(event?.id)).toBe("unavailable");
      expect(calls).toHaveLength(1);
      const [receipt] =
        await sql`SELECT status,resume_workflow_arn FROM applications.outbox WHERE id=${event?.id}`;
      expect(receipt).toEqual({ status: "published", resume_workflow_arn: target });
      expect(await f.requests.pending()).not.toContain(event?.id);
    } finally {
      f.protection.destroy();
    }
  });
  it("rolls back the packet and idempotency receipt when its resume request cannot be queued", async () => {
    const f = await queuedResumeFixture();
    await sql.unsafe(
      `CREATE FUNCTION applications.synthetic_resume_queue_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='application.resume-preparation.requested.v1' THEN RAISE EXCEPTION 'SyntheticQueueFailure'; END IF; RETURN NEW; END $$`,
    );
    await sql.unsafe(
      `CREATE TRIGGER synthetic_resume_queue_failure BEFORE INSERT ON applications.outbox FOR EACH ROW EXECUTE FUNCTION applications.synthetic_resume_queue_failure()`,
    );
    try {
      await expect(f.applicationStore.createPacket(f.command)).rejects.toThrow();
      const [row] =
        await sql`SELECT revision,(SELECT count(*)::int FROM applications.packets WHERE application_id=${input.identity.applicationId}) AS packets,
        (SELECT count(*)::int FROM applications.command_receipts WHERE owner_user_id=${input.identity.ownerUserId}) AS receipts
        FROM applications.applications WHERE id=${input.identity.applicationId}`;
      expect(Number(row?.revision)).toBe(2);
      expect(row?.packets).toBe(1);
      expect(row?.receipts).toBe(0);
    } finally {
      await sql.unsafe(`DROP TRIGGER synthetic_resume_queue_failure ON applications.outbox`);
      await sql.unsafe(`DROP FUNCTION applications.synthetic_resume_queue_failure()`);
      f.protection.destroy();
    }
  });
  it.each([false, true])(
    "runs the actual scheduled SQL/Jobs dispatcher with held source=%s",
    async (held) => {
      const f = await queuedResumeFixture();
      let runtime: { close(): Promise<void> } | undefined;
      try {
        await f.applicationStore.createPacket(f.command);
        if (held)
          await sql`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
        const [event] =
          await sql`SELECT id FROM applications.outbox WHERE application_id=${input.identity.applicationId}
        AND event_type='application.resume-preparation.requested.v1'`;
        const module = await import(
          fileURLToPath(
            new URL(
              "../../../workflows/dist/src/native-resume-request-dispatch-lambda.js",
              import.meta.url,
            ),
          )
        );
        const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-durable:9";
        let calls = 0;
        const running = module.createNativeResumeRequestDispatchRuntime(
          url,
          {
            target: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-dispatch:1",
            secretId: "synthetic-unused",
            workflowArn: target,
            deployment: input.deployment,
          },
          () => true,
          {
            send: async (command: InvokeCommand) => {
              calls++;
              expect(command.input.DurableExecutionName).toBe(`resume-${event?.id}`);
              return {
                StatusCode: 202,
                DurableExecutionArn: `${target}/durable-execution/resume-${event?.id}/synthetic`,
              };
            },
          },
        );
        runtime = running;
        expect(await running.run()).toEqual({
          schemaVersion: 1,
          examined: 1,
          started: held ? 0 : 1,
          noResume: held ? 1 : 0,
          pending: 0,
        });
        expect(calls).toBe(held ? 0 : 1);
        expect(await running.run()).toEqual({
          schemaVersion: 1,
          examined: 0,
          started: 0,
          noResume: 0,
          pending: 0,
        });
        const [result] = await sql`SELECT status FROM applications.outbox WHERE id=${event?.id}`;
        expect(result?.status).toBe("published");
      } finally {
        await runtime?.close();
        f.protection.destroy();
      }
    },
  );
  it("grants one concurrent dispatch lease and rejects changing its original packet or workflow", async () => {
    const f = await queuedResumeFixture();
    try {
      await f.applicationStore.createPacket(f.command);
      const [event] =
        await sql`SELECT id FROM applications.outbox WHERE application_id=${input.identity.applicationId}
        AND event_type='application.resume-preparation.requested.v1'`;
      const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-durable:9";
      const claims = await Promise.all([
        f.requests.claim(event?.id, target),
        f.requests.claim(event?.id, target),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await expect(
        sql`UPDATE applications.outbox SET resume_workflow_arn=${target.replace(":9", ":10")},attempt_count=attempt_count+1 WHERE id=${event?.id}`,
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        sql`UPDATE applications.outbox SET resume_packet_id=${input.application.packetId},attempt_count=attempt_count+1 WHERE id=${event?.id}`,
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      f.protection.destroy();
    }
  });

  async function preparationFixture(
    afterProof?: () => Promise<void>,
    launchBehavior: "normal" | "lost_ack" | "wrong_image" = "normal",
  ) {
    const applications = await import(
      fileURLToPath(new URL("../../applications/dist/src/index.js", import.meta.url))
    );
    const ownerPorts = await import(
      fileURLToPath(
        new URL("../../../workflows/dist/src/native-resume-owner-ports.js", import.meta.url),
      )
    );
    const preparationModule = await import(
      fileURLToPath(
        new URL("../../../workflows/dist/src/native-resume-preparation.js", import.meta.url),
      )
    );
    const authority = ownerPorts.createNativeResumePacketAuthority(() => true);
    const applicationStore = new applications.PostgresApplicationStore(sql, () => new Date(), {
      definitions: applications.defaultFieldDefinitions(),
      nativeResumeMaterials: {
        ...authority,
        lockReady: async (
          intent: NativeResumeReservation["application"],
          ref: TemporaryMaterialReference,
          query: NativeResumeOwnerQuery,
        ) => {
          await authority.lockReady(intent, ref, query);
          await afterProof?.();
        },
      },
    });
    const generations = store();
    const configuration = {
      ...input.deployment,
      image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/synthetic-resume@sha256:${"c".repeat(64)}`,
      executionRoleArn: "arn:aws:iam::123456789012:role/synthetic-execution",
      taskRoleArn: "arn:aws:iam::123456789012:role/synthetic-resume",
      cpu: "256" as const,
      memory: "512" as const,
      subnets: ["subnet-12345678901234567"],
      securityGroups: ["sg-12345678901234567"],
      assignPublicIp: "ENABLED" as const,
    };
    let runs = 0;
    const launchOptions: Parameters<typeof createNativeResumeTaskLaunch>[0] = {
      registry: generations,
      configuration,
      enabled: () => true,
      launchEnabled: () => true,
      testClient: {
        send: async (command) => {
          if (command instanceof DescribeTaskDefinitionCommand)
            return {
              taskDefinition: {
                taskDefinitionArn: configuration.taskDefinitionArn,
                status: "ACTIVE",
                networkMode: "awsvpc",
                requiresCompatibilities: ["FARGATE"],
                runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "X86_64" },
                cpu: configuration.cpu,
                memory: configuration.memory,
                executionRoleArn: configuration.executionRoleArn,
                taskRoleArn: configuration.taskRoleArn,
                containerDefinitions: [
                  {
                    name: configuration.containerName,
                    image: configuration.image,
                    essential: true,
                    readonlyRootFilesystem: true,
                    user: "65532:65532",
                    workingDirectory: "/materials",
                    entryPoint: ["/usr/local/bin/node"],
                    command: [
                      launchBehavior === "wrong_image"
                        ? "native-material/main.mjs"
                        : "native-resume/main.mjs",
                    ],
                    linuxParameters: { capabilities: { drop: ["ALL"] } },
                    ulimits: [{ name: "core", softLimit: 0, hardLimit: 0 }],
                  },
                ],
              },
            };
          if (!(command instanceof RunTaskCommand)) throw Error("UnexpectedSyntheticEcsCommand");
          runs++;
          if (launchBehavior === "lost_ack") throw Error("SyntheticLostRunTaskAck");
          expect(
            command.input.overrides?.containerOverrides?.[0]?.environment?.map(
              (entry) => entry.name,
            ),
          ).toEqual([
            "NATIVE_MATERIAL_ALLOCATION_ID",
            "NATIVE_MATERIAL_OWNER_USER_ID",
            "NATIVE_MATERIAL_APPLICATION_ID",
            "NATIVE_MATERIAL_GENERATION_ID",
            "NATIVE_MATERIAL_EPOCH_ID",
            "NATIVE_RESUME_CONFIGURATION_SHA256",
          ]);
          return {
            tasks: [
              {
                taskArn: task,
                clusterArn: configuration.clusterArn,
                taskDefinitionArn: configuration.taskDefinitionArn,
                startedBy: command.input.startedBy,
                launchType: "FARGATE",
                platformVersion: "1.4.0",
                enableExecuteCommand: false,
                lastStatus: "PENDING",
                containers: [{ name: configuration.containerName, taskArn: task }],
                overrides: command.input.overrides,
              },
            ],
            failures: [],
          };
        },
      },
    };
    const launcher = createNativeResumeTaskLaunch(launchOptions);
    const preparation = preparationModule.createNativeResumePreparation({
      generations,
      launcher,
      applications: applicationStore,
      enabled: () => true,
    });
    return {
      preparation,
      generations,
      launcher,
      applicationStore,
      applications,
      configuration,
      testClient: launchOptions.testClient,
      runs: () => runs,
    };
  }
  it("connects original launch, verified-ready packet attachment and current resume location", async () => {
    const f = await preparationFixture();
    const original = await f.preparation.start(input);
    expect(f.runs()).toBe(1);
    expect(await f.preparation.start(input)).toEqual(original);
    expect(f.runs()).toBe(1);
    expect(await f.preparation.complete(original)).toEqual({ kind: "in_progress" });
    const row = await f.generations.readLaunch(original, f.launcher.configurationSha256);
    const ref = reference(row);
    expect(await f.generations.claimOriginalCompletion(original, ref)).toBe("claimed");
    await f.generations.publishReady(original, ref);
    const attached = await f.preparation.complete(original);
    expect(attached).toMatchObject({ kind: "ready", revision: 3 });
    expect(await f.preparation.complete(original)).toEqual(attached);
    const view = await f.applicationStore.getApplication(
      input.identity.ownerUserId,
      input.identity.applicationId,
    );
    expect(view.currentPacket.temporaryMaterials).toEqual([ref]);
    expect(view.currentPacket.artifactHashes.resume).toBe(ref.contentSha256);
    expect(view.currentPacket.fields).toContainEqual(
      expect.objectContaining({
        fieldKey: "documents.resume",
        requiresReview: true,
        value: ref.contentSha256,
      }),
    );
    const service = new f.applications.ApplicationsService({
      store: f.applicationStore,
      nativeReadAuthorizationsEnabled: () => true,
      nativeResumeLocations: {
        resolve: createNativeResumeLocationReader({
          baseHost: "resume.synthetic.invalid",
          readAllocation: f.generations.readAllocation.bind(f.generations),
          enabled: () => true,
        }),
      },
    });
    const location = await service.resumeMaterialLocation(
      input.identity.ownerUserId,
      input.identity.applicationId,
      input.identity.generationId,
    );
    expect(location.origin).toBe(`https://${original.allocationId}.resume.synthetic.invalid:8443`);
    expect(location.packetId).toBe(attached.packetId);
    expect(location.temporaryMaterial.expiresAtMs).toBe(ref.expiresAtMs);
    expect(f.runs()).toBe(1);
  });

  it("connects private numeric invocation to actual SQL and finishes with new launches disabled", async () => {
    const f = await preparationFixture();
    const module = await import(
      fileURLToPath(
        new URL(
          "../../../workflows/dist/src/native-resume-preparation-control-lambda.js",
          import.meta.url,
        ),
      )
    );
    const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-preparation:9";
    const environment: Record<string, string> = {
      NATIVE_RESUME_PREPARATION_CONTROL_ENABLED: "true",
      NATIVE_RESUME_NEW_LAUNCH_ENABLED: "true",
      RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
      AWS_REGION: "us-east-2",
      PLATFORM_AWS_ACCOUNT_ID: "123456789012",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-resume-preparation",
      AWS_LAMBDA_FUNCTION_VERSION: "9",
      AWS_SESSION_TOKEN: "synthetic-session",
      DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic",
      NATIVE_RESUME_LAUNCH_CONFIGURATION_JSON: JSON.stringify(f.configuration),
    };
    let secretReads = 0;
    let runtime: { close(): Promise<void> } | undefined;
    const handler = module.createNativeResumePreparationControlLambda({
      environment: () => environment,
      resolveDatabaseUrl: async () => {
        secretReads++;
        return url;
      },
      createRuntime: (
        ...args: Parameters<typeof module.createNativeResumePreparationControlRuntime>
      ) => {
        const created = module.createNativeResumePreparationControlRuntime(
          ...args.slice(0, 4),
          f.testClient,
        );
        runtime = created;
        return created;
      },
    });
    const client = createNativeResumePreparationControlClient({
      functionArn: target,
      enabled: () => true,
      launchEnabled: () => true,
      testClient: {
        send: async (command: InvokeCommand) => {
          if (!(command.input.Payload instanceof Uint8Array)) throw Error("ExpectedBytePayload");
          const response = await handler(
            JSON.parse(new TextDecoder().decode(command.input.Payload)),
            {
              invokedFunctionArn: command.input.FunctionName,
            },
          );
          return {
            StatusCode: 200,
            ExecutedVersion: "9",
            Payload: new TextEncoder().encode(JSON.stringify(response)),
          };
        },
      },
    });
    try {
      const reserved = await client.run({ schemaVersion: 1, action: "start", reservation: input });
      expect(reserved.outcome).toBe("reserved");
      if (!reserved.scope) throw Error("MissingOriginalScope");
      const complete = {
        schemaVersion: 1 as const,
        action: "complete" as const,
        scope: reserved.scope,
      };
      expect((await client.run(complete)).outcome).toBe("pending");
      const row = await f.generations.readLaunch(reserved.scope, f.launcher.configurationSha256);
      const ref = reference(row);
      await f.generations.claimOriginalCompletion(reserved.scope, ref);
      await f.generations.publishReady(reserved.scope, ref);
      environment.NATIVE_RESUME_NEW_LAUNCH_ENABLED = "false";
      const ready = await client.run(complete);
      expect(ready).toMatchObject({ outcome: "ready", packet: { revision: 3 } });
      expect(await client.run(complete)).toEqual(ready);
      await expect(
        client.run({ schemaVersion: 1, action: "start", reservation: input }),
      ).rejects.toThrow();
      expect(secretReads).toBe(1);
      expect(f.runs()).toBe(1);
    } finally {
      await runtime?.close();
    }
  });

  it("never redispatches an original resume after losing the RunTask acknowledgement", async () => {
    const f = await preparationFixture(undefined, "lost_ack");
    await expect(f.preparation.start(input)).rejects.toThrow("NativeTaskLaunchUnavailable");
    const original = await f.preparation.start(input);
    expect(f.runs()).toBe(1);
    expect(await f.preparation.complete(original)).toEqual({ kind: "in_progress" });
    const row = await f.generations.readLaunch(original, f.launcher.configurationSha256);
    expect(row.allocation).toBeNull();
    expect(row.reference).toBeNull();
  });
  it("rejects a cover-letter image before claiming or dispatching resume work", async () => {
    const f = await preparationFixture(undefined, "wrong_image");
    await expect(f.preparation.start(input)).rejects.toThrow("NativeTaskLaunchUnavailable");
    expect(f.runs()).toBe(0);
    const [row] =
      await sql`SELECT launch_claimed_at,configuration_sha256 FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`;
    expect(row).toEqual({ launch_claimed_at: null, configuration_sha256: null });
  });

  it.each(["seal", "job", "hold", "revision"])(
    "refuses resume packet attachment after %s changes",
    async (change) => {
      const f = await preparationFixture();
      const original = await f.preparation.start(input);
      const row = await f.generations.readLaunch(original, f.launcher.configurationSha256),
        ref = reference(row);
      await f.generations.claimOriginalCompletion(original, ref);
      await f.generations.publishReady(original, ref);
      if (change === "seal")
        await f.generations.seal(input.identity.ownerUserId, input.identity.applicationId);
      if (change === "job")
        await sql`UPDATE jobs.canonical_jobs SET description='Synthetic newer description' WHERE id=${input.application.canonicalJobId}`;
      if (change === "hold")
        await sql`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
      if (change === "revision")
        await sql`UPDATE applications.applications SET revision=revision+1 WHERE id=${input.identity.applicationId}`;
      await expect(f.preparation.complete(original)).rejects.toThrow();
      const [count] =
        await sql`SELECT count(*)::int AS count FROM applications.packets WHERE application_id=${input.identity.applicationId}`;
      expect(count?.count).toBe(1);
      expect(f.runs()).toBe(1);
    },
  );
  it("holds owning ready/source/job admission through the actual packet commit", async () => {
    let checked = 0;
    const f = await preparationFixture(async () => {
      for (const change of ["head", "base", "job"]) {
        await expect(
          sql.begin(async (tx) => {
            await tx`SET LOCAL lock_timeout='100ms'`;
            if (change === "head")
              await tx`UPDATE documents.native_material_admission SET sealed_at=clock_timestamp() WHERE user_id=${input.identity.ownerUserId} AND application_id=${input.identity.applicationId}`;
            if (change === "base")
              await tx`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
            if (change === "job")
              await tx`UPDATE jobs.canonical_jobs SET description='Synthetic conflicting description' WHERE id=${input.application.canonicalJobId}`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
        checked++;
      }
    });
    const original = await f.preparation.start(input),
      row = await f.generations.readLaunch(original, f.launcher.configurationSha256),
      ref = reference(row);
    await f.generations.claimOriginalCompletion(original, ref);
    await f.generations.publishReady(original, ref);
    expect(await f.preparation.complete(original)).toMatchObject({ kind: "ready", revision: 3 });
    expect(checked).toBe(3);
  });

  async function coverGrant() {
    const document = uuidv7();
    await new PostgresCoverLetterStore(sql, {
      putIfAbsent: async () => {
        throw Error("SyntheticObjectCapabilityDenied");
      },
      read: async () => {
        throw Error("SyntheticObjectCapabilityDenied");
      },
    }).reserve({
      id: document,
      ownerUserId: input.identity.ownerUserId,
      applicationId: input.identity.applicationId,
      jobRevision: input.application.jobRevision,
      confirmedFactsHash: "a".repeat(64),
    });
    const result = await new PostgresCoverLetterWorkStore(sql, () => true).issue({
      ownerUserId: input.identity.ownerUserId,
      documentId: document,
      purpose: "provider_dispatch",
      requestSha256: "b".repeat(64),
      consentExpiresAt: new Date(Date.now() + 900000),
    });
    if (!result.authorization) throw Error("SyntheticCoverGrantMissing");
    return {
      id: result.authorization.id,
      documentId: document,
      purpose: "provider_dispatch" as const,
      requestSha256: result.authorization.requestSha256,
    };
  }
  it("serializes both native material kinds and refuses false application disposal while resume metadata is unretired", async () => {
    const s = store(),
      r = await s.reserve(input),
      grant = await coverGrant();
    await expect(sql`INSERT INTO documents.native_material_allocations(id,user_id,application_id,epoch_id,document_id,work_id,request_sha256,cluster_arn,task_definition_arn,container_name)
      VALUES (${uuidv7()},${input.identity.ownerUserId},${input.identity.applicationId},${r.epochId},${grant.documentId},${grant.id},${grant.requestSha256},${input.deployment.clusterArn},${input.deployment.taskDefinitionArn},${input.deployment.containerName})`).rejects.toMatchObject(
      { code: "55000", message: "original native resume allocation remains" },
    );
    const registry = new PostgresNativeMaterialRegistry(sql, () => true, admitAnyApplication);
    await s.seal(input.identity.ownerUserId, input.identity.applicationId);
    expect(
      await registry.confirmApplicationDisposed(
        input.identity.ownerUserId,
        input.identity.applicationId,
        r.epochId,
      ),
    ).toBe(false);
    await s.cancelBeforeLaunch(scope(r));
    expect(
      await registry.confirmApplicationDisposed(
        input.identity.ownerUserId,
        input.identity.applicationId,
        r.epochId,
      ),
    ).toBe(true);
  });
  it("refuses native resume reservation while an existing original cover-letter allocation remains", async () => {
    const grant = await coverGrant();
    const registry = new PostgresNativeMaterialRegistry(sql, () => true, admitAnyApplication);
    const original = await registry.admit({
      ownerUserId: input.identity.ownerUserId,
      applicationId: input.identity.applicationId,
      original: grant,
      previousEpochId: null,
      deployment: input.deployment,
    });
    expect(original.state).toBe("pending");
    await expect(store().reserve(input)).rejects.toThrow("NativeResumeGenerationUnavailable");
    expect(
      await sql`SELECT id FROM documents.native_resume_generations WHERE user_id=${input.identity.ownerUserId}`,
    ).toHaveLength(0);
  });
  it("reserves exactly once, with scalar metadata and the exact captured owner/base/packet", async () => {
    const s = store(),
      r = await s.reserve(input);
    expect(await s.reserve(input)).toEqual(r);
    expect(r.reference).toBeNull();
    expect(r.allocation).toBeNull();
    expect(r.ready).toBe(false);
    await expect(
      s.reserve({ ...input, identity: { ...input.identity, baseSha256: "0".repeat(64) } }),
    ).rejects.toThrow("NativeResumeGenerationUnavailable");
    expect(
      await sql`SELECT id FROM documents.native_resume_generations WHERE user_id=${input.identity.ownerUserId}`,
    ).toHaveLength(1);
  });
  it("consumes one original launch claim under concurrent retries and binds only its pinned task", async () => {
    const s = store(),
      r = await s.reserve(input);
    const claims = await Promise.all([
      s.claimLaunch(scope(r), config),
      s.claimLaunch(scope(r), config),
    ]);
    expect(claims.filter((c) => c.claimed)).toHaveLength(1);
    await expect(s.claimLaunch(scope(r), "0".repeat(64))).rejects.toThrow();
    const b = await s.bindTask(scope(r), config, task);
    expect(await s.bindTask(scope(r), config, task)).toEqual(b);
    await expect(
      s.bindTask(scope(r), config, `${task.slice(0, -32)}${"0".repeat(32)}`),
    ).rejects.toThrow();
  });
  it("does not accept completion before the original task is bound", async () => {
    const s = store(),
      r = await s.reserve(input);
    expect(await s.claimOriginalCompletion(scope(r), reference(r))).toBe("unavailable");
    await expect(s.publishReady(scope(r), reference(r))).rejects.toThrow();
  });
  it("pins original task admission and allows metadata-only lost-ACK reads after sealing", async () => {
    const { s, r } = await bound();
    if (!r.allocation) throw Error("SyntheticBoundTaskMissing");
    await s.checkTaskAdmission(scope(r), r.allocation, config);
    await expect(
      s.checkTaskAdmission(scope(r), { ...r.allocation, generationId: uuidv7() }, config),
    ).rejects.toThrow();
    await s.seal(input.identity.ownerUserId, input.identity.applicationId);
    expect((await s.readLaunch(scope(r), config)).allocation).toEqual(r.allocation);
    await expect(s.checkTaskAdmission(scope(r), r.allocation, config)).rejects.toThrow();
  });
  it("cancels only before an original launch claim, without inventing task death", async () => {
    const s = store(),
      r = await s.reserve(input);
    await s.cancelBeforeLaunch(scope(r));
    await s.cancelBeforeLaunch(scope(r));
    await expect(s.claimLaunch(scope(r), config)).rejects.toThrow();
    await sql`DELETE FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`;
    const next = await s.reserve({
      ...input,
      identity: { ...input.identity, generationId: uuidv7(), version: 2 },
    });
    await s.claimLaunch(scope(next), config);
    await expect(s.cancelBeforeLaunch(scope(next))).rejects.toThrow();
  });
  it("captures nested original intent before owning awaits and refuses future or expired completion", async () => {
    const original = structuredClone(input);
    const s = new PostgresNativeResumeGenerationStore(
      sql,
      {
        ...ports,
        job: async (intent, context, query) => {
          input.identity.baseVersion = 99;
          input.application.packetHash = "0".repeat(64);
          await ports.job(intent, context, query);
        },
      },
      () => true,
    );
    const r = await s.reserve(input);
    expect(r.reservation).toEqual(original);
    const normal = store();
    await normal.claimLaunch(scope(r), config);
    await normal.bindTask(scope(r), config, task);
    expect(await normal.claimOriginalCompletion(scope(r), reference(r, Date.now() + 60000))).toBe(
      "unavailable",
    );
    expect(await normal.claimOriginalCompletion(scope(r), reference(r, Date.now() - 1800001))).toBe(
      "unavailable",
    );
    const [row] =
      await sql`SELECT content_sha256 FROM documents.native_resume_generations WHERE id=${original.identity.generationId}`;
    expect(row?.content_sha256).toBeNull();
  });
  it("claims original completion once, publishes scalar ready metadata and never renews it", async () => {
    const { s, r } = await bound(),
      ref = reference(r);
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("claimed");
    expect(await s.readAllocation(ref)).toBeNull();
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("already_completed");
    expect(
      await s.claimOriginalCompletion(scope(r), {
        ...ref,
        completedAtMs: ref.completedAtMs + 1,
        expiresAtMs: ref.expiresAtMs + 1,
      }),
    ).toBe("unavailable");
    await s.publishReady(scope(r), ref);
    await s.publishReady(scope(r), ref);
    expect(await s.readAllocation(ref)).toBe(r.allocationId);
    expect(await s.readAllocation({ ...ref, contentSha256: "0".repeat(64) })).toBeNull();
    expect(await s.readAllocation({ ...ref, ownerUserId: uuidv7() })).toBeNull();
  });
  it("keeps completion and original task/base metadata immutable even for direct SQL writers", async () => {
    const { s, r } = await bound(),
      ref = reference(r);
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("claimed");
    await expect(
      sql`UPDATE documents.native_resume_generations SET expires_at_ms=expires_at_ms+1 WHERE id=${input.identity.generationId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`UPDATE documents.native_resume_generations SET base_version=2 WHERE id=${input.identity.generationId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM documents.native_resume_generations WHERE id=${input.identity.generationId}`,
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM documents.resume_documents WHERE id=${input.identity.baseDocumentId}`,
    ).rejects.toMatchObject({ code: "55000" });
  });
  it("holds a sealed lost-ACK launch without redispatch and permits only positive task binding recovery", async () => {
    const s = store(),
      r = await s.reserve(input);
    await s.claimLaunch(scope(r), config);
    await s.seal(input.identity.ownerUserId, input.identity.applicationId);
    await expect(s.claimLaunch(scope(r), config)).rejects.toThrow();
    await s.bindTask(scope(r), config, task);
    expect(await s.claimOriginalCompletion(scope(r), reference(r))).toBe("unavailable");
    await expect(
      s.reserve({
        ...input,
        identity: { ...input.identity, generationId: uuidv7(), version: 2 },
        previousEpochId: r.epochId,
      }),
    ).rejects.toThrow();
  });
  it("requires positive exact-task retirement before a fresh generation can reopen a sealed epoch", async () => {
    const { s, r } = await bound();
    await s.seal(input.identity.ownerUserId, input.identity.applicationId);
    const now = Date.now();
    const receipt: NativeTaskRetirementReceipt = {
      schemaVersion: 1,
      kind: "native_task_stopped",
      ...scope(r),
      clusterArn: input.deployment.clusterArn,
      taskArn: task,
      taskDefinitionArn: input.deployment.taskDefinitionArn,
      stoppedAtEpochMs: now,
      observedAtEpochMs: now,
    };
    // The wire receipt does not carry epochId.
    delete (receipt as unknown as Record<string, unknown>).epochId;
    await expect(
      s.recordRetirement({ ...receipt, taskArn: `${task.slice(0, -32)}${"0".repeat(32)}` }),
    ).rejects.toThrow();
    await s.recordRetirement(receipt);
    await s.recordRetirement(receipt);
    await expect(s.recordRetirement({ ...receipt, observedAtEpochMs: now + 1 })).rejects.toThrow();
    const fresh = await s.reserve({
      ...input,
      identity: { ...input.identity, generationId: uuidv7(), version: 2 },
      previousEpochId: r.epochId,
    });
    expect(fresh.epochId).not.toBe(r.epochId);
    expect(fresh.reference).toBeNull();
    await expect(s.reserve(input)).rejects.toThrow();
  });
  it("withdrawal after insertion rolls back the generation and its application fence", async () => {
    let checks = 0;
    const s = new PostgresNativeResumeGenerationStore(sql, ports, () => ++checks < 3);
    await expect(s.reserve(input)).rejects.toThrow();
    expect(
      await sql`SELECT id FROM documents.native_resume_generations WHERE user_id=${input.identity.ownerUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT epoch_id FROM documents.native_material_admission WHERE user_id=${input.identity.ownerUserId}`,
    ).toHaveLength(0);
  });
  it("refuses stale preparation, held source and quarantined identity before generation admission", async () => {
    await expect(
      store().reserve({ ...input, application: { ...input.application, expectedRevision: 3 } }),
    ).rejects.toThrow();
    await sql`UPDATE documents.resume_documents SET security_hold=true WHERE id=${input.identity.baseDocumentId}`;
    await expect(store().reserve(input)).rejects.toThrow();
    await sql`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${input.identity.ownerUserId}`;
    await expect(store().reserve(input)).rejects.toThrow();
  });
  it("exports original and expired-compatible scalar metadata without source content or deployment credentials", async () => {
    const { s, r } = await bound(),
      ref = reference(r);
    expect(await s.claimOriginalCompletion(scope(r), ref)).toBe("claimed");
    await s.publishReady(scope(r), ref);
    const [row] =
      await sql`SELECT documents.export_candidate_data(${input.identity.ownerUserId}::uuid) AS data`;
    const generations = row?.data.documents.nativeResumeGenerations;
    expect(generations).toHaveLength(1);
    expect(generations[0].contentSha256).toBe(ref.contentSha256);
    expect(generations[0].completedAtMs).toBe(ref.completedAtMs);
    const encoded = JSON.stringify(generations);
    for (const forbidden of [
      "synthetic.pdf",
      "arn:aws:",
      "quarantine/",
      "normalized/",
      "taskArn",
      "configurationSha256",
      "fields",
    ])
      expect(encoded).not.toContain(forbidden);
  });
});
