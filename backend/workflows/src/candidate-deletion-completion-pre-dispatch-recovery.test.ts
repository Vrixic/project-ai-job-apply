import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test, vi } from "vitest";
import {
  COMPLETION_REPAIR_S3_CONFIGURATION,
  COMPLETION_REPAIR_WRITE_TIMEOUT_MS,
  type CompletionPreDispatchRecoveryAttempt,
  type CompletionPreDispatchRecoveryPorts,
  type CompletionPreDispatchRecoveryProof,
  type CompletionRepairAttempt,
  type CompletionRepairObservation,
  type CompletionRepairPorts,
  type CompletionRepairResult,
  type CompletionRepairTarget,
  type CompletionRepairWriterProof,
  completionRepairScopeSha256,
  createHistoricalCompletionPreDispatchRecovery,
  createHistoricalCompletionTagRepair,
  type HistoricalCompletionRepairCandidate,
} from "./candidate-deletion-completion-tag-repair.js";

afterEach(() => vi.useRealTimers());

const clone = <T>(value: T): T => structuredClone(value);
const row = (value: unknown) => value as Record<string, unknown>;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const initialNow = "2026-09-11T10:00:00.000Z";
const privateSentinel = "GENERATED_PRIVATE_RECOVERY_SENTINEL";

async function fixture() {
  const originalCandidate: HistoricalCompletionRepairCandidate = {
    bucketName: "synthetic-completion-recovery",
    expectedBucketOwner: "123456789012",
    key: "candidate-deletion-recovery/22222222-2222-4222-8222-222222222222.json",
    versionId: "generated-exact-version",
    oldTagSet: [
      { Key: "state", Value: "completed" },
      { Key: "completed-at", Value: "2026-08-20T10:09:00.000Z" },
    ],
    correctedCompletedAt: "2026-08-20T10:05:00.000Z",
    bodySha256: "a".repeat(64),
    checksumSha256: "a".repeat(64),
    metadataSha256: "b".repeat(64),
    encryptionSha256: "c".repeat(64),
    retentionSha256: "d".repeat(64),
    versionInventorySha256: "e".repeat(64),
    etag: '"generated-etag"',
    contentLength: 901,
    lastModified: "2026-08-20T10:00:00.000Z",
    evidenceSha256: "f".repeat(64),
    sourceSha: "a".repeat(40),
  };
  const freshCandidate: HistoricalCompletionRepairCandidate = {
    ...clone(originalCandidate),
    sourceSha: "b".repeat(40),
    evidenceSha256: "1".repeat(64),
  };
  const target: CompletionRepairTarget = {
    bucketName: originalCandidate.bucketName,
    expectedBucketOwner: originalCandidate.expectedBucketOwner,
    key: originalCandidate.key,
    versionId: originalCandidate.versionId,
  };
  const scope = completionRepairScopeSha256(target);
  const {
    oldTagSet,
    sourceSha: _source,
    evidenceSha256: _evidence,
    correctedCompletedAt: _corrected,
    ...immutable
  } = originalCandidate;
  const initial: CompletionRepairObservation = { ...immutable, tagSet: clone(oldTagSet) };
  const intended: CompletionRepairObservation = {
    ...immutable,
    tagSet: [
      { Key: "completed-at", Value: originalCandidate.correctedCompletedAt },
      { Key: "state", Value: "completed" },
    ],
  };
  const originalWriter: CompletionRepairWriterProof = {
    targetScopeSha256: scope,
    sourceSha: originalCandidate.sourceSha,
    proofSha256: "2".repeat(64),
    conflictingWritersExcluded: true,
    correctedCompletedAt: originalCandidate.correctedCompletedAt,
    observedAt: "2026-09-10T09:59:00.000Z",
    expiresAt: "2026-09-10T10:04:00.000Z",
  };
  let originalAttempt: CompletionRepairAttempt | undefined;
  let oldWriterReads = 0;
  const originalDiagnosis = Object.freeze({});
  const oldPorts: CompletionRepairPorts = {
    readHistoricalCompletionRepairCandidate: (token) =>
      token === originalDiagnosis ? originalCandidate : undefined,
    readExactVersion: async () => clone(initial),
    readWriterExclusion: async () => {
      if (++oldWriterReads === 2) throw new Error(privateSentinel);
      return clone(originalWriter);
    },
    journal: {
      read: async () => clone(originalAttempt),
      createOnce: async (_, value) => {
        originalAttempt = clone(value);
        return true;
      },
    },
    sdk: {
      S3Client: class {
        constructor() {
          assert.fail("The original proven pre-dispatch attempt must not construct a client");
        }
        async send() {
          assert.fail("The original attempt must not dispatch");
        }
        destroy() {}
      },
      PutObjectTaggingCommand: class {},
    },
    now: () => new Date("2026-09-10T10:00:00.000Z"),
  };
  const originalResult = await createHistoricalCompletionTagRepair(oldPorts)(originalDiagnosis);
  assert.deepEqual(originalResult, {
    schemaVersion: 1,
    outcome: "unresolved",
    reason: "late_precondition_changed",
    writeAttemptsThisCall: 0,
    effect: "unknown",
  });
  assert.ok(originalAttempt);
  const originalBytes = Buffer.from(JSON.stringify(originalAttempt), "utf8");
  const authorization: CompletionPreDispatchRecoveryProof = {
    schemaVersion: 1,
    kind: "historical-completion-tag-repair-pre-dispatch-recovery-proof",
    originalCandidate: clone(originalCandidate),
    originalAttemptSha256: sha(originalBytes),
    originalExecutionSha256: "3".repeat(64),
    originalResultSha256: "4".repeat(64),
    originalResult,
    authoritySha256: "5".repeat(64),
    scopeSha256: scope,
    sourceSha: freshCandidate.sourceSha,
    evidenceSha256: freshCandidate.evidenceSha256,
    observedAt: initialNow,
    expiresAt: "2026-09-11T10:05:00.000Z",
  };
  const retirement: CompletionRepairWriterProof = {
    ...clone(originalWriter),
    sourceSha: freshCandidate.sourceSha,
    proofSha256: "6".repeat(64),
    observedAt: initialNow,
    expiresAt: "2026-09-11T10:05:00.000Z",
  };
  const diagnosis = Object.freeze({ outcome: "persisted_candidate" });
  const authority = Object.freeze({ outcome: "authorized_pre_dispatch_recovery" });
  const tokens = new WeakSet([diagnosis, authority]);
  const state = {
    candidate: clone(freshCandidate) as unknown,
    authorization: clone(authorization) as unknown,
    retirement: clone(retirement) as unknown,
    observation: clone(initial) as unknown,
    originalBytes: Buffer.from(originalBytes),
    now: initialNow,
    companion: new Map<string, unknown>(),
    events: [] as string[],
    commands: [] as unknown[],
    configurations: [] as unknown[],
    signals: [] as AbortSignal[],
    reports: [] as CompletionRepairResult[],
    writerReads: 0,
    originalReads: 0,
    authorityReads: 0,
    observationReads: 0,
    companionReads: 0,
    creates: 0,
    writes: 0,
    destroys: 0,
    onOriginal: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onAuthority: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onWriter: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onObservation: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onCompanionRead: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onCreate: undefined as
      | ((attempt: CompletionPreDispatchRecoveryAttempt) => boolean | Promise<boolean>)
      | undefined,
    onSend: undefined as ((signal: AbortSignal) => unknown | Promise<unknown>) | undefined,
    onReport: undefined as (() => void | Promise<void>) | undefined,
  };
  const originalEnvelope = () => ({
    sha256: sha(state.originalBytes),
    attempt: JSON.parse(state.originalBytes.toString("utf8")) as unknown,
  });
  class PutObjectTaggingCommand {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = clone(input);
    }
  }
  class S3Client {
    constructor(configuration: unknown) {
      state.events.push("client");
      assert.ok(state.companion.has(scope), "Fixed durable companion must predate the client");
      state.configurations.push(configuration);
    }
    async send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
      assert.ok(command instanceof PutObjectTaggingCommand);
      assert.ok(options?.abortSignal instanceof AbortSignal);
      state.events.push("put");
      state.commands.push(command.input);
      state.signals.push(options.abortSignal);
      state.writes++;
      if (state.onSend) return state.onSend(options.abortSignal);
      state.observation = clone(intended);
      return { VersionId: target.versionId, $metadata: { httpStatusCode: 200 } };
    }
    destroy() {
      state.events.push("destroy");
      state.destroys++;
    }
  }
  const ports: CompletionPreDispatchRecoveryPorts = {
    readHistoricalCompletionRepairCandidate(token) {
      return token === diagnosis && tokens.has(diagnosis) ? state.candidate : undefined;
    },
    async readAuthenticatedPreDispatchRecoveryProof(token) {
      state.events.push("authority");
      state.authorityReads++;
      if (token !== authority || !tokens.has(authority)) return undefined;
      return state.onAuthority
        ? state.onAuthority(state.authorityReads)
        : clone(state.authorization);
    },
    originalJournal: {
      async read(actualScope) {
        assert.equal(actualScope, scope);
        state.events.push("original");
        state.originalReads++;
        return state.onOriginal ? state.onOriginal(state.originalReads) : originalEnvelope();
      },
    },
    companionJournal: {
      async read(actualScope) {
        assert.equal(actualScope, scope);
        state.events.push("companion");
        state.companionReads++;
        return state.onCompanionRead
          ? state.onCompanionRead(state.companionReads)
          : clone(state.companion.get(actualScope));
      },
      async createOnce(actualScope, value) {
        assert.equal(actualScope, scope);
        state.events.push("reserve");
        state.creates++;
        if (state.onCreate) return state.onCreate(value);
        if (state.companion.has(actualScope)) return false;
        state.companion.set(actualScope, clone(value));
        return true;
      },
    },
    async readExactVersion(actual) {
      assert.deepEqual(actual, target);
      state.events.push("version");
      state.observationReads++;
      return state.onObservation
        ? state.onObservation(state.observationReads)
        : clone(state.observation);
    },
    async readWriterExclusion(actual, sourceSha, correctedCompletedAt) {
      assert.deepEqual(actual, target);
      assert.equal(sourceSha, freshCandidate.sourceSha);
      assert.equal(correctedCompletedAt, freshCandidate.correctedCompletedAt);
      state.events.push("writers");
      state.writerReads++;
      return state.onWriter ? state.onWriter(state.writerReads) : clone(state.retirement);
    },
    sdk: { S3Client, PutObjectTaggingCommand },
    now: () => new Date(state.now),
    report(result) {
      state.reports.push(result);
      return state.onReport?.();
    },
  };
  return {
    state,
    ports,
    diagnosis,
    authority,
    tokens,
    target,
    scope,
    originalCandidate,
    freshCandidate,
    originalAttempt,
    originalBytes,
    originalEnvelope,
    originalDiagnosis,
    oldPorts,
    authorization,
    retirement,
    initial,
    intended,
    recover: createHistoricalCompletionPreDispatchRecovery(ports),
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function assertNoDispatch(f: Fixture, result: CompletionRepairResult) {
  assert.equal(result.writeAttemptsThisCall, 0);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.configurations.length, 0);
}

