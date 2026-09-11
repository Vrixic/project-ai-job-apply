import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import {
  COMPLETION_REPAIR_S3_CONFIGURATION,
  COMPLETION_REPAIR_WRITE_TIMEOUT_MS,
  type CompletionRepairAttempt,
  type CompletionRepairObservation,
  type CompletionRepairPorts,
  type CompletionRepairResult,
  type CompletionRepairTarget,
  type CompletionRepairWriterProof,
  completionRepairScopeSha256,
  createHistoricalCompletionTagRepair,
  type HistoricalCompletionRepairCandidate,
} from "./candidate-deletion-completion-tag-repair.js";

afterEach(() => {
  vi.useRealTimers();
});

const oldTime = "2026-08-25T15:09:00.000Z";
const correctedTime = "2026-08-25T15:05:00.000Z";
const now = "2026-09-10T23:30:00.000Z";
const sensitiveSentinel = "GENERATED_PRIVATE_VALUE_MUST_NOT_BE_RETAINED";
const clone = <T>(value: T): T => structuredClone(value);

function fixture() {
  const candidate: HistoricalCompletionRepairCandidate = {
    bucketName: "synthetic-completion-repair",
    expectedBucketOwner: "123456789012",
    key: "candidate-deletion-recovery/11111111-1111-4111-8111-111111111111.json",
    versionId: "synthetic-exact-version-1",
    oldTagSet: [
      { Key: "state", Value: "completed" },
      { Key: "completed-at", Value: oldTime },
    ],
    correctedCompletedAt: correctedTime,
    bodySha256: "a".repeat(64),
    checksumSha256: "a".repeat(64),
    metadataSha256: "b".repeat(64),
    encryptionSha256: "c".repeat(64),
    retentionSha256: "d".repeat(64),
    versionInventorySha256: "e".repeat(64),
    etag: '"synthetic-body-etag"',
    contentLength: 900,
    lastModified: "2026-08-25T15:00:00.000Z",
    evidenceSha256: "f".repeat(64),
    sourceSha: "a".repeat(40),
  };
  const target: CompletionRepairTarget = {
    bucketName: candidate.bucketName,
    expectedBucketOwner: candidate.expectedBucketOwner,
    key: candidate.key,
    versionId: candidate.versionId,
  };
  const scope = completionRepairScopeSha256(target);
  const {
    oldTagSet,
    correctedCompletedAt: _corrected,
    evidenceSha256: _evidence,
    sourceSha: _source,
    ...binding
  } = candidate;
  const initial: CompletionRepairObservation = { ...binding, tagSet: clone(oldTagSet) };
  const retirement: CompletionRepairWriterProof = {
    targetScopeSha256: scope,
    sourceSha: candidate.sourceSha,
    proofSha256: "8".repeat(64),
    conflictingWritersExcluded: true,
    correctedCompletedAt: correctedTime,
    observedAt: "2026-09-10T23:29:00.000Z",
    expiresAt: "2026-09-10T23:34:00.000Z",
  };
  const diagnosis = Object.freeze({ outcome: "correction_proven" });
  const branded = new WeakMap<object, unknown>([[diagnosis, candidate]]);
  const state = {
    observation: clone(initial) as unknown,
    retirement: clone(retirement) as unknown,
    now,
    events: [] as string[],
    commands: [] as unknown[],
    signals: [] as AbortSignal[],
    clientConfigurations: [] as unknown[],
    reports: [] as CompletionRepairResult[],
    journal: new Map<string, unknown>(),
    observations: 0,
    retirements: 0,
    writes: 0,
    creates: 0,
    destroys: 0,
    onObservation: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onRetirement: undefined as ((count: number) => unknown | Promise<unknown>) | undefined,
    onCreate: undefined as
      | ((attempt: CompletionRepairAttempt) => boolean | Promise<boolean>)
      | undefined,
    onSend: undefined as (() => unknown | Promise<unknown>) | undefined,
    onReport: undefined as ((result: CompletionRepairResult) => void | Promise<void>) | undefined,
  };
  const setIntended = () => {
    state.observation = {
      ...clone(initial),
      tagSet: [
        { Key: "completed-at", Value: correctedTime },
        { Key: "state", Value: "completed" },
      ],
    };
  };
  class PutObjectTaggingCommand {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = clone(input);
    }
  }
  class S3Client {
    constructor(configuration: unknown) {
      state.events.push("construct-client");
      state.clientConfigurations.push(configuration);
    }
    async send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
      assert.ok(command instanceof PutObjectTaggingCommand, "Only exact tag writes are permitted");
      state.events.push("put-tags");
      state.commands.push(command.input);
      assert.ok(options?.abortSignal instanceof AbortSignal);
      state.signals.push(options.abortSignal);
      state.writes++;
      assert.ok(state.journal.has(scope), "Attempt must exist before any request");
      if (state.onSend) return state.onSend();
      setIntended();
      return { VersionId: candidate.versionId, $metadata: { httpStatusCode: 200 } };
    }
    destroy() {
      state.events.push("destroy-client");
      state.destroys++;
    }
  }
  const ports: CompletionRepairPorts = {
    readHistoricalCompletionRepairCandidate(result) {
      return result && typeof result === "object" ? branded.get(result) : undefined;
    },
    async readExactVersion(actual) {
      state.events.push("read-version");
      assert.deepEqual(actual, target);
      state.observations++;
      return state.onObservation
        ? state.onObservation(state.observations)
        : clone(state.observation);
    },
    async readWriterExclusion(actual, sourceSha, correctedCompletedAt) {
      state.events.push("read-retirement");
      assert.deepEqual(actual, target);
      assert.equal(sourceSha, candidate.sourceSha);
      assert.equal(correctedCompletedAt, candidate.correctedCompletedAt);
      state.retirements++;
      return state.onRetirement ? state.onRetirement(state.retirements) : clone(state.retirement);
    },
    journal: {
      async read(actualScope) {
        state.events.push("read-journal");
        assert.equal(actualScope, scope);
        const saved = state.journal.get(actualScope);
        return saved === undefined ? undefined : clone(saved);
      },
      async createOnce(actualScope, attempt) {
        state.events.push("create-journal");
        assert.equal(actualScope, scope);
        state.creates++;
        if (state.onCreate) return state.onCreate(attempt);
        if (state.journal.has(scope)) return false;
        state.journal.set(scope, clone(attempt));
        return true;
      },
    },
    sdk: { S3Client, PutObjectTaggingCommand },
    now: () => new Date(state.now),
    report(result) {
      state.reports.push(result);
      return state.onReport?.(result);
    },
  };
  return {
    candidate,
    diagnosis,
    branded,
    target,
    scope,
    initial,
    retirement,
    state,
    ports,
    setIntended,
    repair: createHistoricalCompletionTagRepair(ports),
  };
}

