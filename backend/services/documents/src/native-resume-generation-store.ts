import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type { NativeResumeIdentity } from "./native-resume-session.js";
import {
  type NativeTaskAllocation,
  type NativeTaskRetirementReceipt,
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export type NativeResumeOwnerQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;
export interface NativeResumeApplicationIntent {
  ownerUserId: string;
  applicationId: string;
  canonicalJobId: string;
  expectedRevision: number;
  packetId: string;
  packetHash: string;
  jobRevision: string;
}
export interface NativeResumeReservation {
  identity: NativeResumeIdentity;
  application: NativeResumeApplicationIntent;
  normalizedSha256: string;
  previousEpochId: string | null;
  deployment: Pick<NativeTaskAllocation, "clusterArn" | "taskDefinitionArn" | "containerName">;
}
export interface NativeResumeGenerationRecord {
  reservation: Readonly<NativeResumeReservation>;
  allocationId: string;
  epochId: string;
  state: "pending" | "bound" | "retired" | "abandoned" | "launch_rejected";
  allocation: Readonly<NativeTaskAllocation> | null;
  configurationSha256: string | null;
  reference: Readonly<TemporaryMaterialReference> | null;
  ready: boolean;
}
export interface NativeResumeGenerationScope {
  ownerUserId: string;
  applicationId: string;
  generationId: string;
  allocationId: string;
  epochId: string;
}
export interface NativeResumeLegacyLaunchRejectionEvidence {
  configurationSha256: string;
  claimedAtMicros: string;
  clusterArn: string;
  taskDefinitionArn: string;
  containerName: string;
  requestId: string;
  evidenceSha256: string;
}
export interface NativeResumeGenerationOwnerPorts {
  /** Owning Applications locks the exact captured preparation intent on this transaction. */
  application(
    intent: Readonly<NativeResumeApplicationIntent>,
    query: NativeResumeOwnerQuery,
  ): Promise<void>;
  /** Owning Jobs proves the current canonical revision and exact normalized context digest. */
  job(
    intent: Readonly<NativeResumeApplicationIntent>,
    jobContextSha256: string,
    query: NativeResumeOwnerQuery,
  ): Promise<void>;
}
type Row = Record<string, unknown> & {
  id: string;
  user_id: string;
  application_id: string;
  version: number;
  base_document_id: string;
  base_version: number;
  base_sha256: string;
  normalized_sha256: string;
  job_context_sha256: string;
  canonical_job_id: string;
  job_revision: string;
  application_revision: string;
  packet_id: string;
  packet_hash: string;
  previous_epoch_id: string | null;
  stopped_at_ms: string | null;
  observed_at_ms: string | null;
  allocation_id: string;
  epoch_id: string;
  state: NativeResumeGenerationRecord["state"];
  cluster_arn: string;
  task_definition_arn: string;
  container_name: string;
  task_arn: string | null;
  configuration_sha256: string | null;
  launch_claimed_at: Date | null;
  launch_request_sha256: string | null;
  launch_rejection_request_id: string | null;
  legacy_launch_rejection_evidence_sha256: string | null;
  observation_attempted_at: Date | null;
  content_sha256: string | null;
  completed_at_ms: string | null;
  expires_at_ms: string | null;
  ready_at: Date | null;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const unavailable = () => Error("NativeResumeGenerationUnavailable");
function closed<T extends object>(value: T, keys: readonly string[]): T {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw unavailable();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw unavailable();
  }
  return Object.freeze({ ...value });
}
export function nativeResumeReservation(input: NativeResumeReservation): NativeResumeReservation {
  const fixed = closed(input, [
    "identity",
    "application",
    "normalizedSha256",
    "previousEpochId",
    "deployment",
  ]);
  const identity = closed(fixed.identity, [
    "generationId",
    "ownerUserId",
    "applicationId",
    "version",
    "baseDocumentId",
    "baseVersion",
    "baseSha256",
    "jobContextSha256",
  ]);
  const application = closed(fixed.application, [
    "ownerUserId",
    "applicationId",
    "canonicalJobId",
    "expectedRevision",
    "packetId",
    "packetHash",
    "jobRevision",
  ]);
  const deployment = closed(fixed.deployment, ["clusterArn", "taskDefinitionArn", "containerName"]);
  if (
    ![
      identity.generationId,
      identity.ownerUserId,
      identity.applicationId,
      identity.baseDocumentId,
      application.canonicalJobId,
      application.packetId,
    ].every((v) => typeof v === "string" && uuid.test(v)) ||
    ![identity.version, identity.baseVersion].every(
      (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647,
    ) ||
    !Number.isSafeInteger(application.expectedRevision) ||
    application.expectedRevision < 1 ||
    identity.ownerUserId !== application.ownerUserId ||
    identity.applicationId !== application.applicationId ||
    ![
      identity.baseSha256,
      identity.jobContextSha256,
      application.packetHash,
      application.jobRevision,
      fixed.normalizedSha256,
    ].every((v) => typeof v === "string" && hash.test(v)) ||
    (fixed.previousEpochId !== null && !uuid.test(fixed.previousEpochId))
  )
    throw unavailable();
  nativeTaskDeploymentRegion(deployment);
  return Object.freeze({ ...fixed, identity, application, deployment });
}
function record(row: Row): NativeResumeGenerationRecord {
  const identity: NativeResumeIdentity = {
    generationId: row.id,
    ownerUserId: row.user_id,
    applicationId: row.application_id,
    version: row.version,
    baseDocumentId: row.base_document_id,
    baseVersion: row.base_version,
    baseSha256: row.base_sha256,
    jobContextSha256: row.job_context_sha256,
  };
  const deployment = {
    clusterArn: row.cluster_arn,
    taskDefinitionArn: row.task_definition_arn,
    containerName: row.container_name,
  };
  const allocation =
    row.task_arn === null
      ? null
      : Object.freeze({
          ...deployment,
          allocationId: row.allocation_id,
          ownerUserId: row.user_id,
          applicationId: row.application_id,
          generationId: row.id,
          taskArn: row.task_arn,
        });
  if (allocation) nativeTaskAllocationRegion(allocation);
  const reference: TemporaryMaterialReference | null =
    row.content_sha256 === null
      ? null
      : {
          schemaVersion: 1,
          kind: "tailored_resume",
          generationId: row.id,
          ownerUserId: row.user_id,
          applicationId: row.application_id,
          version: row.version,
          contentSha256: row.content_sha256,
          completedAtMs: Number(row.completed_at_ms),
          expiresAtMs: Number(row.expires_at_ms),
        };
  if (reference && !validateTemporaryMaterialReference(reference)) throw unavailable();
  return Object.freeze({
    reservation: nativeResumeReservation({
      identity,
      application: {
        ownerUserId: row.user_id,
        applicationId: row.application_id,
        canonicalJobId: row.canonical_job_id,
        expectedRevision: Number(row.application_revision),
        packetId: row.packet_id,
        packetHash: row.packet_hash,
        jobRevision: row.job_revision,
      },
      normalizedSha256: row.normalized_sha256,
      previousEpochId: row.previous_epoch_id,
      deployment,
    }),
    allocationId: row.allocation_id,
    epochId: row.epoch_id,
    state: row.state,
    allocation,
    configurationSha256: row.configuration_sha256,
    reference: reference ? Object.freeze(reference) : null,
    ready: row.ready_at !== null,
  });
}

/** Documents proof on Applications' packet transaction. No content, nested transaction or I/O.
 * The caller locks the candidate/application first; Jobs, admission head, base and generation
 * then remain locked through the packet write. This closes seal/quarantine/job-change races. */
export async function lockNativeResumeReadyForPacket(
  intent: NativeResumeApplicationIntent,
  reference: TemporaryMaterialReference,
  query: NativeResumeOwnerQuery,
  job: NativeResumeGenerationOwnerPorts["job"],
  enabled: () => boolean = () => false,
): Promise<void> {
  try {
    if (
      !enabled() ||
      !validateTemporaryMaterialReference(reference) ||
      reference.kind !== "tailored_resume" ||
      reference.ownerUserId !== intent.ownerUserId ||
      reference.applicationId !== intent.applicationId
    )
      throw unavailable();
    const ref = Object.freeze({ ...reference }),
      expected = structuredClone(intent);
    await query`SELECT identity.require_active_candidate(${ref.ownerUserId}::uuid)`;
    const [initial] = await query<
      Row[]
    >`SELECT * FROM documents.native_resume_generations WHERE id=${ref.generationId} AND user_id=${ref.ownerUserId} AND application_id=${ref.applicationId}`;
    if (!initial || !isDeepStrictEqual(record(initial).reservation.application, expected))
      throw unavailable();
    await job(expected, initial.job_context_sha256, query);
    if (!enabled()) throw unavailable();
    await query`SELECT pg_advisory_xact_lock(hashtextextended(${`native-material:${ref.ownerUserId}:${ref.applicationId}`},0))`;
    const [head] = await query<
      Record<string, unknown>[]
    >`SELECT epoch_id FROM documents.native_material_admission WHERE user_id=${ref.ownerUserId} AND application_id=${ref.applicationId} AND epoch_id=${initial.epoch_id} AND sealed_at IS NULL FOR UPDATE`;
    const [base] = await query<
      Record<string, unknown>[]
    >`SELECT id FROM documents.resume_documents WHERE id=${initial.base_document_id} AND user_id=${ref.ownerUserId} AND version=${initial.base_version} AND sha256=${initial.base_sha256} AND normalized_sha256=${initial.normalized_sha256} AND status='parsed' AND deleted_at IS NULL AND security_hold=false FOR SHARE`;
    const [fresh] = await query<
      Row[]
    >`SELECT * FROM documents.native_resume_generations WHERE id=${ref.generationId} AND user_id=${ref.ownerUserId} AND application_id=${ref.applicationId} AND state='bound' AND ready_at IS NOT NULL AND expires_at_ms > floor(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE`;
    if (!enabled() || !head || !base || !fresh) throw unavailable();
    const current = record(fresh);
    if (
      fresh.epoch_id !== initial.epoch_id ||
      !current.allocation ||
      !current.configurationSha256 ||
      !current.reference ||
      !isDeepStrictEqual(current.reservation, record(initial).reservation) ||
      !sameTemporaryMaterialReference(ref, current.reference)
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
}

/** Private scalar owner control. Authentication and positive task observation belong to its caller.
 * No content/source objects, provider grants, RunTask, automatic retry, renewal or death assertion. */
export class PostgresNativeResumeGenerationStore {
  private readonly ports: NativeResumeGenerationOwnerPorts;
  constructor(
    private readonly sql: postgres.Sql,
    ports: NativeResumeGenerationOwnerPorts,
    private readonly enabled: () => boolean = () => false,
  ) {
    this.ports = Object.freeze({
      application: ports.application.bind(ports),
      job: ports.job.bind(ports),
    });
  }
  private check() {
    if (!this.enabled()) throw unavailable();
  }
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      this.check();
      return await run();
    } catch {
      throw unavailable();
    }
  }
  private query(tx: postgres.TransactionSql): NativeResumeOwnerQuery {
    return async <Rows extends Record<string, unknown>[]>(
      parts: TemplateStringsArray,
      ...values: unknown[]
    ) => await tx<Rows>(parts, ...(values as postgres.ParameterOrFragment<never>[]));
  }
  private async lock(tx: postgres.TransactionSql, owner: string, app: string) {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`native-material:${owner}:${app}`},0))`;
    this.check();
  }
  private scope(input: NativeResumeGenerationScope) {
    const fixed = closed(input, [
      "ownerUserId",
      "applicationId",
      "generationId",
      "allocationId",
      "epochId",
    ]);
    if (!Object.values(fixed).every((v) => typeof v === "string" && uuid.test(v)))
      throw unavailable();
    return fixed;
  }
  private async row(tx: postgres.TransactionSql, scope: NativeResumeGenerationScope): Promise<Row> {
    const [row] = await tx<
      Row[]
    >`SELECT * FROM documents.native_resume_generations WHERE id=${scope.generationId}
      AND user_id=${scope.ownerUserId} AND application_id=${scope.applicationId} AND allocation_id=${scope.allocationId} AND epoch_id=${scope.epochId}`;
    if (!row) throw unavailable();
    return row;
  }
  private async active(tx: postgres.TransactionSql, row: Row, preparation: boolean) {
    const original = record(row);
    await tx`SELECT identity.require_active_candidate(${row.user_id}::uuid)`;
    if (preparation) await this.ports.application(original.reservation.application, this.query(tx));
    await this.ports.job(original.reservation.application, row.job_context_sha256, this.query(tx));
    await this.lock(tx, row.user_id, row.application_id);
    const [head] =
      await tx`SELECT epoch_id FROM documents.native_material_admission WHERE user_id=${row.user_id}
      AND application_id=${row.application_id} AND epoch_id=${row.epoch_id} AND sealed_at IS NULL FOR UPDATE`;
    const [base] =
      await tx`SELECT id FROM documents.resume_documents WHERE id=${row.base_document_id} AND user_id=${row.user_id}
      AND version=${row.base_version} AND sha256=${row.base_sha256} AND normalized_sha256=${row.normalized_sha256}
      AND status='parsed' AND deleted_at IS NULL AND security_hold=false FOR SHARE`;
    this.check();
    const [fresh] = await tx<
      Row[]
    >`SELECT * FROM documents.native_resume_generations WHERE id=${row.id} AND (expires_at_ms IS NULL OR expires_at_ms > floor(extract(epoch FROM clock_timestamp())*1000)::bigint) FOR UPDATE`;
    if (
      !head ||
      !base ||
      !fresh ||
      ["retired", "abandoned", "launch_rejected"].includes(fresh.state)
    )
      throw unavailable();
    return fresh;
  }
  /** Capture a queued Applications request once, before durable dispatch. Replay loads the
   * original source selection; uploading a newer base never changes that generation's input. */
  async reserveRequest(input: {
    generationId: string;
    application: NativeResumeApplicationIntent;
    jobContextSha256: string;
    deployment: NativeResumeReservation["deployment"];
  }): Promise<NativeResumeGenerationRecord | null> {
    return this.guarded(async () => {
      const fixed = structuredClone(input);
      if (!uuid.test(fixed.generationId) || !hash.test(fixed.jobContextSha256)) throw unavailable();
      const captured = await this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${fixed.application.ownerUserId}::uuid)`;
        await this.ports.application(fixed.application, this.query(tx));
        await this.ports.job(fixed.application, fixed.jobContextSha256, this.query(tx));
        await this.lock(tx, fixed.application.ownerUserId, fixed.application.applicationId);
        const [original] = await tx<
          Row[]
        >`SELECT * FROM documents.native_resume_generations WHERE id=${fixed.generationId}`;
        if (original) {
          const saved = record(original).reservation;
          if (
            !isDeepStrictEqual(saved.application, fixed.application) ||
            !isDeepStrictEqual(saved.deployment, fixed.deployment) ||
            saved.identity.jobContextSha256 !== fixed.jobContextSha256
          )
            throw unavailable();
          return saved;
        }
        const [base] = await tx<
          Array<{ id: string; version: number; sha256: string; normalized_sha256: string }>
        >`
          SELECT id,version,sha256,normalized_sha256 FROM documents.resume_documents
          WHERE user_id=${fixed.application.ownerUserId} AND status='parsed' AND deleted_at IS NULL
            AND security_hold=false AND normalized_object_key IS NOT NULL AND normalized_object_version IS NOT NULL
            AND normalized_sha256 IS NOT NULL AND parser_version IS NOT NULL
          ORDER BY updated_at DESC,id DESC LIMIT 1 FOR SHARE`;
        if (!base) return null;
        const [previous] = await tx<Array<{ epoch_id: string; sealed_at: Date | null }>>`
          SELECT epoch_id,sealed_at FROM documents.native_material_admission
          WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId} FOR UPDATE`;
        let previousEpochId = previous?.sealed_at ? previous.epoch_id : null;
        if (previous && !previous.sealed_at) {
          const [settled] = await tx<Array<{ settled: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM documents.native_resume_generations
              WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
                AND epoch_id=${previous.epoch_id} AND state IN ('retired','abandoned','launch_rejected')
            ) AND NOT EXISTS (
              SELECT 1 FROM documents.native_resume_generations
              WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
                AND state NOT IN ('retired','abandoned','launch_rejected')
            ) AND NOT EXISTS (
              SELECT 1 FROM documents.native_material_allocations
              WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
                AND state NOT IN ('retired','abandoned')
            ) AS settled`;
          if (!settled?.settled) throw unavailable();
          // A new admitted request may close a positively settled epoch. Expiry alone is
          // never retirement, and existing-generation replay above cannot rotate its epoch.
          await tx`UPDATE documents.native_material_admission SET sealed_at=t.at,minimum_work_issued_at=t.at
            FROM (SELECT clock_timestamp() AS at) t
            WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}
              AND epoch_id=${previous.epoch_id} AND sealed_at IS NULL`;
          previousEpochId = previous.epoch_id;
        }
        const [version] = await tx<
          Array<{ next: number }>
        >`SELECT (coalesce(max(version),0)+1)::int AS next
          FROM documents.native_resume_generations WHERE user_id=${fixed.application.ownerUserId} AND application_id=${fixed.application.applicationId}`;
        return nativeResumeReservation({
          identity: {
            ownerUserId: fixed.application.ownerUserId,
            applicationId: fixed.application.applicationId,
            generationId: fixed.generationId,
            version: version?.next ?? 1,
            baseDocumentId: base.id,
            baseVersion: base.version,
            baseSha256: base.sha256,
            jobContextSha256: fixed.jobContextSha256,
          },
          application: fixed.application,
          normalizedSha256: base.normalized_sha256,
          previousEpochId,
          deployment: fixed.deployment,
        });
      });
      this.check();
      if (!captured) return null;
      // reserve repeats owner admission under its commit locks. Any race fails closed.
      return this.reserve(captured);
    });
  }
  async reserve(input: NativeResumeReservation): Promise<NativeResumeGenerationRecord> {
    return this.guarded(async () => {
      const fixed = nativeResumeReservation(input),
        id = fixed.identity,
        app = fixed.application,
        deployment = fixed.deployment;
      return this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${id.ownerUserId}::uuid)`;
        await this.ports.application(app, this.query(tx));
        await this.ports.job(app, id.jobContextSha256, this.query(tx));
        await this.lock(tx, id.ownerUserId, id.applicationId);
        const [existing] = await tx<
          Row[]
        >`SELECT * FROM documents.native_resume_generations WHERE id=${id.generationId} FOR UPDATE`;
        if (existing) {
          const saved = record(existing).reservation;
          if (!isDeepStrictEqual(saved, fixed)) throw unavailable();
          await this.active(tx, existing, false);
          return record(existing);
        }
        const [head] = await tx<
          Array<{ epoch_id: string; sealed_at: Date | null }>
        >`SELECT epoch_id,sealed_at FROM documents.native_material_admission
          WHERE user_id=${id.ownerUserId} AND application_id=${id.applicationId} FOR UPDATE`;
        let epoch = head?.epoch_id ?? uuidv7();
        if (!head) {
          if (fixed.previousEpochId !== null) throw unavailable();
          epoch = uuidv7();
          await tx`INSERT INTO documents.native_material_admission(user_id,application_id,epoch_id) VALUES (${id.ownerUserId},${id.applicationId},${epoch})`;
        } else if (head.sealed_at) {
          if (head.epoch_id !== fixed.previousEpochId) throw unavailable();
          epoch = uuidv7();
          await tx`UPDATE documents.native_material_admission SET epoch_id=${epoch},sealed_at=NULL WHERE user_id=${id.ownerUserId} AND application_id=${id.applicationId}`;
        } else if (fixed.previousEpochId !== null) throw unavailable();
        const [row] = await tx<
          Row[]
        >`INSERT INTO documents.native_resume_generations(id,user_id,application_id,version,base_document_id,base_version,base_sha256,
          normalized_sha256,job_context_sha256,canonical_job_id,job_revision,application_revision,packet_id,packet_hash,allocation_id,epoch_id,previous_epoch_id,cluster_arn,task_definition_arn,container_name)
          VALUES (${id.generationId},${id.ownerUserId},${id.applicationId},${id.version},${id.baseDocumentId},${id.baseVersion},${id.baseSha256},${fixed.normalizedSha256},
            ${id.jobContextSha256},${app.canonicalJobId},${app.jobRevision},${app.expectedRevision},${app.packetId},${app.packetHash},${uuidv7()},${epoch},${fixed.previousEpochId},${deployment.clusterArn},${deployment.taskDefinitionArn},${deployment.containerName}) RETURNING *`;
        this.check();
        if (!row) throw unavailable();
        return record(row);
      });
    });
  }
  async claimLaunch(
    input: NativeResumeGenerationScope,
    configurationSha256: string,
    requestSha256?: string,
  ) {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (typeof configurationSha256 !== "string" || !hash.test(configurationSha256))
        throw unavailable();
      if (requestSha256 !== undefined && !hash.test(requestSha256)) throw unavailable();
      return this.sql.begin(async (tx) => {
        let row = await this.row(tx, scope);
        row = await this.active(tx, row, true);
        if (row.launch_claimed_at) {
          if (
            row.configuration_sha256 !== configurationSha256 ||
            (requestSha256 !== undefined && row.launch_request_sha256 !== requestSha256)
          )
            throw unavailable();
          return { claimed: false, record: record(row) };
        }
        if (row.state !== "pending") throw unavailable();
        const [claimed] = await tx<
          Row[]
        >`UPDATE documents.native_resume_generations SET launch_claimed_at=clock_timestamp(),configuration_sha256=${configurationSha256},launch_request_sha256=${requestSha256 ?? null} WHERE id=${row.id} RETURNING *`;
        this.check();
        if (!claimed) throw unavailable();
        return { claimed: true, record: record(claimed) };
      });
    });
  }
  /** Trusted original one-send launcher only. This records a definitive rejection, never
   * task death. Unknown ACKs and legacy claims without a pre-dispatch request digest stay pending. */
  async recordLaunchRejection(
    input: NativeResumeGenerationScope,
    configurationSha256: string,
    requestSha256: string,
    requestId: string,
  ): Promise<void> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (
        !hash.test(configurationSha256) ||
        !hash.test(requestSha256) ||
        typeof requestId !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(requestId)
      )
        throw unavailable();
      await this.sql.begin(async (tx) => {
        await this.lock(tx, scope.ownerUserId, scope.applicationId);
        const row = await this.row(tx, scope);
        if (
          !row.launch_claimed_at ||
          row.configuration_sha256 !== configurationSha256 ||
          row.launch_request_sha256 !== requestSha256 ||
          row.task_arn !== null ||
          row.content_sha256 !== null
        )
          throw unavailable();
        if (row.state === "launch_rejected") {
          if (row.launch_rejection_request_id !== requestId) throw unavailable();
          return;
        }
        if (row.state !== "pending") throw unavailable();
        await tx`UPDATE documents.native_resume_generations SET state='launch_rejected',
          launch_rejection_request_id=${requestId},launch_rejected_at=clock_timestamp() WHERE id=${row.id}`;
        this.check();
      });
    });
  }
  /** Trusted private recovery only, after fresh authoritative original AWS rejection and
   * sole-send/input/configuration binding. The evidence digest is not a missing request digest.
   * Seal only the original head atomically; never launch, bind, fabricate task death or backfill. */
  async recordLegacyLaunchRejection(
    input: NativeResumeGenerationScope,
    evidence: NativeResumeLegacyLaunchRejectionEvidence,
  ): Promise<void> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      const fixed = closed(evidence, [
        "configurationSha256",
        "claimedAtMicros",
        "clusterArn",
        "taskDefinitionArn",
        "containerName",
        "requestId",
        "evidenceSha256",
      ]);
      if (
        typeof fixed.configurationSha256 !== "string" ||
        !hash.test(fixed.configurationSha256) ||
        typeof fixed.evidenceSha256 !== "string" ||
        !hash.test(fixed.evidenceSha256) ||
        typeof fixed.claimedAtMicros !== "string" ||
        !/^[1-9][0-9]{15,16}$/u.test(fixed.claimedAtMicros) ||
        typeof fixed.requestId !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(fixed.requestId) ||
        ![fixed.clusterArn, fixed.taskDefinitionArn, fixed.containerName].every(
          (value) => typeof value === "string",
        )
      )
        throw unavailable();
      nativeTaskDeploymentRegion(fixed);
      await this.sql.begin(async (tx) => {
        await this.lock(tx, scope.ownerUserId, scope.applicationId);
        const [head] = await tx<Array<{ epoch_id: string; sealed_at: Date | null }>>`
          SELECT epoch_id,sealed_at FROM documents.native_material_admission
          WHERE user_id=${scope.ownerUserId} AND application_id=${scope.applicationId} FOR UPDATE`;
        const [row] = await tx<Array<Row & { claimed_at_micros: string | null }>>`
          SELECT *,((extract(epoch FROM launch_claimed_at)*1000000)::bigint)::text AS claimed_at_micros
          FROM documents.native_resume_generations WHERE id=${scope.generationId}
            AND user_id=${scope.ownerUserId} AND application_id=${scope.applicationId}
            AND allocation_id=${scope.allocationId} AND epoch_id=${scope.epochId} FOR UPDATE`;
        if (
          !head ||
          head.epoch_id !== scope.epochId ||
          !row ||
          !row.launch_claimed_at ||
          row.claimed_at_micros !== fixed.claimedAtMicros ||
          row.configuration_sha256 !== fixed.configurationSha256 ||
          row.cluster_arn !== fixed.clusterArn ||
          row.task_definition_arn !== fixed.taskDefinitionArn ||
          row.container_name !== fixed.containerName ||
          row.launch_request_sha256 !== null ||
          row.task_arn !== null ||
          row.content_sha256 !== null ||
          row.completed_at_ms !== null ||
          row.expires_at_ms !== null ||
          row.ready_at !== null ||
          row.observation_attempted_at !== null
        )
          throw unavailable();
        if (row.state === "launch_rejected") {
          if (
            head.sealed_at === null ||
            row.launch_rejection_request_id !== fixed.requestId ||
            row.legacy_launch_rejection_evidence_sha256 !== fixed.evidenceSha256
          )
            throw unavailable();
          return;
        }
        if (row.state !== "pending" || row.legacy_launch_rejection_evidence_sha256 !== null)
          throw unavailable();
        await tx`UPDATE documents.native_material_admission SET sealed_at=t.at,minimum_work_issued_at=t.at
          FROM (SELECT clock_timestamp() AS at) t WHERE user_id=${scope.ownerUserId}
            AND application_id=${scope.applicationId} AND epoch_id=${scope.epochId} AND sealed_at IS NULL`;
        await tx`UPDATE documents.native_resume_generations SET state='launch_rejected',
          launch_rejection_request_id=${fixed.requestId},launch_rejected_at=clock_timestamp(),
          legacy_launch_rejection_evidence_sha256=${fixed.evidenceSha256} WHERE id=${row.id}`;
        this.check();
      });
    });
  }
  /** Positive RunTask recovery may bind after seal/quarantine; it grants no generation or read. */
  async readLaunch(
    input: NativeResumeGenerationScope,
    configurationSha256: string,
  ): Promise<NativeResumeGenerationRecord> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (typeof configurationSha256 !== "string" || !hash.test(configurationSha256))
        throw unavailable();
      return this.sql.begin(async (tx) => {
        const row = await this.row(tx, scope);
        if (!row.launch_claimed_at || row.configuration_sha256 !== configurationSha256)
          throw unavailable();
        this.check();
        return record(row);
      });
    });
  }

  /** Fresh preparation admission for route capture/creation. Unlike recovery readLaunch,
   * this requires the current candidate, original application intent, job/source and epoch.
   * No locks survive the return; callers must recheck after remote address observation. */
  async readRouteAdmission(
    input: NativeResumeGenerationScope,
    configurationSha256: string,
  ): Promise<NativeResumeGenerationRecord | null> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (typeof configurationSha256 !== "string" || !hash.test(configurationSha256))
        throw unavailable();
      return this.sql.begin(async (tx) => {
        let row = await this.row(tx, scope);
        if (!row.launch_claimed_at || row.configuration_sha256 !== configurationSha256)
          throw unavailable();
        row = await this.active(tx, row, true);
        if (row.state !== "bound" || row.ready_at === null || row.content_sha256 === null)
          return null;
        const value = record(row);
        if (!value.reference || !value.allocation) throw unavailable();
        this.check();
        return value;
      });
    });
  }
  /** Rotate a bounded original-configuration batch before remote I/O. A lost invocation
   * only delays another attempt; these timestamps never prove task termination. */
  async claimObservations(
    configurationSha256: string,
    limit = 2,
  ): Promise<NativeResumeGenerationScope[]> {
    return this.guarded(async () => {
      if (!hash.test(configurationSha256) || !Number.isSafeInteger(limit) || limit < 1 || limit > 2)
        throw unavailable();
      return this.sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout='2s'`;
        await tx`SET LOCAL statement_timeout='5s'`;
        const rows = await tx<Row[]>`WITH candidates AS (
          SELECT id FROM documents.native_resume_generations
          WHERE state='bound' AND configuration_sha256=${configurationSha256}
            AND (observation_attempted_at IS NULL OR observation_attempted_at <= clock_timestamp() - interval '60 seconds')
          ORDER BY observation_attempted_at NULLS FIRST, id
          LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) UPDATE documents.native_resume_generations g SET observation_attempted_at=clock_timestamp()
          FROM candidates c WHERE g.id=c.id RETURNING g.*`;
        this.check();
        return rows.map((row) =>
          this.scope({
            ownerUserId: row.user_id,
            applicationId: row.application_id,
            generationId: row.id,
            allocationId: row.allocation_id,
            epochId: row.epoch_id,
          }),
        );
      });
    });
  }

  /** Surrounding authenticated task RPC pins these exact scalars before calling the owner port.
   * Current packet authorization remains the transport's separate before/after read boundary. */
  async checkTaskAdmission(
    input: NativeResumeGenerationScope,
    allocation: NativeTaskAllocation,
    configurationSha256: string,
  ): Promise<void> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      const fixed = closed(allocation, [
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "containerName",
      ]);
      nativeTaskAllocationRegion(fixed);
      if (typeof configurationSha256 !== "string" || !hash.test(configurationSha256))
        throw unavailable();
      await this.sql.begin(async (tx) => {
        let row = await this.row(tx, scope);
        row = await this.active(tx, row, row.ready_at === null);
        if (
          row.state !== "bound" ||
          row.configuration_sha256 !== configurationSha256 ||
          !isDeepStrictEqual(record(row).allocation, fixed)
        )
          throw unavailable();
        this.check();
      });
    });
  }

  async bindTask(
    input: NativeResumeGenerationScope,
    configurationSha256: string,
    taskArn: string,
  ): Promise<NativeResumeGenerationRecord> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (typeof configurationSha256 !== "string" || !hash.test(configurationSha256))
        throw unavailable();
      return this.sql.begin(async (tx) => {
        await this.lock(tx, scope.ownerUserId, scope.applicationId);
        const row = await this.row(tx, scope),
          original = record(row);
        nativeTaskAllocationRegion({ ...original.reservation.deployment, ...scope, taskArn });
        if (
          !row.launch_claimed_at ||
          row.configuration_sha256 !== configurationSha256 ||
          ["retired", "abandoned", "launch_rejected"].includes(row.state)
        )
          throw unavailable();
        if (row.task_arn !== null) {
          if (row.task_arn !== taskArn) throw unavailable();
          return original;
        }
        const [bound] = await tx<
          Row[]
        >`UPDATE documents.native_resume_generations SET task_arn=${taskArn},bound_at=clock_timestamp(),state='bound' WHERE id=${row.id} RETURNING *`;
        this.check();
        if (!bound) throw unavailable();
        return record(bound);
      });
    });
  }
  async claimOriginalCompletion(
    input: NativeResumeGenerationScope,
    reference: TemporaryMaterialReference,
  ): Promise<"claimed" | "already_completed" | "unavailable"> {
    try {
      return await this.guarded(async () => {
        const scope = this.scope(input);
        if (!validateTemporaryMaterialReference(reference) || reference.kind !== "tailored_resume")
          throw unavailable();
        const ref = Object.freeze({ ...reference });
        return this.sql.begin(async (tx) => {
          let row = await this.row(tx, scope);
          row = await this.active(tx, row, true);
          if (
            row.state !== "bound" ||
            ref.generationId !== row.id ||
            ref.ownerUserId !== row.user_id ||
            ref.applicationId !== row.application_id ||
            ref.version !== row.version
          )
            throw unavailable();
          if (row.content_sha256 !== null) {
            if (
              !record(row).reference ||
              !sameTemporaryMaterialReference(
                record(row).reference as TemporaryMaterialReference,
                ref,
              )
            )
              throw unavailable();
            const [fresh] =
              await tx`SELECT ${ref.expiresAtMs} > floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS fresh`;
            if (!fresh?.fresh) throw unavailable();
            return "already_completed" as const;
          }
          await tx`UPDATE documents.native_resume_generations SET content_sha256=${ref.contentSha256},completed_at_ms=${ref.completedAtMs},expires_at_ms=${ref.expiresAtMs} WHERE id=${row.id}`;
          this.check();
          return "claimed" as const;
        });
      });
    } catch {
      return "unavailable";
    }
  }
  /** Caller publishes only after actual PDF/DOCX verification; the ledger never reads content. */
  async publishReady(
    input: NativeResumeGenerationScope,
    reference: TemporaryMaterialReference,
  ): Promise<void> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      if (!validateTemporaryMaterialReference(reference) || reference.kind !== "tailored_resume")
        throw unavailable();
      const ref = Object.freeze({ ...reference });
      await this.sql.begin(async (tx) => {
        let row = await this.row(tx, scope);
        row = await this.active(tx, row, true);
        if (
          !record(row).reference ||
          !sameTemporaryMaterialReference(
            record(row).reference as TemporaryMaterialReference,
            ref,
          ) ||
          row.state !== "bound"
        )
          throw unavailable();
        const [fresh] =
          await tx`SELECT ${ref.expiresAtMs} > floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS fresh`;
        if (!fresh?.fresh) throw unavailable();
        if (row.ready_at === null)
          await tx`UPDATE documents.native_resume_generations SET ready_at=clock_timestamp() WHERE id=${row.id}`;
        this.check();
      });
    });
  }
  /** Caller must hold current packet admission around this lookup; original preparation revision
   * is not reused as current packet authority. No regeneration, source lookup or renewed clock. */
  async readAllocation(reference: TemporaryMaterialReference): Promise<string | null> {
    return this.guarded(async () => {
      if (!validateTemporaryMaterialReference(reference) || reference.kind !== "tailored_resume")
        throw unavailable();
      const ref = Object.freeze({ ...reference });
      return this.sql.begin(async (tx) => {
        let [row] = await tx<
          Row[]
        >`SELECT * FROM documents.native_resume_generations WHERE id=${ref.generationId} AND user_id=${ref.ownerUserId} AND application_id=${ref.applicationId}`;
        if (!row) return null;
        row = await this.active(tx, row, false);
        if (
          !row.ready_at ||
          row.state !== "bound" ||
          !record(row).reference ||
          !sameTemporaryMaterialReference(record(row).reference as TemporaryMaterialReference, ref)
        )
          return null;
        const [fresh] =
          await tx`SELECT ${ref.expiresAtMs} > floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS fresh`;
        this.check();
        return fresh?.fresh ? row.allocation_id : null;
      });
    });
  }
  async seal(ownerUserId: string, applicationId: string): Promise<void> {
    return this.guarded(async () => {
      if (!uuid.test(ownerUserId) || !uuid.test(applicationId)) throw unavailable();
      await this.sql.begin(async (tx) => {
        await this.lock(tx, ownerUserId, applicationId);
        await tx`UPDATE documents.native_material_admission SET sealed_at=t.at,minimum_work_issued_at=t.at
          FROM (SELECT clock_timestamp() AS at) t WHERE user_id=${ownerUserId} AND application_id=${applicationId} AND sealed_at IS NULL`;
        this.check();
      });
    });
  }
  /** A reserved row can be abandoned only before any durable launch claim was issued.
   * This is known no-launch cancellation, not a stopped-task receipt or timeout fallback. */
  async cancelBeforeLaunch(input: NativeResumeGenerationScope): Promise<void> {
    return this.guarded(async () => {
      const scope = this.scope(input);
      await this.sql.begin(async (tx) => {
        await this.lock(tx, scope.ownerUserId, scope.applicationId);
        const row = await this.row(tx, scope);
        if (row.state === "abandoned") return;
        if (row.state !== "pending" || row.launch_claimed_at !== null) throw unavailable();
        await tx`UPDATE documents.native_resume_generations SET state='abandoned' WHERE id=${row.id}`;
        this.check();
      });
    });
  }
  /** Only the trusted separate task observer supplies a positive exact-task receipt. */
  async recordRetirement(receipt: NativeTaskRetirementReceipt): Promise<void> {
    return this.guarded(async () => {
      const fixed = closed(receipt, [
        "schemaVersion",
        "kind",
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "stoppedAtEpochMs",
        "observedAtEpochMs",
      ]);
      if (
        ![fixed.allocationId, fixed.ownerUserId, fixed.applicationId, fixed.generationId].every(
          (v) => typeof v === "string" && uuid.test(v),
        ) ||
        fixed.schemaVersion !== 1 ||
        fixed.kind !== "native_task_stopped" ||
        ![fixed.stoppedAtEpochMs, fixed.observedAtEpochMs].every(
          (v) => Number.isSafeInteger(v) && v > 0,
        ) ||
        fixed.observedAtEpochMs < fixed.stoppedAtEpochMs
      )
        throw unavailable();
      await this.sql.begin(async (tx) => {
        await this.lock(tx, fixed.ownerUserId, fixed.applicationId);
        const [row] = await tx<
          Row[]
        >`SELECT * FROM documents.native_resume_generations WHERE id=${fixed.generationId} AND user_id=${fixed.ownerUserId}
          AND application_id=${fixed.applicationId} AND allocation_id=${fixed.allocationId} FOR UPDATE`;
        if (
          !row ||
          row.task_arn !== fixed.taskArn ||
          row.cluster_arn !== fixed.clusterArn ||
          row.task_definition_arn !== fixed.taskDefinitionArn
        )
          throw unavailable();
        if (row.state === "retired") {
          if (
            Number(row.stopped_at_ms) !== fixed.stoppedAtEpochMs ||
            Number(row.observed_at_ms) !== fixed.observedAtEpochMs
          )
            throw unavailable();
          return;
        }
        await tx`UPDATE documents.native_resume_generations SET state='retired',stopped_at_ms=${fixed.stoppedAtEpochMs},observed_at_ms=${fixed.observedAtEpochMs} WHERE id=${row.id}`;
        this.check();
      });
    });
  }
}
