import { createHash } from "node:crypto";

/** PRIVATE ports: these values must never be logged or returned as a public receipt. */
export interface CompletionRepairTag {
  readonly Key: "state" | "completed-at";
  readonly Value: string;
}

export interface CompletionRepairTarget {
  readonly bucketName: string;
  readonly expectedBucketOwner: string;
  readonly key: string;
  readonly versionId: string;
}

export interface CompletionRepairImmutable {
  readonly bodySha256: string;
  readonly checksumSha256: string;
  readonly metadataSha256: string;
  readonly encryptionSha256: string;
  readonly retentionSha256: string;
  readonly versionInventorySha256: string;
  readonly etag: string;
  readonly contentLength: number;
  readonly lastModified: string;
}

/** Minimal private output of a separately trusted diagnostic provenance verifier. */
export interface HistoricalCompletionRepairCandidate
  extends CompletionRepairTarget,
    CompletionRepairImmutable {
  readonly oldTagSet: readonly CompletionRepairTag[];
  readonly correctedCompletedAt: string;
  readonly evidenceSha256: string;
  readonly sourceSha: string;
}

/** The read-only adapter must independently derive every fingerprint from real exact-version reads. */
export interface CompletionRepairObservation
  extends CompletionRepairTarget,
    CompletionRepairImmutable {
  readonly tagSet: readonly CompletionRepairTag[];
}

/**
 * A separately trusted verifier binds actual target-specific exclusion evidence, not a caller
 * boolean. Old writers/terminal obligations must be retired; a resumed corrected writer may
 * remain only when its persisted completion equals correctedCompletedAt. No broad pause implied.
 */