test("explicit recovery links a real pre-dispatch refusal and consumes only the fixed companion", async () => {
  const f = await fixture();
  const result = await f.recover(f.diagnosis, f.authority);
  assert.deepEqual(result, {
    schemaVersion: 1,
    outcome: "repaired",
    reason: "verified",
    writeAttemptsThisCall: 1,
    effect: "intended_state_verified",
  });
  assert.deepEqual(f.state.originalBytes, f.originalBytes);
  assert.deepEqual([...f.state.companion.keys()], [f.scope]);
  const linked = f.state.companion.get(f.scope) as CompletionPreDispatchRecoveryAttempt;
  assert.deepEqual(Object.keys(linked).sort(), [
    "authoritySha256",
    "kind",
    "originalAttemptSha256",
    "originalDecisionSha256",
    "recoveryCandidate",
    "recoveryProofSha256",
    "repairAttempt",
    "schemaVersion",
    "scopeSha256",
  ]);
  assert.equal(linked.originalAttemptSha256, sha(f.originalBytes));
  assert.equal(linked.originalDecisionSha256, f.originalAttempt.decisionSha256);
  assert.notEqual(linked.repairAttempt.decisionSha256, f.originalAttempt.decisionSha256);
  assert.equal(linked.recoveryCandidate.sourceSha, f.freshCandidate.sourceSha);
  assert.equal(linked.recoveryCandidate.evidenceSha256, f.freshCandidate.evidenceSha256);
  assert.equal(linked.repairAttempt.writerRetirement.proofSha256, f.retirement.proofSha256);
  assert.deepEqual(f.state.configurations, [COMPLETION_REPAIR_S3_CONFIGURATION]);
  assert.deepEqual(f.state.commands, [
    {
      Bucket: f.target.bucketName,
      ExpectedBucketOwner: f.target.expectedBucketOwner,
      Key: f.target.key,
      VersionId: f.target.versionId,
      ChecksumAlgorithm: "SHA256",
      Tagging: { TagSet: f.intended.tagSet },
    },
  ]);
  assert.deepEqual(f.state.events, [
    "authority",
    "original",
    "companion",
    "writers",
    "version",
    "original",
    "authority",
    "reserve",
    "companion",
    "original",
    "writers",
    "version",
    "original",
    "authority",
    "original",
    "client",
    "put",
    "destroy",
    "version",
  ]);
  assert.equal(f.state.writerReads, 2);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.destroys, 1);
  assert.equal(f.state.signals[0]?.aborted, true);
});

