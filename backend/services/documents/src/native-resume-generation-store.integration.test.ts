import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresCoverLetterStore } from "./cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import { PostgresNativeMaterialRegistry } from "./native-material-registry.js";
import {
  type NativeResumeGenerationRecord,
  type NativeResumeOwnerQuery,
  type NativeResumeReservation,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import type { NativeTaskRetirementReceipt } from "./native-task-allocation.js";
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