test("persists exact private preimage before one version-bound tag request and readback", async () => {
  const f = fixture();
  const result = await f.repair(f.diagnosis);
  assert.deepEqual(result, {
    schemaVersion: 1,
    outcome: "repaired",
    reason: "verified",
    writeAttemptsThisCall: 1,
    effect: "intended_state_verified",
  });
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.destroys, 1);
  assert.deepEqual(f.state.clientConfigurations, [COMPLETION_REPAIR_S3_CONFIGURATION]);
  assert.deepEqual(f.state.commands, [
    {
      Bucket: f.target.bucketName,
      ExpectedBucketOwner: f.target.expectedBucketOwner,
      Key: f.target.key,
      VersionId: f.target.versionId,
      ChecksumAlgorithm: "SHA256",
      Tagging: {
        TagSet: [
          { Key: "completed-at", Value: correctedTime },
          { Key: "state", Value: "completed" },
        ],
      },
    },
  ]);
  assert.deepEqual(f.state.events, [
    "read-journal",
    "read-retirement",
    "read-version",
    "create-journal",
    "read-journal",
    "read-version",
    "read-retirement",
    "construct-client",
    "put-tags",
    "destroy-client",
    "read-version",
  ]);
  const saved = f.state.journal.get(f.scope) as CompletionRepairAttempt;
  assert.equal(saved.preimage.tagSet[0]?.Value, oldTime);
  assert.equal(saved.intended.tagSet[0]?.Value, correctedTime);
  const { tagSet: _old, ...before } = saved.preimage;
  const { tagSet: _new, ...after } = saved.intended;
  assert.deepEqual(before, after);
  assert.equal(saved.preimage.tagSet[1]?.Value, saved.intended.tagSet[1]?.Value);
});