test("ordinary repair remains readback-only on its unchanged original record", async () => {
  const f = await fixture();
  const normal = createHistoricalCompletionTagRepair({
    ...f.oldPorts,
    now: () => new Date(initialNow),
    readWriterExclusion: async () => assert.fail("No reopened default writer check"),
    journal: {
      read: async () => clone(f.originalAttempt),
      createOnce: async () => assert.fail("Original must not be replaced"),
    },
  });
  assert.equal((await normal(f.originalDiagnosis)).reason, "attempt_unresolved");
  assert.equal((await f.recover(f.diagnosis, f.authority)).outcome, "repaired");
  assert.equal((await normal(f.originalDiagnosis)).reason, "attempt_unresolved");
  assert.deepEqual(f.state.originalBytes, f.originalBytes);
});

test.each(["diagnosis", "authority"])(
  "plain JSON cannot replace authenticated %s",
  async (kind) => {
    const f = await fixture();
    const result = await f.recover(
      kind === "diagnosis" ? clone(f.diagnosis) : f.diagnosis,
      kind === "authority" ? clone(f.authority) : f.authority,
    );
    assertNoDispatch(f, result);
    assert.equal(result.reason, "decision_rejected");
    assert.equal(f.state.creates, 0);
  },
);

test.each([
  ["outcome", "refused"],
  ["reason", "readback_changed"],
  ["reason", "journal_ambiguous"],
  ["writeAttemptsThisCall", 1],
  ["effect", "none_attempted_this_call"],
  ["schemaVersion", 2],
  ["extra", true],
] as const)("rejects unproven original result %s=%s", async (field, value) => {
  const f = await fixture();
  row(row(f.state.authorization).originalResult)[field] = value;
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, 0);
});