export interface CompletionRepairWriterProof {
  readonly targetScopeSha256: string;
  readonly sourceSha: string;
  readonly proofSha256: string;
  readonly conflictingWritersExcluded: true;
  readonly correctedCompletedAt: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface CompletionRepairAttempt {
  readonly schemaVersion: 1;
  readonly kind: "historical-completion-tag-repair-attempt";
  readonly scopeSha256: string;
  readonly decisionSha256: string;
  readonly preimage: CompletionRepairObservation;
  readonly intended: CompletionRepairObservation;
  readonly writerRetirement: CompletionRepairWriterProof;
  readonly attemptedAt: string;
}

export interface CompletionRepairJournal {
  /** Same durable object-version scope on every process/run; absence is not a new random path. */
  read(scopeSha256: string): Promise<unknown | undefined>;
  /** Atomic create-if-absent, private, durable before true resolves; never replace an existing file. */
  createOnce(scopeSha256: string, attempt: CompletionRepairAttempt): Promise<boolean>;
}

type PutInput = {
  Bucket: string;
  ExpectedBucketOwner: string;
  Key: string;
  VersionId: string;
  ChecksumAlgorithm: "SHA256";
  Tagging: { TagSet: { Key: string; Value: string }[] };
};

export const COMPLETION_REPAIR_WRITE_TIMEOUT_MS = 15_000;
export const COMPLETION_REPAIR_S3_CONFIGURATION = Object.freeze({
  region: "us-east-2",
  endpoint: "https://s3.us-east-2.amazonaws.com",
  maxAttempts: 1,
  useFipsEndpoint: false,
  useDualstackEndpoint: false,
  useAccelerateEndpoint: false,
  forcePathStyle: true,
} as const);

/**
 * Composition passes installed SDK classes and authenticates the exact SSO/caller separately.
 * No existing/retrying client or ambient service endpoint is accepted.
 */
export interface CompletionRepairSdk {
  S3Client: new (
    configuration: typeof COMPLETION_REPAIR_S3_CONFIGURATION,
  ) => {
    send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
    destroy(): void;
  };
  PutObjectTaggingCommand: new (input: PutInput) => unknown;
}

export type CompletionRepairReason =
  | "verified"
  | "decision_rejected"
  | "journal_rejected"
  | "journal_ambiguous"
  | "writer_exclusion_unproven"
  | "precondition_changed"
  | "late_precondition_changed"
  | "readback_unavailable"
  | "readback_changed"
  | "attempt_unresolved"
  | "internal_rejected";

export interface CompletionRepairResult {
  readonly schemaVersion: 1;
  readonly outcome:
    | "already_correct"
    | "repaired"
    | "recovered_after_ambiguous_write"
    | "verified_prior_attempt"
    | "refused"
    | "unresolved";
  readonly reason: CompletionRepairReason;
  readonly writeAttemptsThisCall: 0 | 1;
  /** Describes evidence, not an assertion that an ambiguous request did not execute. */
  readonly effect: "none_attempted_this_call" | "intended_state_verified" | "unknown";
}

export interface CompletionRepairPorts {
  /**
   * Explicit trust port, never a JSON cast or default schema-only decoder. Within one process it
   * may use the diagnostic's private brand. Across a protected Lambda receipt it must verify the
   * exact invocation/version/config/source/receipt hash before returning this minimal candidate.
   */
  readHistoricalCompletionRepairCandidate(result: unknown): unknown | undefined;
  readExactVersion(target: CompletionRepairTarget): Promise<unknown>;
  readWriterExclusion(
    target: CompletionRepairTarget,
    sourceSha: string,
    correctedCompletedAt: string,
  ): Promise<unknown>;
  journal: CompletionRepairJournal;
  sdk: CompletionRepairSdk;
  now(): Date;
  /** Receives closed aggregate data only; errors from the logger are swallowed. */
  report?(result: CompletionRepairResult): void | Promise<void>;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const KEY =
  /^candidate-deletion-recovery\/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/u;
const targetKeys = ["bucketName", "expectedBucketOwner", "key", "versionId"];
const immutableKeys = [
  "bodySha256",
  "checksumSha256",
  "metadataSha256",
  "encryptionSha256",
  "retentionSha256",
  "versionInventorySha256",
  "etag",
  "contentLength",
  "lastModified",
];
const proofKeys = [
  "targetScopeSha256",
  "sourceSha",
  "proofSha256",
  "conflictingWritersExcluded",
  "correctedCompletedAt",
  "observedAt",
  "expiresAt",
];

function reject(): never {
  throw new Error("HistoricalCompletionTagRepairRejected");
}

/** Own data properties only. Hostile accessors/proxies cannot put their messages in diagnostics. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.keys(descriptors).sort().join("\n") !== [...keys].sort().join("\n") ||
    Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value"))
  )
    reject();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) reject();
  return value;
}

function iso(value: unknown): string {
  if (typeof value !== "string") reject();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) reject();
  return value;
}

function clock(ports: CompletionRepairPorts): string {
  const value = ports.now();
  if (!(value instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(value))) reject();
  return Date.prototype.toISOString.call(value);
}

function target(value: Record<string, unknown>): CompletionRepairTarget {
  const bucketName = text(value.bucketName, /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u);
  if (bucketName.includes("..") || /^\d+\.\d+\.\d+\.\d+$/u.test(bucketName)) reject();
  const versionId = text(value.versionId, /^[\x21-\x7e]{1,1024}$/u);
  if (versionId === "null") reject();
  return Object.freeze({
    bucketName,
    expectedBucketOwner: text(value.expectedBucketOwner, /^\d{12}$/u),
    key: text(value.key, KEY),
    versionId,
  });
}

function immutable(value: Record<string, unknown>): CompletionRepairImmutable {
  const bodySha256 = text(value.bodySha256, SHA256);
  const checksumSha256 = text(value.checksumSha256, SHA256);
  if (bodySha256 !== checksumSha256) reject();
  if (
    !Number.isSafeInteger(value.contentLength) ||
    (value.contentLength as number) < 1 ||
    (value.contentLength as number) > 16_384
  )
    reject();
  return Object.freeze({
    bodySha256,
    checksumSha256,
    metadataSha256: text(value.metadataSha256, SHA256),
    encryptionSha256: text(value.encryptionSha256, SHA256),
    retentionSha256: text(value.retentionSha256, SHA256),
    versionInventorySha256: text(value.versionInventorySha256, SHA256),
    etag: text(value.etag, /^"[^"\r\n]{1,254}"$/u),
    contentLength: value.contentLength as number,
    lastModified: iso(value.lastModified),
  });
}

function tags(value: unknown): readonly CompletionRepairTag[] {
  if (!Array.isArray(value) || value.length !== 2) reject();
  const parsed = value
    .map((tag): CompletionRepairTag => {
      const row = record(tag, ["Key", "Value"]);
      if (row.Key === "state" && row.Value === "completed")
        return Object.freeze({ Key: "state", Value: "completed" });
      if (row.Key === "completed-at")
        return Object.freeze({ Key: "completed-at", Value: iso(row.Value) });
      return reject();
    })
    .sort((left, right) => (left.Key < right.Key ? -1 : left.Key > right.Key ? 1 : 0));
  if (parsed[0]?.Key !== "completed-at" || parsed[1]?.Key !== "state") reject();
  return Object.freeze(parsed);
}

function candidate(value: unknown): HistoricalCompletionRepairCandidate {
  const row = record(value, [
    ...targetKeys,
    ...immutableKeys,
    "oldTagSet",
    "correctedCompletedAt",
    "evidenceSha256",
    "sourceSha",
  ]);
  return Object.freeze({
    ...target(row),
    ...immutable(row),
    oldTagSet: tags(row.oldTagSet),
    correctedCompletedAt: iso(row.correctedCompletedAt),
    evidenceSha256: text(row.evidenceSha256, SHA256),
    sourceSha: text(row.sourceSha, SOURCE_SHA),
  });
}

function observation(value: unknown): CompletionRepairObservation {
  const row = record(value, [...targetKeys, ...immutableKeys, "tagSet"]);
  return Object.freeze({ ...target(row), ...immutable(row), tagSet: tags(row.tagSet) });
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update("historical-completion-tag-repair-v1\n")
    .update(JSON.stringify(value))
    .digest("hex");
}

/** Private target correlation across source revisions/run directories; never emit in aggregates. */
export function completionRepairScopeSha256(value: CompletionRepairTarget): string {
  return digest(target(record(value, targetKeys)));
}

function expectedObservation(
  value: HistoricalCompletionRepairCandidate,
  intended: boolean,
): CompletionRepairObservation {
  return Object.freeze({
    ...target(value as unknown as Record<string, unknown>),
    ...immutable(value as unknown as Record<string, unknown>),
    tagSet: intended
      ? tags([
          { Key: "state", Value: "completed" },
          { Key: "completed-at", Value: value.correctedCompletedAt },
        ])
      : value.oldTagSet,
  });
}

function proof(
  value: unknown,
  scope: string,
  source: string,
  correctedCompletedAt: string,
  now: string,
  requireFresh: boolean,
): CompletionRepairWriterProof {
  const row = record(value, proofKeys);
  if (
    row.targetScopeSha256 !== scope ||
    row.sourceSha !== source ||
    row.conflictingWritersExcluded !== true ||
    row.correctedCompletedAt !== correctedCompletedAt
  )
    reject();
  const observedAt = iso(row.observedAt);
  const expiresAt = iso(row.expiresAt);
  if (observedAt >= expiresAt || observedAt > now || (requireFresh && expiresAt <= now)) reject();
  return Object.freeze({
    targetScopeSha256: scope,
    sourceSha: source,
    proofSha256: text(row.proofSha256, SHA256),
    conflictingWritersExcluded: true,
    correctedCompletedAt,
    observedAt,
    expiresAt,
  });
}

function validateAttempt(
  value: unknown,
  scope: string,
  decision: HistoricalCompletionRepairCandidate,
  now: string,
): CompletionRepairAttempt {
  const row = record(value, [
    "schemaVersion",
    "kind",
    "scopeSha256",
    "decisionSha256",
    "preimage",
    "intended",
    "writerRetirement",
    "attemptedAt",
  ]);
  const attemptedAt = iso(row.attemptedAt);
  const writerRetirement = proof(
    row.writerRetirement,
    scope,
    decision.sourceSha,
    decision.correctedCompletedAt,
    now,
    false,
  );
  if (
    row.schemaVersion !== 1 ||
    row.kind !== "historical-completion-tag-repair-attempt" ||
    row.scopeSha256 !== scope ||
    row.decisionSha256 !== digest(decision) ||
    attemptedAt > now ||
    attemptedAt < writerRetirement.observedAt ||
    attemptedAt >= writerRetirement.expiresAt ||
    digest(observation(row.preimage)) !== digest(expectedObservation(decision, false)) ||
    digest(observation(row.intended)) !== digest(expectedObservation(decision, true))
  )
    reject();
  return Object.freeze({
    schemaVersion: 1,
    kind: "historical-completion-tag-repair-attempt",
    scopeSha256: scope,
    decisionSha256: digest(decision),
    preimage: observation(row.preimage),
    intended: observation(row.intended),
    writerRetirement,
    attemptedAt,
  });
}

/**
 * No SQL, bodies, credentials, retention writes, rollback, retry, or ordinary ledger writer.
 * Journal and read-only evidence ports are separately trusted composition boundaries.
 */
export function createHistoricalCompletionTagRepair(ports: CompletionRepairPorts) {
  const attemptedScopes = new Set<string>();
  return async function repair(diagnosis: unknown): Promise<CompletionRepairResult> {
    let writeAttemptsThisCall: 0 | 1 = 0;
    let priorAttempt = false;
    let stage: CompletionRepairReason = "decision_rejected";
    const finish = (
      outcome: CompletionRepairResult["outcome"],
      reason: CompletionRepairReason,
      effect: CompletionRepairResult["effect"],
    ): CompletionRepairResult => {
      const result = Object.freeze({
        schemaVersion: 1 as const,
        outcome,
        reason,
        writeAttemptsThisCall,
        effect,
      });
      try {
        void Promise.resolve(ports.report?.(result)).catch(() => undefined);
      } catch {
        /* Never log the thrown value. */
      }
      return result;
    };
    try {
      const decision = candidate(ports.readHistoricalCompletionRepairCandidate(diagnosis));
      const exactTarget = target(decision as unknown as Record<string, unknown>);
      const scope = completionRepairScopeSha256(exactTarget);
      const preimage = expectedObservation(decision, false);
      const intended = expectedObservation(decision, true);
      stage = "journal_rejected";
      const saved = await ports.journal.read(scope);
      if (saved !== undefined) {
        priorAttempt = true;
        validateAttempt(saved, scope, decision, clock(ports));
        // Prior attempts are readback-only even when the original retirement proof has expired.
        stage = "readback_unavailable";
        const current = observation(await ports.readExactVersion(exactTarget));
        return digest(current) === digest(intended)
          ? finish("verified_prior_attempt", "verified", "intended_state_verified")
          : finish("unresolved", "attempt_unresolved", "unknown");
      }
      if (attemptedScopes.has(scope)) return finish("unresolved", "journal_ambiguous", "unknown");
      stage = "writer_exclusion_unproven";
      const retired = proof(
        await ports.readWriterExclusion(
          exactTarget,
          decision.sourceSha,
          decision.correctedCompletedAt,
        ),
        scope,
        decision.sourceSha,
        decision.correctedCompletedAt,
        clock(ports),
        true,
      );
      stage = "precondition_changed";
      const before = observation(await ports.readExactVersion(exactTarget));
      if (digest(before) === digest(intended))
        return finish("already_correct", "verified", "intended_state_verified");
      if (digest(before) !== digest(preimage)) reject();
      const attempt: CompletionRepairAttempt = Object.freeze({
        schemaVersion: 1,
        kind: "historical-completion-tag-repair-attempt",
        scopeSha256: scope,
        decisionSha256: digest(decision),
        preimage,
        intended,
        writerRetirement: retired,
        attemptedAt: clock(ports),
      });
      validateAttempt(attempt, scope, decision, clock(ports));
      // Latch before any persistence await. A failed/ambiguous journal write never permits a send.
      attemptedScopes.add(scope);
      stage = "journal_ambiguous";
      if ((await ports.journal.createOnce(scope, attempt)) !== true)
        return finish("unresolved", "journal_ambiguous", "unknown");
      priorAttempt = true;
      // Durability contract is checked by immutable exact readback before even constructing a client.
      const persisted = await ports.journal.read(scope);
      if (digest(validateAttempt(persisted, scope, decision, clock(ports))) !== digest(attempt))
        reject();
      stage = "late_precondition_changed";
      if (digest(observation(await ports.readExactVersion(exactTarget))) !== digest(preimage))
        reject();
      if (
        digest(
          proof(
            await ports.readWriterExclusion(
              exactTarget,
              decision.sourceSha,
              decision.correctedCompletedAt,
            ),
            scope,
            decision.sourceSha,
            decision.correctedCompletedAt,
            clock(ports),
            true,
          ),
        ) !== digest(retired)
      )
        reject();
      const client = new ports.sdk.S3Client(COMPLETION_REPAIR_S3_CONFIGURATION);
      let acknowledged = false;
      try {
        const command = new ports.sdk.PutObjectTaggingCommand({
          Bucket: exactTarget.bucketName,
          ExpectedBucketOwner: exactTarget.expectedBucketOwner,
          Key: exactTarget.key,
          VersionId: exactTarget.versionId,
          ChecksumAlgorithm: "SHA256",
          Tagging: { TagSet: intended.tagSet.map((tag) => ({ ...tag })) },
        });
        writeAttemptsThisCall = 1;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const rawResponse = await new Promise<unknown>((resolve, rejectDeadline) => {
            timer = setTimeout(() => {
              controller.abort();
              rejectDeadline(new Error("HistoricalCompletionTagRepairDeadline"));
            }, COMPLETION_REPAIR_WRITE_TIMEOUT_MS);
            Promise.resolve(client.send(command, { abortSignal: controller.signal })).then(
              resolve,
              rejectDeadline,
            );
          });
          const response = record(rawResponse, ["VersionId", "$metadata"]);
          const metadata = response.$metadata;
          acknowledged =
            response.VersionId === exactTarget.versionId &&
            !!metadata &&
            typeof metadata === "object" &&
            Object.getOwnPropertyDescriptor(metadata, "httpStatusCode")?.value === 200;
        } catch {
          /* A thrown/rejected/malformed response is ambiguous, never permission to retry. */
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          controller.abort();
        }
      } finally {
        try {
          client.destroy();
        } catch {
          /* Resource cleanup must not replace exact readback. */
        }
      }
      stage = "readback_unavailable";
      const after = observation(await ports.readExactVersion(exactTarget));
      if (digest(after) !== digest(intended))
        return finish("unresolved", "readback_changed", "unknown");
      return finish(
        acknowledged ? "repaired" : "recovered_after_ambiguous_write",
        "verified",
        "intended_state_verified",
      );
    } catch {
      return finish(
        writeAttemptsThisCall === 1 || priorAttempt ? "unresolved" : "refused",
        stage,
        writeAttemptsThisCall === 1 || priorAttempt ? "unknown" : "none_attempted_this_call",
      );
    }
  };
}