test("already-correct exact state is a no-op without client, journal creation or write", async () => {
  const f = fixture();
  f.setIntended();
  assert.equal((await f.repair(f.diagnosis)).outcome, "already_correct");
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.creates, 0);
  assert.equal(f.state.clientConfigurations.length, 0);
});

test("serialized and lookalike diagnostic results cannot mint repair authority", async () => {
  const f = fixture();
  for (const value of [clone(f.diagnosis), f.candidate, null, true, "positive"]) {
    assert.equal((await f.repair(value)).reason, "decision_rejected");
  }
  assert.deepEqual(f.state.events, []);
});

test("there is no default trust for a parsed candidate when the provenance-verifier port is absent", async () => {
  const f = fixture();
  const { readHistoricalCompletionRepairCandidate: _omitted, ...unverifiedPorts } = f.ports;
  const result = await createHistoricalCompletionTagRepair(
    unverifiedPorts as CompletionRepairPorts,
  )(clone(f.candidate));
  assert.equal(result.reason, "decision_rejected");
  assert.deepEqual(f.state.events, []);
  assert.equal(f.state.writes, 0);
});

const changedPreconditions: [string, (value: Record<string, unknown>) => void][] = [
  [
    "bucket",
    (value) => {
      value.bucketName = "different-synthetic-bucket";
    },
  ],
  [
    "bucket-owner",
    (value) => {
      value.expectedBucketOwner = "999999999999";
    },
  ],
  [
    "object-key",
    (value) => {
      value.key = "candidate-deletion-recovery/22222222-2222-4222-8222-222222222222.json";
    },
  ],
  [
    "object-version",
    (value) => {
      value.versionId = "different-version";
    },
  ],
  [
    "body-and-checksum",
    (value) => {
      value.bodySha256 = "1".repeat(64);
      value.checksumSha256 = "1".repeat(64);
    },
  ],
  [
    "checksum-only",
    (value) => {
      value.checksumSha256 = "1".repeat(64);
    },
  ],
  [
    "metadata",
    (value) => {
      value.metadataSha256 = "1".repeat(64);
    },
  ],
  [
    "encryption",
    (value) => {
      value.encryptionSha256 = "1".repeat(64);
    },
  ],
  [
    "retention",
    (value) => {
      value.retentionSha256 = "1".repeat(64);
    },
  ],
  [
    "other-version-inventory",
    (value) => {
      value.versionInventorySha256 = "1".repeat(64);
    },
  ],
  [
    "etag",
    (value) => {
      value.etag = '"different-etag"';
    },
  ],
  [
    "content-length",
    (value) => {
      value.contentLength = 901;
    },
  ],
  [
    "last-modified",
    (value) => {
      value.lastModified = "2026-08-25T15:00:01.000Z";
    },
  ],
  [
    "other-completion",
    (value) => {
      value.tagSet = [
        { Key: "state", Value: "completed" },
        { Key: "completed-at", Value: "2026-08-25T15:10:00.000Z" },
      ];
    },
  ],
  [
    "state-tag",
    (value) => {
      value.tagSet = [
        { Key: "state", Value: "pending" },
        { Key: "completed-at", Value: oldTime },
      ];
    },
  ],
  [
    "extra-tag",
    (value) => {
      value.tagSet = [...(value.tagSet as unknown[]), { Key: "additional", Value: "preserve" }];
    },
  ],
  [
    "duplicate-tag",
    (value) => {
      value.tagSet = [
        { Key: "state", Value: "completed" },
        { Key: "state", Value: "completed" },
      ];
    },
  ],
  [
    "missing-tag",
    (value) => {
      value.tagSet = [{ Key: "state", Value: "completed" }];
    },
  ],
  [
    "extra-observation-field",
    (value) => {
      value.unreviewed = true;
    },
  ],
];