test.each([
  "originalAttemptSha256",
  "originalExecutionSha256",
  "originalResultSha256",
  "authoritySha256",
  "scopeSha256",
  "sourceSha",
  "evidenceSha256",
  "kind",
  "schemaVersion",
  "observedAt",
  "expiresAt",
])("rejects malformed or mismatched authority %s", async (field) => {
  const f = await fixture();
  row(f.state.authorization)[field] = "invalid";
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, 0);
});

const candidateChanges: [string, unknown][] = [
  ["bucketName", "different-generated-bucket"],
  ["expectedBucketOwner", "987654321012"],
  ["key", "candidate-deletion-recovery/33333333-3333-4333-8333-333333333333.json"],
  ["versionId", "another-version"],
  ["metadataSha256", "7".repeat(64)],
  ["encryptionSha256", "7".repeat(64)],
  ["retentionSha256", "7".repeat(64)],
  ["versionInventorySha256", "7".repeat(64)],
  ["etag", '"changed-etag"'],
  ["contentLength", 902],
  ["lastModified", "2026-08-20T10:00:01.000Z"],
  ["correctedCompletedAt", "2026-08-20T10:05:01.000Z"],
  [
    "oldTagSet",
    [
      { Key: "completed-at", Value: "2026-08-20T10:09:01.000Z" },
      { Key: "state", Value: "completed" },
    ],
  ],
  [
    "oldTagSet",
    [
      { Key: "completed-at", Value: "2026-08-20T10:09:00.000Z" },
      { Key: "state", Value: "completed" },
      { Key: "extra", Value: "value" },
    ],
  ],
];