for (const [name, mutate] of changedPreconditions) {
  test(`rejects changed ${name} before persisting an attempt`, async () => {
    const f = fixture();
    mutate(f.state.observation as Record<string, unknown>);
    const result = await f.repair(f.diagnosis);
    assert.equal(result.reason, "precondition_changed");
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.writes, 0);
  });
  test(`rejects changed ${name} after journal persistence, without sending`, async () => {
    const f = fixture();
    f.state.onObservation = (count) => {
      const value = clone(f.state.observation) as Record<string, unknown>;
      if (count === 2) mutate(value);
      return value;
    };
    const result = await f.repair(f.diagnosis);
    assert.equal(result.reason, "late_precondition_changed");
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.clientConfigurations.length, 0);
    // Even a now-correct precondition does not reopen the already journaled attempt.
    f.state.onObservation = undefined;
    assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
    assert.equal(f.state.writes, 0);
  });
}

const invalidCandidates: [string, (value: Record<string, unknown>) => void][] = [
  [
    "unbound-null-version",
    (value) => {
      value.versionId = "null";
    },
  ],
  [
    "noncompiled-prefix",
    (value) => {
      value.key = "another-prefix/generated.json";
    },
  ],
  [
    "unbound-owner",
    (value) => {
      value.expectedBucketOwner = "*";
    },
  ],
  [
    "checksum-mismatch",
    (value) => {
      value.checksumSha256 = "1".repeat(64);
    },
  ],
  [
    "noncanonical-completion",
    (value) => {
      value.correctedCompletedAt = "2026-08-25T15:05:00Z";
    },
  ],
  [
    "nonfinite-completion",
    (value) => {
      value.correctedCompletedAt = "invalid";
    },
  ],
  [
    "unknown-field",
    (value) => {
      value.extra = true;
    },
  ],
  [
    "missing-source",
    (value) => {
      delete value.sourceSha;
    },
  ],
  [
    "invalid-evidence",
    (value) => {
      value.evidenceSha256 = "unknown";
    },
  ],
  [
    "extra-tag",
    (value) => {
      value.oldTagSet = [...(value.oldTagSet as unknown[]), { Key: "extra", Value: "preserve" }];
    },
  ],
];

for (const [name, mutate] of invalidCandidates) {
  test(`rejects malformed trusted candidate ${name}`, async () => {
    const f = fixture();
    const value = clone(f.candidate) as unknown as Record<string, unknown>;
    mutate(value);
    f.branded.set(f.diagnosis, value);
    assert.equal((await f.repair(f.diagnosis)).reason, "decision_rejected");
    assert.deepEqual(f.state.events, []);
  });
}

const invalidRetirement: [string, (value: Record<string, unknown>) => void][] = [
  [
    "different-persisted-completion",
    (value) => {
      value.correctedCompletedAt = oldTime;
    },
  ],
  [
    "not-retired",
    (value) => {
      value.conflictingWritersExcluded = false;
    },
  ],
  [
    "different-target",
    (value) => {
      value.targetScopeSha256 = "1".repeat(64);
    },
  ],
  [
    "different-source",
    (value) => {
      value.sourceSha = "b".repeat(40);
    },
  ],
  [
    "expired",
    (value) => {
      value.expiresAt = now;
    },
  ],
  [
    "future-observation",
    (value) => {
      value.observedAt = "2026-09-10T23:31:00.000Z";
    },
  ],
  [
    "missing-evidence",
    (value) => {
      value.proofSha256 = "";
    },
  ],
];