test.each(candidateChanges)("refuses changed fresh candidate field %s", async (field, value) => {
  const f = await fixture();
  row(f.state.candidate)[field] = clone(value);
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, 0);
});

test("even matching changed body and checksum cannot renew immutable identity", async () => {
  const f = await fixture();
  row(f.state.candidate).bodySha256 = "7".repeat(64);
  row(f.state.candidate).checksumSha256 = "7".repeat(64);
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
});

test.each(["sha256", "attempt", "extra"])(
  "requires exact original raw read envelope: %s",
  async (field) => {
    const f = await fixture();
    f.state.onOriginal = () => ({ ...f.originalEnvelope(), [field]: "invalid" });
    assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  },
);

test.each(["decisionSha256", "preimage", "intended", "writerRetirement", "attemptedAt", "kind"])(
  "revalidates original canonical attempt %s, not just its raw hash",
  async (field) => {
    const f = await fixture();
    const changed = clone(f.originalAttempt);
    row(changed)[field] = "invalid";
    f.state.originalBytes = Buffer.from(JSON.stringify(changed));
    row(f.state.authorization).originalAttemptSha256 = sha(f.state.originalBytes);
    assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  },
);

test("original raw-byte changes refuse even when parsed values are identical", async () => {
  const f = await fixture();
  f.state.originalBytes = Buffer.concat([f.originalBytes, Buffer.from("\n")]);
  const result = await f.recover(f.diagnosis, f.authority);
  assertNoDispatch(f, result);
  assert.equal(result.reason, "journal_rejected");
});

test.each([2, 3, 4, 5])(
  "original immutable read changes at checkpoint %s refuse",
  async (count) => {
    const f = await fixture();
    f.state.onOriginal = (read) =>
      read === count ? { ...f.originalEnvelope(), sha256: "0".repeat(64) } : f.originalEnvelope();
    const result = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, result);
    assert.equal(f.state.creates, count === 2 ? 0 : 1);
    assert.equal(result.outcome, count === 2 ? "refused" : "unresolved");
  },
);

test.each([2, 3])("authority cannot renew during checkpoint %s", async (count) => {
  const f = await fixture();
  f.state.onAuthority = (read) =>
    read === count
      ? { ...f.authorization, authoritySha256: "7".repeat(64) }
      : clone(f.authorization);
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, count === 2 ? 0 : 1);
});

test.each(
  candidateChanges.filter(([field]) => field !== "correctedCompletedAt" && field !== "oldTagSet"),
)("fresh exact-version field %s must equal the entire original preimage", async (field, value) => {
  const f = await fixture();
  row(f.state.observation)[field] = clone(value);
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, 0);
});

test.each(["scope", "source", "corrected", "boolean", "proof", "renewed", "expired"])(
  "second fresh writer check cannot change %s or extend its first lease",
  async (change) => {
    const f = await fixture();
    f.state.onWriter = (count) => {
      if (count === 1) return clone(f.retirement);
      const value = clone(f.retirement);
      if (change === "scope") row(value).targetScopeSha256 = "7".repeat(64);
      if (change === "source") row(value).sourceSha = "7".repeat(40);
      if (change === "corrected") row(value).correctedCompletedAt = "2026-08-20T10:05:01.000Z";
      if (change === "boolean") row(value).conflictingWritersExcluded = false;
      if (change === "proof") row(value).proofSha256 = "7".repeat(64);
      if (change === "renewed") row(value).expiresAt = "2026-09-11T10:04:59.000Z";
      if (change === "expired") f.state.now = f.retirement.expiresAt;
      return value;
    };
    const result = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, result);
    assert.equal(result.reason, "late_precondition_changed");
    assert.equal(f.state.creates, 1);
    f.state.onWriter = undefined;
    const repeated = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, repeated);
    assert.equal(f.state.creates, 1);
  },
);

test.each(["authority", "writer"])("rejects a %s lease longer than five minutes", async (kind) => {
  const f = await fixture();
  row(kind === "authority" ? f.state.authorization : f.state.retirement).expiresAt =
    "2026-09-11T10:05:00.001Z";
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
});

test("late S3 change is checked after the complete second writer collection", async () => {
  const f = await fixture();
  f.state.onWriter = (count) => {
    if (count === 2) f.state.observation = { ...f.initial, etag: '"late-etag"' };
    return clone(f.retirement);
  };
  const result = await f.recover(f.diagnosis, f.authority);
  assertNoDispatch(f, result);
  assert.equal(result.reason, "late_precondition_changed");
  assert.equal(f.state.creates, 1);
});

test("expiry during final original-file check is rechecked before client construction", async () => {
  const f = await fixture();
  f.state.onOriginal = (count) => {
    if (count === 5) f.state.now = f.retirement.expiresAt;
    return f.originalEnvelope();
  };
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  assert.equal(f.state.creates, 1);
});

test.each([null, {}, "partial", { kind: "conflicting" }])(
  "existing partial/conflicting companion is never reopened: %j",
  async (value) => {
    const f = await fixture();
    f.state.companion.set(f.scope, value);
    const result = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, result);
    assert.equal(result.outcome, "unresolved");
    assert.equal(f.state.writerReads, 0);
    assert.equal(f.state.creates, 0);
  },
);

test.each(["false", "throw", "bad-readback"])(
  "ambiguous companion persistence %s consumes the local latch",
  async (kind) => {
    const f = await fixture();
    f.state.onCreate = () => {
      if (kind === "throw") throw new Error(privateSentinel);
      return kind === "bad-readback";
    };
    assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
    f.state.onCreate = undefined;
    const repeated = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, repeated);
    assert.equal(repeated.reason, "journal_ambiguous");
    assert.equal(f.state.creates, 1);
  },
);

test("valid existing companion is only read back after expired proof, including across instances", async () => {
  const f = await fixture();
  assert.equal((await f.recover(f.diagnosis, f.authority)).outcome, "repaired");
  f.state.now = "2026-09-12T10:00:00.000Z";
  f.state.onWriter = () => assert.fail("Never renew a used recovery proof");
  const repeated = await createHistoricalCompletionPreDispatchRecovery(f.ports)(
    f.diagnosis,
    f.authority,
  );
  assert.equal(repeated.outcome, "verified_prior_attempt");
  assert.equal(repeated.writeAttemptsThisCall, 0);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
});

test("a renewed source/authority cannot name a new companion or recover recovery", async () => {
  const f = await fixture();
  f.state.onWriter = (count) => {
    if (count === 2) throw new Error(privateSentinel);
    return clone(f.retirement);
  };
  assertNoDispatch(f, await f.recover(f.diagnosis, f.authority));
  row(f.state.candidate).sourceSha = "c".repeat(40);
  row(f.state.authorization).sourceSha = "c".repeat(40);
  const repeated = await createHistoricalCompletionPreDispatchRecovery(f.ports)(
    f.diagnosis,
    f.authority,
  );
  assertNoDispatch(f, repeated);
  assert.equal(f.state.creates, 1);
  assert.deepEqual([...f.state.companion.keys()], [f.scope]);
  const companion = f.state.companion.get(f.scope);
  f.state.originalBytes = Buffer.from(JSON.stringify(companion));
  row(f.state.authorization).originalAttemptSha256 = sha(f.state.originalBytes);
  assertNoDispatch(
    f,
    await createHistoricalCompletionPreDispatchRecovery(f.ports)(f.diagnosis, f.authority),
  );
  assert.equal(f.state.creates, 1);
});