for (const [name, mutate] of invalidRetirement) {
  test(`rejects writer proof ${name} without persisting or sending`, async () => {
    const f = fixture();
    mutate(f.state.retirement as Record<string, unknown>);
    assert.equal((await f.repair(f.diagnosis)).reason, "writer_exclusion_unproven");
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.writes, 0);
  });
  test(`rejects late writer proof ${name}`, async () => {
    const f = fixture();
    f.state.onRetirement = (count) => {
      const value = clone(f.state.retirement) as Record<string, unknown>;
      if (count === 2) mutate(value);
      return value;
    };
    assert.equal((await f.repair(f.diagnosis)).reason, "late_precondition_changed");
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.writes, 0);
  });
}

test("a changed but otherwise valid late retirement proof cannot replace the reviewed one", async () => {
  const f = fixture();
  f.state.onRetirement = (count) => ({
    ...f.retirement,
    proofSha256: (count === 2 ? "9" : "8").repeat(64),
  });
  assert.equal((await f.repair(f.diagnosis)).reason, "late_precondition_changed");
  assert.equal(f.state.writes, 0);
});

test("no write after ambiguous journal persistence; next call only inspects retained attempt", async () => {
  const f = fixture();
  f.state.onCreate = (attempt) => {
    f.state.journal.set(f.scope, clone(attempt));
    throw new Error(sensitiveSentinel);
  };
  assert.equal((await f.repair(f.diagnosis)).reason, "journal_ambiguous");
  assert.equal(f.state.writes, 0);
  assert.equal((await f.repair(f.diagnosis)).reason, "attempt_unresolved");
  assert.equal(f.state.creates, 1);
});

test("a false atomic create response is never permission to send", async () => {
  const f = fixture();
  f.state.onCreate = () => false;
  assert.equal((await f.repair(f.diagnosis)).reason, "journal_ambiguous");
  assert.equal((await f.repair(f.diagnosis)).reason, "journal_ambiguous");
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.writes, 0);
});

test("truthy nonboolean journal acknowledgments never authorize a request", async () => {
  for (const value of [1, "true"]) {
    const f = fixture();
    f.state.onCreate = () => value as unknown as boolean;
    assert.equal((await f.repair(f.diagnosis)).reason, "journal_ambiguous");
    assert.equal(f.state.writes, 0);
  }
});

test("claiming persistence without an exact durable readback cannot send", async () => {
  const f = fixture();
  f.state.onCreate = () => true;
  assert.equal((await f.repair(f.diagnosis)).reason, "journal_ambiguous");
  assert.equal(f.state.writes, 0);
});

test("a conflicting existing attempt is not overwritten or resubmitted", async () => {
  const f = fixture();
  await f.repair(f.diagnosis);
  const saved = clone(f.state.journal.get(f.scope)) as Record<string, unknown>;
  saved.decisionSha256 = "0".repeat(64);
  f.state.journal.set(f.scope, saved);
  assert.equal(
    (await createHistoricalCompletionTagRepair(f.ports)(f.diagnosis)).reason,
    "journal_rejected",
  );
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
});

test("a new source/decision cannot bypass the same exact object-version attempt scope", async () => {
  const f = fixture();
  f.state.onSend = () => {
    throw new Error(sensitiveSentinel);
  };
  await f.repair(f.diagnosis);
  f.branded.set(f.diagnosis, { ...f.candidate, sourceSha: "b".repeat(40) });
  const result = await createHistoricalCompletionTagRepair(f.ports)(f.diagnosis);
  assert.equal(result.reason, "journal_rejected");
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
});

test("parallel callers sharing atomic target journal issue at most one request", async () => {
  const f = fixture();
  const first = createHistoricalCompletionTagRepair(f.ports);
  const second = createHistoricalCompletionTagRepair(f.ports);
  await Promise.all([first(f.diagnosis), second(f.diagnosis)]);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.journal.size, 1);
});

test("lost response is recovered only when intended exact-version state is read back", async () => {
  const f = fixture();
  f.state.onSend = () => {
    f.setIntended();
    throw new Error(sensitiveSentinel);
  };
  const result = await f.repair(f.diagnosis);
  assert.equal(result.outcome, "recovered_after_ambiguous_write");
  assert.equal(result.writeAttemptsThisCall, 1);
  assert.equal(f.state.writes, 1);
  assert.equal((await f.repair(f.diagnosis)).outcome, "verified_prior_attempt");
  assert.equal(f.state.writes, 1);
});

test("a never-settling write times out, aborts and never resubmits", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  f.state.onSend = () => new Promise(() => {});
  const pending = f.repair(f.diagnosis);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.writes, 1);
  vi.advanceTimersByTime(COMPLETION_REPAIR_WRITE_TIMEOUT_MS);
  const result = await pending;
  assert.equal(result.outcome, "unresolved");
  assert.equal(result.effect, "unknown");
  assert.equal(f.state.signals[0]?.aborted, true);
  assert.equal(f.state.destroys, 1);
  vi.advanceTimersByTime(COMPLETION_REPAIR_WRITE_TIMEOUT_MS * 5);
  assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
  assert.equal(f.state.writes, 1);
});

test("abort-aware timeout rejection is recovered only by exact intended readback", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  f.state.onSend = () =>
    new Promise((_resolve, reject) => {
      f.setIntended();
      f.state.signals[0]?.addEventListener("abort", () => reject(new Error(sensitiveSentinel)), {
        once: true,
      });
    });
  const pending = f.repair(f.diagnosis);
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.advanceTimersByTime(COMPLETION_REPAIR_WRITE_TIMEOUT_MS);
  assert.equal((await pending).outcome, "recovered_after_ambiguous_write");
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.destroys, 1);
});

test("late write settlement cannot restart a timed-out attempt", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = fixture();
  let settle: ((value: unknown) => void) | undefined;
  f.state.onSend = () =>
    new Promise((resolve) => {
      settle = resolve;
    });
  const pending = f.repair(f.diagnosis);
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.advanceTimersByTime(COMPLETION_REPAIR_WRITE_TIMEOUT_MS);
  assert.equal((await pending).outcome, "unresolved");
  f.setIntended();
  settle?.({ VersionId: f.target.versionId, $metadata: { httpStatusCode: 200 } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await f.repair(f.diagnosis)).outcome, "verified_prior_attempt");
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
});

test("lost response with old tag remaining is unknown, never a retry or rollback", async () => {
  const f = fixture();
  f.state.onSend = () => {
    throw new Error(sensitiveSentinel);
  };
  const first = await f.repair(f.diagnosis);
  assert.equal(first.outcome, "unresolved");
  assert.equal(first.effect, "unknown");
  assert.equal(first.writeAttemptsThisCall, 1);
  assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
  assert.equal(
    (await createHistoricalCompletionTagRepair(f.ports)(f.diagnosis)).outcome,
    "unresolved",
  );
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.creates, 1);
});

test("a later intended readback resolves the original attempt even after proof expiry", async () => {
  const f = fixture();
  f.state.onSend = () => {
    throw new Error(sensitiveSentinel);
  };
  await f.repair(f.diagnosis);
  f.setIntended();
  f.state.now = "2026-09-10T23:50:00.000Z";
  f.state.onRetirement = () => {
    throw new Error("ShouldNotSeekNewWriteAuthority");
  };
  const result = await createHistoricalCompletionTagRepair(f.ports)(f.diagnosis);
  assert.equal(result.outcome, "verified_prior_attempt");
  assert.equal(result.writeAttemptsThisCall, 0);
  assert.equal(f.state.writes, 1);
});

test("acknowledgment alone is not success when exact tags were not changed", async () => {
  const f = fixture();
  f.state.onSend = () => ({ VersionId: f.target.versionId, $metadata: { httpStatusCode: 200 } });
  assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
  assert.equal(f.state.writes, 1);
});