test("two concurrent factory instances share one fixed create-once slot and at most one Put", async () => {
  const f = await fixture();
  const other = createHistoricalCompletionPreDispatchRecovery(f.ports);
  const results = await Promise.all([
    f.recover(f.diagnosis, f.authority),
    other(f.diagnosis, f.authority),
  ]);
  assert.equal(results.filter((result) => result.writeAttemptsThisCall === 1).length, 1);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.companion.size, 1);
  assert.deepEqual(f.state.originalBytes, f.originalBytes);
});

test("already intended exact version is a no-op without a companion reservation", async () => {
  const f = await fixture();
  f.state.observation = clone(f.intended);
  const result = await f.recover(f.diagnosis, f.authority);
  assertNoDispatch(f, result);
  assert.equal(result.outcome, "already_correct");
  assert.equal(f.state.creates, 0);
});

test.each(["throw-after", "malformed-after", "throw-before"])(
  "ambiguous %s never resends and only exact intended readback recovers",
  async (kind) => {
    const f = await fixture();
    f.state.onSend = () => {
      if (kind !== "throw-before") f.state.observation = clone(f.intended);
      if (kind === "malformed-after") return { VersionId: "another-version" };
      throw new Error(privateSentinel);
    };
    const result = await f.recover(f.diagnosis, f.authority);
    assert.equal(
      result.outcome,
      kind === "throw-before" ? "unresolved" : "recovered_after_ambiguous_write",
    );
    assert.equal(result.writeAttemptsThisCall, 1);
    const repeated = await f.recover(f.diagnosis, f.authority);
    assert.equal(repeated.writeAttemptsThisCall, 0);
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.creates, 1);
  },
);

test.each([false, true])(
  "finite deadline handles abort-aware=%s send without a late resend",
  async (abortAware) => {
    vi.useFakeTimers();
    const f = await fixture();
    f.state.onSend = (signal) =>
      new Promise((_, reject) => {
        if (abortAware)
          signal.addEventListener("abort", () => reject(new Error(privateSentinel)), {
            once: true,
          });
      });
    const pending = f.recover(f.diagnosis, f.authority);
    await vi.advanceTimersByTimeAsync(COMPLETION_REPAIR_WRITE_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.outcome, "unresolved");
    assert.equal(result.writeAttemptsThisCall, 1);
    assert.equal(f.state.signals[0]?.aborted, true);
    assert.equal(f.state.destroys, 1);
    await vi.advanceTimersByTimeAsync(COMPLETION_REPAIR_WRITE_TIMEOUT_MS * 2);
    assert.equal((await f.recover(f.diagnosis, f.authority)).writeAttemptsThisCall, 0);
    assert.equal(f.state.writes, 1);
  },
);

test.each([false, true])(
  "failure reports remain closed and private even if report rejects=%s",
  async (asyncLogger) => {
    const f = await fixture();
    f.state.onWriter = () => {
      throw new Error(`${privateSentinel}:${f.target.key}`);
    };
    f.state.onReport = () => {
      if (asyncLogger) return Promise.reject(new Error(privateSentinel));
      throw new Error(privateSentinel);
    };
    const result = await f.recover(f.diagnosis, f.authority);
    assertNoDispatch(f, result);
    const output = JSON.stringify([result, f.state.reports]);
    for (const privateValue of [
      privateSentinel,
      f.target.key,
      f.target.versionId,
      f.scope,
      f.authorization.authoritySha256,
    ])
      assert.equal(output.includes(privateValue), false);
    assert.deepEqual(Object.keys(result).sort(), [
      "effect",
      "outcome",
      "reason",
      "schemaVersion",
      "writeAttemptsThisCall",
    ]);
  },
);