for (const [name, mutate] of changedPreconditions) {
  test(`intended tag with changed ${name} cannot certify an ambiguous write`, async () => {
    const f = fixture();
    f.state.onSend = () => {
      f.setIntended();
      mutate(f.state.observation as Record<string, unknown>);
      throw new Error(sensitiveSentinel);
    };
    assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
    assert.equal(f.state.writes, 1);
    assert.equal((await f.repair(f.diagnosis)).outcome, "unresolved");
    assert.equal(f.state.writes, 1);
  });
}

test("unavailable post-write readback stays unknown despite a successful acknowledgment", async () => {
  const f = fixture();
  f.state.onObservation = (count) => {
    if (count === 3) throw new Error(sensitiveSentinel);
    return clone(f.state.observation);
  };
  const result = await f.repair(f.diagnosis);
  assert.equal(result.reason, "readback_unavailable");
  assert.equal(result.effect, "unknown");
  assert.equal(f.state.writes, 1);
});

test("non-success or wrong-version acknowledgment requires intended state recovery", async () => {
  for (const acknowledgment of [
    undefined,
    {},
    { VersionId: "different", $metadata: { httpStatusCode: 200 } },
    { VersionId: "synthetic-exact-version-1", $metadata: { httpStatusCode: 500 } },
  ]) {
    const f = fixture();
    f.state.onSend = () => {
      f.setIntended();
      return acknowledgment;
    };
    assert.equal((await f.repair(f.diagnosis)).outcome, "recovered_after_ambiguous_write");
    assert.equal(f.state.writes, 1);
  }
});

test("tag order is representation-only, while the exact closed full set remains required", async () => {
  const f = fixture();
  (f.state.observation as { tagSet: unknown[] }).tagSet.reverse();
  assert.equal((await f.repair(f.diagnosis)).outcome, "repaired");
  assert.equal(f.state.writes, 1);
});

test("accessors and revoked proxies yield only fixed diagnostics and never execute a write", async () => {
  const f = fixture();
  let getters = 0;
  const hostile = Object.defineProperty({}, "bucketName", {
    enumerable: true,
    get() {
      getters++;
      throw new Error(sensitiveSentinel);
    },
  });
  f.branded.set(f.diagnosis, hostile);
  assert.equal((await f.repair(f.diagnosis)).reason, "decision_rejected");
  assert.equal(getters, 0);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  f.branded.set(f.diagnosis, proxy);
  assert.equal((await f.repair(f.diagnosis)).reason, "decision_rejected");
  assert.equal(f.state.writes, 0);
  assert.ok(!JSON.stringify(f.state.reports).includes(sensitiveSentinel));
});

test("reports are closed aggregates without identities, fingerprints, times, tags or provider errors", async () => {
  const f = fixture();
  f.state.onSend = () => {
    throw new Error(sensitiveSentinel);
  };
  await f.repair(f.diagnosis);
  const serialized = JSON.stringify(f.state.reports);
  for (const value of [
    sensitiveSentinel,
    f.target.bucketName,
    f.target.expectedBucketOwner,
    f.target.key,
    f.target.versionId,
    f.candidate.sourceSha,
    f.candidate.evidenceSha256,
    oldTime,
    correctedTime,
  ])
    assert.ok(!serialized.includes(value));
  for (const report of f.state.reports)
    assert.deepEqual(Object.keys(report).sort(), [
      "effect",
      "outcome",
      "reason",
      "schemaVersion",
      "writeAttemptsThisCall",
    ]);
});

test("throwing and rejecting reporters cannot trigger resubmission or break cleanup", async () => {
  for (const onReport of [
    () => {
      throw new Error(sensitiveSentinel);
    },
    async () => {
      throw new Error(sensitiveSentinel);
    },
  ]) {
    const f = fixture();
    f.state.onReport = onReport;
    assert.equal((await f.repair(f.diagnosis)).outcome, "repaired");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.state.writes, 1);
    assert.equal(f.state.destroys, 1);
  }
});
