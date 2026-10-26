import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  diagnoseHistoricalCompletion,
  type HistoricalCompletionEvidence,
  type HistoricalCompletionRefusal,
  historicalCompletionDispatchBindingSha256,
  historicalCompletionEvidenceSha256,
  historicalCompletionRepairCandidateSha256,
  readHistoricalCompletionRepairCandidate,
} from "./candidate-deletion-completion-diagnosis.js";

type Mutable<T> = T extends Date
  ? Date
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
type Evidence = Mutable<HistoricalCompletionEvidence>;
const USER = "019c2b89-79b2-7000-8000-000000000001";
const REQUEST = "019c2b89-79b2-7000-8000-000000000002";
const OPERATION = "019c2b89-79b2-7000-8000-000000000003";
const EVENT_ID = "019c2b89-79b2-7000-8000-000000000004";
const OTHER = "019c2b89-79b2-7000-8000-000000000005";
const OWNER = "123456789012";
const CONFIRMED = "2026-09-01T00:00:00.000Z";
const COMPLETED = "2026-09-01T00:01:00.000Z";
const TAGGED = "2026-09-01T00:02:00.000Z";
const OBSERVED = "2026-09-01T00:03:00.000Z";
const BACKUP = "2026-10-06T00:00:00.000Z";
const NOW = new Date("2026-09-01T00:03:01.000Z");
const EVENT = "profile.account-deletion.confirmed.v1";
const DURABLE_BASE =
  "arn:aws:lambda:us-east-2:" +
  OWNER +
  ":function:ai-job-apply-development-profile-readiness-durable";
const ACTIVITY_BASE =
  "arn:aws:lambda:us-east-2:" +
  OWNER +
  ":function:ai-job-apply-development-profile-readiness-activity";
const EXECUTION_ARN =
  DURABLE_BASE + ":12/durable-execution/outbox-" + EVENT_ID + "/synthetic-execution";
const hash = (letter: string) => letter.repeat(64);

// Every identity and timestamp here is synthetic. These tests validate the pure
// collector contract; they do not claim any retained production row was observed.
function fixture(): Evidence {
  return {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    restoreContextSha256: hash("b"),
    configurationSha256: hash("c"),
    markerSnapshotSha256: hash("d"),
    observedAt: OBSERVED,
    marker: {
      bucketName: "synthetic-deletion-proof",
      expectedBucketOwner: OWNER,
      key: "candidate-deletion-recovery/" + REQUEST + ".json",
      versionId: "synthetic-exact-version",
      etag: '"synthetic-etag"',
      contentLength: 1024,
      lastModified: CONFIRMED,
      bodySha256: hash("1"),
      checksumSha256: hash("1"),
      metadataSha256: hash("2"),
      encryptionSha256: hash("3"),
      retentionSha256: hash("4"),
      versionInventorySha256: hash("5"),
      oldTagSet: [
        { Key: "state", Value: "completed" },
        { Key: "completed-at", Value: TAGGED },
      ],
      entry: {
        requestId: REQUEST,
        operationId: OPERATION,
        userId: USER,
        policyVersion: "d1-development-synthetic-v1",
        policySha256: "d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff",
        subjectDigest: hash("6"),
        confirmedAt: CONFIRMED,
        backupExpiresAt: BACKUP,
        completedAt: TAGGED,
      },
    },
    userRows: [
      {
        id: USER,
        accountState: "quarantined",
        createdAt: "2026-08-01T00:00:00.000Z",
        quarantinedAt: CONFIRMED,
      },
    ],
    requestRows: [
      {
        id: REQUEST,
        userId: USER,
        operationId: OPERATION,
        policyVersion: "d1-development-synthetic-v1",
        state: "completed",
        version: 5,
        requestedAt: "2026-08-31T23:59:00.000Z",
        updatedAt: COMPLETED,
        confirmedAt: CONFIRMED,
        backupExpiresAt: BACKUP,
        completedAt: COMPLETED,
        backupExpiredAt: null,
      },
    ],
    ledgerRows: [
      {
        requestId: REQUEST,
        subjectDigest: hash("6"),
        policyVersion: "d1-development-synthetic-v1",
        policySha256: "d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff",
        state: "completed",
        ownerInventory: {
          identity: "completed",
          profile: "completed",
          documents: "completed",
          jobs: "completed",
          matching: "completed",
          billing: "completed",
        },
        subprocessorInventory: {},
        confirmedAt: CONFIRMED,
        backupExpiresAt: BACKUP,
        completedAt: COMPLETED,
        backupExpiredAt: null,
        updatedAt: COMPLETED,
      },
    ],
    operationRows: [
      {
        id: OPERATION,
        userId: USER,
        kind: "account_deletion",
        state: "succeeded",
        result: { resourceId: REQUEST, resourceType: "account_deletion_request" },
        errorCode: null,
        createdAt: "2026-09-01T00:00:01.000Z",
        updatedAt: COMPLETED,
      },
    ],
    dispatchRows: [],
    durable: null,
  };
}
function request(value: Evidence) {
  const row = value.requestRows[0];
  if (!row) throw new Error("SyntheticRequestMissing");
  return row;
}
function ledger(value: Evidence) {
  const row = value.ledgerRows[0];
  if (!row) throw new Error("SyntheticLedgerMissing");
  return row;
}
function operation(value: Evidence) {
  const row = value.operationRows[0];
  if (!row) throw new Error("SyntheticOperationMissing");
  return row;
}
function user(value: Evidence) {
  const row = value.userRows[0];
  if (!row) throw new Error("SyntheticUserMissing");
  return row;
}
function dispatch(value: Evidence) {
  const row = value.dispatchRows[0];
  if (!row) throw new Error("SyntheticDispatchMissing");
  return row;
}
function durable(value: Evidence) {
  if (!value.durable) throw new Error("SyntheticDurableMissing");
  return value.durable;
}
function setTag(value: Evidence, time: string) {
  value.marker.entry.completedAt = time;
  value.marker.oldTagSet = [
    { Key: "state", Value: "completed" },
    { Key: "completed-at", Value: time },
  ];
}
function run(value: unknown, now = NOW) {
  return diagnoseHistoricalCompletion(
    value,
    historicalCompletionEvidenceSha256(value) ?? hash("0"),
    now,
  );
}
function refusal(value: unknown, reason?: HistoricalCompletionRefusal, now = NOW) {
  const result = run(value, now);
  expect(result.outcome).toBe("refused");
  expect(result.dispatchEvidence).toBeNull();
  if (reason && result.outcome === "refused") expect(result.reason).toBe(reason);
  expect(readHistoricalCompletionRepairCandidate(result)).toBeUndefined();
  return result;
}
function withDispatch(value = fixture()): Evidence {
  value.dispatchRows = [
    {
      id: EVENT_ID,
      type: EVENT,
      source: "urn:ai-job-apply:profile-service",
      subject: "account-deletion-request/" + REQUEST,
      dataSchema: "https://schemas.ai-job-apply.internal/events/" + EVENT + ".json",
      data: {
        deletionRequestId: REQUEST,
        operationId: OPERATION,
        policyVersion: "d1-development-synthetic-v1",
      },
      dispatchTarget: "lambda_durable",
      createdAt: "2026-09-01T00:00:01.500000Z",
      publishedAt: "2026-09-01T00:00:02.010Z",
      durableStartedAt: "2026-09-01T00:00:02.010Z",
      nudgeClaimedAt: null,
      durableExecutionName: "outbox-" + EVENT_ID,
      durableExecutionArn: EXECUTION_ARN,
    },
  ];
  return value;
}
function withDurable(value = withDispatch()): Evidence {
  value.durable = {
    execution: {
      DurableExecutionArn: EXECUTION_ARN,
      DurableExecutionName: "outbox-" + EVENT_ID,
      FunctionArn: `${DURABLE_BASE}:12`,
      Version: "12",
      Status: "SUCCEEDED",
      StartTimestamp: "2026-09-01T00:00:02.000Z",
      EndTimestamp: "2026-09-01T00:01:02.000Z",
      InputPayload: JSON.stringify({
        schemaVersion: 1,
        eventId: EVENT_ID,
        eventType: EVENT,
        data: dispatch(value).data,
      }),
      Result: JSON.stringify({
        schemaVersion: 1,
        workflowDefinitionVersion: 1,
        eventId: EVENT_ID,
        resourceId: REQUEST,
        operationId: OPERATION,
        kind: "account_deletion",
        state: "succeeded",
      }),
      ExecutionDataIncluded: true,
    },
    started: {
      EventId: 11,
      Id: "synthetic-completion-operation",
      Name: "candidate-rights.deletion.complete.v1.attempt-1",
      EventType: "ChainedInvokeStarted",
      EventTimestamp: "2026-09-01T00:00:59.900Z",
      ChainedInvokeStartedDetails: {
        FunctionName: ACTIVITY_BASE + ":8",
        Input: {
          Payload: JSON.stringify({
            schemaVersion: 1,
            workflowDefinitionVersion: 1,
            action: "deletion_complete",
            eventId: EVENT_ID,
            resourceId: REQUEST,
            operationId: OPERATION,
            policyVersion: "d1-development-synthetic-v1",
          }),
          Truncated: false,
        },
      },
    },
    succeeded: {
      EventId: 12,
      Id: "synthetic-completion-operation",
      Name: "candidate-rights.deletion.complete.v1.attempt-1",
      EventType: "ChainedInvokeSucceeded",
      EventTimestamp: "2026-09-01T00:01:01.000Z",
      ChainedInvokeSucceededDetails: {
        Result: {
          Payload: JSON.stringify({
            schemaVersion: 1,
            action: "deletion_complete",
            outcome: "completed",
          }),
          Truncated: false,
        },
      },
    },
  };
  return value;
}
function changePayload(value: string, change: (payload: Record<string, unknown>) => void): string {
  const decoded = JSON.parse(value) as Record<string, unknown>;
  change(decoded);
  return JSON.stringify(decoded);
}

describe("historical completion diagnosis: persisted source evidence", () => {
  it("uses the exact agreeing transaction timestamp, with no invented history requirement", () => {
    const value = fixture();
    const result = run(value);
    expect(result).toEqual({
      outcome: "persisted_candidate",
      corroboration: "persisted_transaction",
      dispatchEvidence: null,
      comparison: {
        requestMatchesTag: false,
        ledgerMatchesTag: false,
        persistedPairAgrees: true,
        completionCollisions: ["request_completion_mismatch", "ledger_completion_mismatch"],
      },
    });
    const candidate = readHistoricalCompletionRepairCandidate(result);
    expect(candidate).toEqual({
      sourceSha: value.sourceSha,
      evidenceSha256: historicalCompletionEvidenceSha256(value),
      ...Object.fromEntries(
        Object.entries(value.marker).filter(([key]) => !["entry", "oldTagSet"].includes(key)),
      ),
      oldTagSet: value.marker.oldTagSet,
      correctedCompletedAt: COMPLETED,
    });
    const publicText = JSON.stringify(result);
    for (const privateValue of [
      USER,
      REQUEST,
      OPERATION,
      COMPLETED,
      value.marker.versionId,
      value.marker.bucketName,
      value.sourceSha,
    ]) {
      expect(publicText).not.toContain(privateValue);
    }
  });

  it("binds immutable fingerprints and old tags while preserving the original input", () => {
    const value = fixture();
    const before = structuredClone(value);
    const result = run(value);
    expect(value).toEqual(before);
    const candidate = readHistoricalCompletionRepairCandidate(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate?.oldTagSet)).toBe(true);
    expect(Object.isFrozen(candidate?.oldTagSet[0])).toBe(true);
    value.marker.versionId = "changed";
    setTag(value, COMPLETED);
    expect(candidate?.versionId).toBe(before.marker.versionId);
    expect(candidate?.oldTagSet).toEqual(before.marker.oldTagSet);
  });

  it("returns consistent without minting authority when all completion timestamps agree", () => {
    const value = fixture();
    setTag(value, COMPLETED);
    const result = run(value);
    expect(result.outcome).toBe("consistent");
    expect(result.comparison?.completionCollisions).toEqual([]);
    expect(readHistoricalCompletionRepairCandidate(result)).toBeUndefined();
  });

  it("normalizes six-digit UTC SQL projections without losing millisecond identity", () => {
    const value = fixture();
    for (const row of [request(value), ledger(value), operation(value), user(value)]) {
      for (const [key, item] of Object.entries(row)) {
        if (typeof item === "string" && item.endsWith(".000Z"))
          Object.assign(row, { [key]: item.replace(".000Z", ".000000Z") });
      }
    }
    const result = run(value);
    expect(result.outcome).toBe("persisted_candidate");
    expect(readHistoricalCompletionRepairCandidate(result)?.correctedCompletedAt).toBe(COMPLETED);
  });

  it("accepts actual Date and UTC PostgreSQL timestamp representations", () => {
    const value = fixture();
    request(value).completedAt = new Date(COMPLETED);
    ledger(value).completedAt = "2026-09-01 00:01:00.000000+00";
    operation(value).updatedAt = "2026-09-01 00:01:00+00:00";
    expect(run(value).outcome).toBe("persisted_candidate");
  });

  it.each(["d1", "d2", "d3"] as const)(
    "accepts the source catalog's completed %s owner inventory",
    (version) => {
      const value = fixture();
      if (version !== "d1") ledger(value).ownerInventory.trust = "completed";
      if (version === "d3") ledger(value).ownerInventory.applications = "completed";
      if (version !== "d1") {
        const policyVersion = `${version}-development-synthetic-v1`;
        const policySha256 =
          version === "d2"
            ? "7dbde35dda7542ace2932a68cc8d28618ce14951180f9ab69025b9f511ac35cf"
            : "c47a4637cfd1f008f29147ec610d95d1f7ca9126a5242b8ff38706157a38ab6c";
        Object.assign(value.marker.entry, { policyVersion, policySha256 });
        Object.assign(ledger(value), { policyVersion, policySha256 });
        request(value).policyVersion = policyVersion;
      }
      expect(run(value).outcome).toBe("persisted_candidate");
    },
  );

  it.each([
    [
      "request_completion_mismatch",
      (value: Evidence) => {
        ledger(value).completedAt = TAGGED;
      },
    ],
    [
      "ledger_completion_mismatch",
      (value: Evidence) => {
        request(value).completedAt = TAGGED;
      },
    ],
    [
      "request_timestamp_state_conflict",
      (value: Evidence) => {
        request(value).backupExpiredAt = CONFIRMED;
      },
    ],
    [
      "ledger_timestamp_state_conflict",
      (value: Evidence) => {
        ledger(value).backupExpiredAt = CONFIRMED;
      },
    ],
    [
      "backup_expiry_conflict",
      (value: Evidence) => {
        request(value).state = "backup_expired";
        ledger(value).state = "backup_expired";
        request(value).backupExpiredAt = BACKUP;
        ledger(value).backupExpiredAt = CONFIRMED;
      },
    ],
  ] as const)(
    "identifies the exact existing %s predicate without authorizing another repair",
    (predicate, change) => {
      const value = fixture();
      change(value);
      const result = refusal(value);
      expect(result.comparison?.completionCollisions).toContain(predicate);
    },
  );

  it("refuses nonterminal rows even when they carry no illegal timestamp", () => {
    const value = fixture();
    Object.assign(request(value), { state: "subprocessors_pending", completedAt: null });
    Object.assign(ledger(value), { state: "subprocessors_pending", completedAt: null });
    refusal(value, "nonterminal_state");
  });

  it("refuses a disagreement rather than selecting whichever persisted timestamp matches history", () => {
    const value = withDurable();
    ledger(value).completedAt = "2026-09-01T00:01:00.001Z";
    refusal(value, "persisted_completion_disagreement");
  });

  it("does not collapse distinct PostgreSQL microseconds", () => {
    const value = fixture();
    request(value).completedAt = "2026-09-01T00:01:00.000001Z";
    ledger(value).completedAt = "2026-09-01T00:01:00.000002Z";
    refusal(value, "persisted_completion_disagreement");
  });

  it("refuses a common submillisecond time that the completion tag cannot represent", () => {
    const value = fixture();
    request(value).completedAt = "2026-09-01T00:01:00.000001Z";
    ledger(value).completedAt = "2026-09-01T00:01:00.000001Z";
    operation(value).updatedAt = "2026-09-01T00:01:00.000001Z";
    refusal(value, "timestamp_chronology");
  });

  it.each([
    [
      "missing",
      (value: Evidence) => {
        value.operationRows = [];
      },
    ],
    [
      "duplicate",
      (value: Evidence) => {
        value.operationRows.push(structuredClone(operation(value)));
      },
    ],
    [
      "not succeeded",
      (value: Evidence) => {
        operation(value).state = "running";
      },
    ],
    [
      "wrong kind",
      (value: Evidence) => {
        operation(value).kind = "candidate_data_export";
      },
    ],
    [
      "wrong user",
      (value: Evidence) => {
        operation(value).userId = OTHER;
      },
    ],
    [
      "wrong operation",
      (value: Evidence) => {
        operation(value).id = OTHER;
      },
    ],
    [
      "wrong result owner",
      (value: Evidence) => {
        operation(value).result = { resourceId: OTHER, resourceType: "account_deletion_request" };
      },
    ],
    [
      "wrong result type",
      (value: Evidence) => {
        operation(value).result = { resourceId: REQUEST, resourceType: "candidate_data_export" };
      },
    ],
    [
      "null result",
      (value: Evidence) => {
        operation(value).result = null;
      },
    ],
    [
      "error present",
      (value: Evidence) => {
        operation(value).errorCode = "HistoricalFailure";
      },
    ],
    [
      "later clock",
      (value: Evidence) => {
        operation(value).updatedAt = "2026-09-01T00:01:00.001Z";
      },
    ],
    [
      "earlier clock",
      (value: Evidence) => {
        operation(value).updatedAt = "2026-09-01T00:00:59.999Z";
      },
    ],
    [
      "created before confirmation",
      (value: Evidence) => {
        operation(value).createdAt = "2026-08-31T23:59:59.999Z";
      },
    ],
  ] as const)("requires actual exact operation corroboration: %s", (_label, change) => {
    const value = fixture();
    change(value);
    refusal(value);
  });

  it.each([
    [
      "missing request",
      (value: Evidence) => {
        value.requestRows = [];
      },
    ],
    [
      "duplicate request",
      (value: Evidence) => {
        value.requestRows.push(structuredClone(request(value)));
      },
    ],
    [
      "missing ledger",
      (value: Evidence) => {
        value.ledgerRows = [];
      },
    ],
    [
      "duplicate ledger",
      (value: Evidence) => {
        value.ledgerRows.push(structuredClone(ledger(value)));
      },
    ],
    [
      "missing user",
      (value: Evidence) => {
        value.userRows = [];
      },
    ],
    [
      "duplicate user",
      (value: Evidence) => {
        value.userRows.push(structuredClone(user(value)));
      },
    ],
    [
      "wrong request",
      (value: Evidence) => {
        request(value).id = OTHER;
      },
    ],
    [
      "wrong request owner",
      (value: Evidence) => {
        request(value).userId = OTHER;
      },
    ],
    [
      "wrong request operation",
      (value: Evidence) => {
        request(value).operationId = OTHER;
      },
    ],
    [
      "wrong ledger request",
      (value: Evidence) => {
        ledger(value).requestId = OTHER;
      },
    ],
    [
      "wrong subject",
      (value: Evidence) => {
        ledger(value).subjectDigest = hash("7");
      },
    ],
    [
      "wrong user",
      (value: Evidence) => {
        user(value).id = OTHER;
      },
    ],
    [
      "active user",
      (value: Evidence) => {
        user(value).accountState = "active";
        user(value).quarantinedAt = null;
      },
    ],
    [
      "future quarantine",
      (value: Evidence) => {
        user(value).quarantinedAt = TAGGED;
      },
    ],
    [
      "bad request version",
      (value: Evidence) => {
        request(value).version = 0;
      },
    ],
    [
      "state disagreement",
      (value: Evidence) => {
        ledger(value).state = "backup_expired";
      },
    ],
    [
      "wrong policy",
      (value: Evidence) => {
        value.marker.entry.policyVersion = "unreviewed";
      },
    ],
    [
      "wrong policy bytes",
      (value: Evidence) => {
        value.marker.entry.policySha256 = hash("8");
      },
    ],
    [
      "ledger policy disagreement",
      (value: Evidence) => {
        ledger(value).policySha256 = hash("8");
      },
    ],
    [
      "wrong confirmation",
      (value: Evidence) => {
        request(value).confirmedAt = "2026-09-01T00:00:00.001Z";
      },
    ],
    [
      "wrong ledger confirmation",
      (value: Evidence) => {
        ledger(value).confirmedAt = "2026-09-01T00:00:00.001Z";
      },
    ],
    [
      "wrong horizon",
      (value: Evidence) => {
        value.marker.entry.backupExpiresAt = "2026-10-07T00:00:00.000Z";
      },
    ],
    [
      "wrong request horizon",
      (value: Evidence) => {
        request(value).backupExpiresAt = "2026-10-07T00:00:00.000Z";
      },
    ],
    [
      "wrong ledger horizon",
      (value: Evidence) => {
        ledger(value).backupExpiresAt = "2026-10-07T00:00:00.000Z";
      },
    ],
    [
      "pending owner",
      (value: Evidence) => {
        ledger(value).ownerInventory.profile = "pending";
      },
    ],
    [
      "unknown owner",
      (value: Evidence) => {
        ledger(value).ownerInventory.unknown = "completed";
      },
    ],
    [
      "missing owner",
      (value: Evidence) => {
        delete ledger(value).ownerInventory.billing;
      },
    ],
    [
      "unexpected subprocessor",
      (value: Evidence) => {
        ledger(value).subprocessorInventory.provider = "completed";
      },
    ],
  ] as const)("refuses bound source mismatch: %s", (_label, change) => {
    const value = fixture();
    change(value);
    refusal(value);
  });

  it.each([
    "2026-02-30T00:01:00.000Z",
    "2026-09-01T00:01:00.000-04:00",
    "2026-09-01T00:01:60.000Z",
    "",
    "not-a-time",
  ] as const)("refuses malformed or non-UTC completion time %s", (time) => {
    const value = fixture();
    request(value).completedAt = time;
    refusal(value, "timestamp_invalid");
  });

  it.each([
    [
      "completed before confirmed",
      (value: Evidence) => {
        request(value).completedAt = "2026-08-31T23:59:00.000Z";
        ledger(value).completedAt = request(value).completedAt;
      },
    ],
    [
      "completed after observation",
      (value: Evidence) => {
        request(value).completedAt = "2026-09-01T00:03:00.001Z";
        ledger(value).completedAt = request(value).completedAt;
      },
    ],
    [
      "requested after confirmed",
      (value: Evidence) => {
        request(value).requestedAt = COMPLETED;
      },
    ],
    [
      "request update precedes completion",
      (value: Evidence) => {
        request(value).updatedAt = CONFIRMED;
      },
    ],
    [
      "ledger update future",
      (value: Evidence) => {
        ledger(value).updatedAt = "2026-09-01T00:03:00.001Z";
      },
    ],
  ] as const)("preserves timestamp chronology: %s", (_label, change) => {
    const value = fixture();
    change(value);
    refusal(value, "timestamp_chronology");
  });

  it("refuses correction after the retained backup horizon", () => {
    const value = fixture();
    value.observedAt = "2026-10-06T00:00:01.000Z";
    refusal(value, "retention_expired", new Date("2026-10-06T00:00:02.000Z"));
  });

  it("diagnoses already-consistent coherent backup expiry without repair authority", () => {
    const value = fixture();
    setTag(value, COMPLETED);
    value.observedAt = "2026-10-06T00:00:02.000Z";
    for (const row of [request(value), ledger(value)])
      Object.assign(row, {
        state: "backup_expired",
        backupExpiredAt: "2026-10-06T00:00:01.000Z",
        updatedAt: "2026-10-06T00:00:01.000Z",
      });
    const result = run(value, new Date("2026-10-06T00:00:03.000Z"));
    expect(result.outcome).toBe("consistent");
    expect(readHistoricalCompletionRepairCandidate(result)).toBeUndefined();
  });
});

describe("optional actual dispatch and durable projections", () => {
  it("projects only bounded acknowledgment hashes and exact UTC microsecond maxima", () => {
    const value = withDispatch();
    dispatch(value).createdAt = "2026-09-01T00:00:01.500123Z";
    dispatch(value).publishedAt = "2026-09-01T00:00:02.009123Z";
    const result = run(value);
    expect(result.dispatchEvidence).toEqual({
      status: "acknowledged_unclaimed",
      attemptCount: 1,
      bindingSha256: [
        historicalCompletionDispatchBindingSha256("outbox-" + EVENT_ID, EXECUTION_ARN),
      ],
      latestCreatedAt: "2026-09-01T00:00:01.500123Z",
      latestAcknowledgedAt: "2026-09-01T00:00:02.010000Z",
    });
    expect(Object.isFrozen(result.dispatchEvidence)).toBe(true);
    expect(Object.isFrozen(result.dispatchEvidence?.bindingSha256)).toBe(true);
    for (const privateValue of [EVENT_ID, EXECUTION_ARN, REQUEST, OPERATION, OWNER])
      expect(JSON.stringify(result)).not.toContain(privateValue);
  });
  it.each([2, 3])("retains every one of %i unique attempts with sorted binding hashes", (count) => {
    const value = withDispatch();
    const first = dispatch(value);
    value.dispatchRows = Array.from({ length: count }, (_, index) => {
      const id = EVENT_ID.slice(0, -1) + String(index + 4);
      return {
        ...structuredClone(first),
        id,
        durableExecutionName: "outbox-" + id,
        durableExecutionArn: EXECUTION_ARN.replace(EVENT_ID, id),
        createdAt: "2026-09-01T00:00:01.50" + index + "000Z",
        durableStartedAt: "2026-09-01T00:00:02.01" + index + "000Z",
      };
    });
    const result = run(value);
    expect(result.outcome).toBe("persisted_candidate");
    expect(result.dispatchEvidence?.attemptCount).toBe(count);
    expect(result.dispatchEvidence?.bindingSha256).toEqual(
      value.dispatchRows
        .map((row) =>
          historicalCompletionDispatchBindingSha256(
            row.durableExecutionName,
            row.durableExecutionArn,
          ),
        )
        .sort(),
    );
    expect(result.dispatchEvidence?.latestCreatedAt).toBe(
      "2026-09-01T00:00:01.50" + (count - 1) + "000Z",
    );
    expect(result.dispatchEvidence?.latestAcknowledgedAt).toBe(
      "2026-09-01T00:00:02.01" + (count - 1) + "000Z",
    );
  });
  it.each(["createdAt", "publishedAt", "durableStartedAt"] as const)(
    "refuses sub-microsecond aggregate maximum %s without rounding",
    (key) => {
      const value = withDispatch();
      dispatch(value)[key] =
        key === "createdAt" ? "2026-09-01T00:00:01.500000001Z" : "2026-09-01T00:00:02.010000001Z";
      refusal(value, "dispatch_corroboration_missing");
    },
  );
  it("binds the exact name/qualified ARN pair with fixed checksum framing, not authority", () => {
    const name = "outbox-" + EVENT_ID;
    const digest = historicalCompletionDispatchBindingSha256(name, EXECUTION_ARN);
    expect(digest).toBe(
      createHash("sha256")
        .update("candidate-deletion-completion-dispatch-binding/v1\n")
        .update(JSON.stringify([name, EXECUTION_ARN]))
        .digest("hex"),
    );
    expect(
      historicalCompletionDispatchBindingSha256(name, EXECUTION_ARN.replace(":12/", ":13/")),
    ).not.toBe(digest);
    expect(readHistoricalCompletionRepairCandidate({ bindingSha256: digest })).toBeUndefined();
  });
  it.each([
    ["outbox-" + OTHER, EXECUTION_ARN],
    ["wrong-" + EVENT_ID, EXECUTION_ARN],
    ["outbox-" + EVENT_ID, EXECUTION_ARN.replace(":12/", ":latest/")],
    ["outbox-" + EVENT_ID, EXECUTION_ARN.replace("us-east-2", "us-east-1")],
    ["outbox-" + EVENT_ID, EXECUTION_ARN + "/extra"],
    [null, EXECUTION_ARN],
    ["outbox-" + EVENT_ID, null],
  ])("does not checksum a malformed execution binding %i", (name, arn) => {
    expect(historicalCompletionDispatchBindingSha256(name, arn)).toBeUndefined();
  });
  it("does not inspect a hostile object passed to the checksum helper", () => {
    const accessed = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    const hostile = new Proxy({}, { get: accessed, getPrototypeOf: accessed, ownKeys: accessed });
    expect(historicalCompletionDispatchBindingSha256(hostile, EXECUTION_ARN)).toBeUndefined();
    expect(
      historicalCompletionDispatchBindingSha256("outbox-" + EVENT_ID, hostile),
    ).toBeUndefined();
    expect(accessed).not.toHaveBeenCalled();
  });
  it("labels start acknowledgment only as dispatch corroboration", () => {
    const result = run(withDispatch());
    expect(result.outcome).toBe("persisted_candidate");
    if (result.outcome === "persisted_candidate")
      expect(result.corroboration).toBe("persisted_transaction_and_dispatch");
  });
  it("accepts the actual bound completed invocation pair without inventing a result timestamp", () => {
    const result = run(withDurable());
    expect(result.outcome).toBe("persisted_candidate");
    if (result.outcome === "persisted_candidate")
      expect(result.corroboration).toBe("persisted_transaction_and_durable");
    expect(readHistoricalCompletionRepairCandidate(result)?.correctedCompletedAt).toBe(COMPLETED);
  });
  it("accepts matching valid optional traceparent fields from the existing payloads", () => {
    const value = withDurable();
    const traceparent = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
    const proof = durable(value);
    proof.execution.InputPayload = changePayload(proof.execution.InputPayload, (input) => {
      input.traceparent = traceparent;
    });
    const call = proof.started.ChainedInvokeStartedDetails.Input;
    call.Payload = changePayload(call.Payload, (input) => {
      input.traceparent = traceparent;
    });
    expect(run(value).outcome).toBe("persisted_candidate");
  });
  it.each([
    [
      "duplicate dispatch",
      (value: Evidence) => {
        value.dispatchRows.push(structuredClone(dispatch(value)));
      },
    ],
    [
      "too many dispatches",
      (value: Evidence) => {
        value.dispatchRows = Array.from({ length: 4 }, () => structuredClone(dispatch(value)));
      },
    ],
    [
      "wrong request",
      (value: Evidence) => {
        dispatch(value).data.deletionRequestId = OTHER;
      },
    ],
    [
      "wrong operation",
      (value: Evidence) => {
        dispatch(value).data.operationId = OTHER;
      },
    ],
    [
      "wrong event",
      (value: Evidence) => {
        dispatch(value).type = "profile.data-export.requested.v1";
      },
    ],
    [
      "wrong source",
      (value: Evidence) => {
        dispatch(value).source = "urn:other";
      },
    ],
    [
      "wrong subject",
      (value: Evidence) => {
        dispatch(value).subject = "account-deletion-request/" + OTHER;
      },
    ],
    [
      "wrong schema",
      (value: Evidence) => {
        dispatch(value).dataSchema = "https://example.invalid/other";
      },
    ],
    [
      "wrong target",
      (value: Evidence) => {
        dispatch(value).dispatchTarget = "none";
      },
    ],
    [
      "not acknowledged",
      (value: Evidence) => {
        dispatch(value).durableStartedAt = null;
      },
    ],
    [
      "not published",
      (value: Evidence) => {
        dispatch(value).publishedAt = null;
      },
    ],
    [
      "claimed acknowledged attempt",
      (value: Evidence) => {
        dispatch(value).nudgeClaimedAt = "2026-09-01T00:00:02.000000Z";
      },
    ],
    [
      "unknown claim state",
      (value: Evidence) => {
        Reflect.deleteProperty(dispatch(value), "nudgeClaimedAt");
      },
    ],
    [
      "wrong dispatch policy",
      (value: Evidence) => {
        dispatch(value).data.policyVersion = "different-policy";
      },
    ],
    [
      "malformed persisted data",
      (value: Evidence) => {
        Object.assign(dispatch(value), { data: JSON.stringify(dispatch(value).data) });
      },
    ],
    [
      "malformed acknowledged timestamp",
      (value: Evidence) => {
        dispatch(value).publishedAt = "2026-02-30T00:00:02.000000Z";
      },
    ],
    [
      "future acknowledged timestamp",
      (value: Evidence) => {
        dispatch(value).publishedAt = "2026-09-01T00:03:00.000001Z";
      },
    ],
    [
      "unpublished additional attempt",
      (value: Evidence) => {
        const next = structuredClone(dispatch(value));
        next.id = OTHER;
        next.durableExecutionName = "outbox-" + OTHER;
        next.durableExecutionArn = EXECUTION_ARN.replace(EVENT_ID, OTHER);
        next.publishedAt = null;
        value.dispatchRows.push(next);
      },
    ],
    [
      "wrong name",
      (value: Evidence) => {
        dispatch(value).durableExecutionName = "outbox-" + OTHER;
      },
    ],
    [
      "wrong account",
      (value: Evidence) => {
        dispatch(value).durableExecutionArn = EXECUTION_ARN.replace(OWNER, "999999999999");
      },
    ],
    [
      "wrong region",
      (value: Evidence) => {
        dispatch(value).durableExecutionArn = EXECUTION_ARN.replace("us-east-2", "us-east-1");
      },
    ],
    [
      "wrong function",
      (value: Evidence) => {
        dispatch(value).durableExecutionArn = EXECUTION_ARN.replace(
          "readiness-durable",
          "other-durable",
        );
      },
    ],
    [
      "unqualified function",
      (value: Evidence) => {
        dispatch(value).durableExecutionArn = EXECUTION_ARN.replace(":12/", "/");
      },
    ],
    [
      "forged completion column",
      (value: Evidence) => {
        Object.assign(dispatch(value), { completedAt: COMPLETED });
      },
    ],
  ] as const)("refuses supplied dispatch conflict: %s", (_label, change) => {
    const value = withDispatch();
    change(value);
    refusal(value, "dispatch_corroboration_missing");
  });
  it.each([
    [
      "no dispatch binding",
      (value: Evidence) => {
        value.dispatchRows = [];
      },
    ],
    [
      "execution failed",
      (value: Evidence) => {
        durable(value).execution.Status = "FAILED";
      },
    ],
    [
      "omitted data",
      (value: Evidence) => {
        durable(value).execution.ExecutionDataIncluded = false;
      },
    ],
    [
      "wrong version",
      (value: Evidence) => {
        durable(value).execution.Version = "13";
      },
    ],
    [
      "another version of the function",
      (value: Evidence) => {
        durable(value).execution.FunctionArn = `${DURABLE_BASE}:13`;
      },
    ],
    [
      "wrong result",
      (value: Evidence) => {
        const proof = durable(value);
        proof.execution.Result = changePayload(proof.execution.Result, (data) => {
          data.resourceId = OTHER;
        });
      },
    ],
    [
      "invented result timestamp",
      (value: Evidence) => {
        const proof = durable(value);
        proof.execution.Result = changePayload(proof.execution.Result, (data) => {
          data.completedAt = COMPLETED;
        });
      },
    ],
    [
      "wrong action",
      (value: Evidence) => {
        const input = durable(value).started.ChainedInvokeStartedDetails.Input;
        input.Payload = changePayload(input.Payload, (data) => {
          data.action = "deletion_record_recovery";
        });
      },
    ],
    [
      "truncated input",
      (value: Evidence) => {
        durable(value).started.ChainedInvokeStartedDetails.Input.Truncated = true;
      },
    ],
    [
      "truncated result",
      (value: Evidence) => {
        durable(value).succeeded.ChainedInvokeSucceededDetails.Result.Truncated = true;
      },
    ],
    [
      "mismatched invocation",
      (value: Evidence) => {
        durable(value).succeeded.Id = "other";
      },
    ],
    [
      "wrong attempt",
      (value: Evidence) => {
        durable(value).started.Name = "candidate-rights.deletion.complete.v1.attempt-6";
      },
    ],
    [
      "event order",
      (value: Evidence) => {
        durable(value).succeeded.EventId = 10;
      },
    ],
    [
      "late retry window",
      (value: Evidence) => {
        durable(value).started.EventTimestamp = "2026-09-01T00:01:00.001Z";
      },
    ],
    [
      "completion after invocation",
      (value: Evidence) => {
        durable(value).succeeded.EventTimestamp = "2026-09-01T00:00:59.999Z";
      },
    ],
    [
      "workflow ended before activity",
      (value: Evidence) => {
        durable(value).execution.EndTimestamp = COMPLETED;
      },
    ],
    [
      "workflow future",
      (value: Evidence) => {
        durable(value).execution.EndTimestamp = "2026-09-01T00:03:00.001Z";
      },
    ],
    [
      "arbitrary new metadata",
      (value: Evidence) => {
        Object.assign(durable(value).execution, { CompletedAt: COMPLETED });
      },
    ],
    [
      "invalid optional trace",
      (value: Evidence) => {
        const proof = durable(value);
        proof.execution.InputPayload = changePayload(proof.execution.InputPayload, (data) => {
          data.traceparent = "bad";
        });
      },
    ],
  ] as const)("refuses supplied durable conflict: %s", (_label, change) => {
    const value = withDurable();
    change(value);
    refusal(value);
  });
  it("does not ignore conflicting optional proof merely because the tag already agrees", () => {
    const value = withDurable();
    setTag(value, COMPLETED);
    durable(value).execution.Status = "FAILED";
    refusal(value);
  });
});

describe("bounded private evidence and authority", () => {
  it("shares a canonical candidate checksum without minting provenance authority", () => {
    const result = run(fixture());
    const candidate = readHistoricalCompletionRepairCandidate(result);
    expect(candidate).toBeDefined();
    const sha = historicalCompletionRepairCandidateSha256(candidate);
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);
    const copy = structuredClone(candidate);
    expect(historicalCompletionRepairCandidateSha256(copy)).toBe(sha);
    expect(readHistoricalCompletionRepairCandidate(copy)).toBeUndefined();
    expect(
      historicalCompletionRepairCandidateSha256({
        ...copy,
        oldTagSet: [...(copy?.oldTagSet ?? [])].reverse(),
      }),
    ).toBe(sha);
    expect(historicalCompletionRepairCandidateSha256({ ...copy, versionId: "changed" })).not.toBe(
      sha,
    );
    expect(historicalCompletionRepairCandidateSha256({ ...copy, extra: true })).toBeUndefined();
  });

  it("does not evaluate hostile candidate properties during checksum validation", () => {
    const get = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    const candidate = { ...readHistoricalCompletionRepairCandidate(run(fixture())) };
    Object.defineProperty(candidate, "versionId", { get, enumerable: true });
    expect(historicalCompletionRepairCandidateSha256(candidate)).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it("canonicalizes property ordering but domain-binds all source/context/version inputs", () => {
    const value = fixture();
    const original = historicalCompletionEvidenceSha256(value);
    expect(
      historicalCompletionEvidenceSha256(Object.fromEntries(Object.entries(value).reverse())),
    ).toBe(original);
    for (const key of [
      "sourceSha",
      "restoreContextSha256",
      "configurationSha256",
      "markerSnapshotSha256",
    ] as const) {
      const altered = fixture();
      altered[key] = key === "sourceSha" ? "b".repeat(40) : hash("e");
      expect(historicalCompletionEvidenceSha256(altered)).not.toBe(original);
      expect(diagnoseHistoricalCompletion(altered, original ?? "", NOW)).toEqual({
        outcome: "refused",
        reason: "proof_binding_mismatch",
        dispatchEvidence: null,
      });
    }
    const altered = fixture();
    altered.marker.versionId = "another-version";
    expect(diagnoseHistoricalCompletion(altered, original ?? "", NOW)).toEqual({
      outcome: "refused",
      reason: "proof_binding_mismatch",
      dispatchEvidence: null,
    });
  });
  it.each(["restoreContextSha256", "configurationSha256", "markerSnapshotSha256"] as const)(
    "requires a well-formed %s",
    (key) => {
      const value = fixture();
      value[key] = "invalid";
      refusal(value);
    },
  );
  it.each([
    ["stale", "2026-09-01T00:08:00.001Z"],
    ["future observation", "2026-09-01T00:02:59.999Z"],
  ] as const)("refuses %s proof", (_label, now) => {
    refusal(fixture(), "proof_expired", new Date(now));
  });
  it.each([
    [
      "version null",
      (value: Evidence) => {
        value.marker.versionId = "null";
      },
    ],
    [
      "wrong key",
      (value: Evidence) => {
        value.marker.key = "candidate-deletion-recovery/" + OTHER + ".json";
      },
    ],
    [
      "wrong owner shape",
      (value: Evidence) => {
        value.marker.expectedBucketOwner = "not-owner";
      },
    ],
    [
      "invalid bucket",
      (value: Evidence) => {
        value.marker.bucketName = "https://example.invalid";
      },
    ],
    [
      "IP bucket",
      (value: Evidence) => {
        value.marker.bucketName = "127.0.0.1";
      },
    ],
    [
      "unquoted etag",
      (value: Evidence) => {
        value.marker.etag = "unquoted";
      },
    ],
    [
      "oversized body",
      (value: Evidence) => {
        value.marker.contentLength = 16385;
      },
    ],
    [
      "empty body",
      (value: Evidence) => {
        value.marker.contentLength = 0;
      },
    ],
    [
      "bad hash",
      (value: Evidence) => {
        value.marker.metadataSha256 = "invalid";
      },
    ],
    [
      "checksum mismatch",
      (value: Evidence) => {
        value.marker.checksumSha256 = hash("0");
      },
    ],
    [
      "future last modified",
      (value: Evidence) => {
        value.marker.lastModified = "2026-09-01T00:03:00.001Z";
      },
    ],
    [
      "extra tag",
      (value: Evidence) => {
        value.marker.oldTagSet.push({ Key: "extra", Value: "value" });
      },
    ],
    [
      "missing tag",
      (value: Evidence) => {
        value.marker.oldTagSet.pop();
      },
    ],
    [
      "duplicate tag",
      (value: Evidence) => {
        value.marker.oldTagSet = [
          { Key: "state", Value: "completed" },
          { Key: "state", Value: "completed" },
        ];
      },
    ],
    [
      "bad state tag",
      (value: Evidence) => {
        value.marker.oldTagSet = [
          { Key: "state", Value: "pending" },
          { Key: "completed-at", Value: TAGGED },
        ];
      },
    ],
    [
      "entry tag disagreement",
      (value: Evidence) => {
        value.marker.entry.completedAt = COMPLETED;
      },
    ],
    [
      "noncanonical tag time",
      (value: Evidence) => {
        setTag(value, "2026-09-01T00:02:00.000000Z");
      },
    ],
    [
      "unknown input",
      (value: Evidence) => {
        Object.assign(value, { extra: true });
      },
    ],
    [
      "unknown row",
      (value: Evidence) => {
        Object.assign(request(value), { email: "synthetic@example.invalid" });
      },
    ],
  ] as const)("refuses marker/projection drift: %s", (_label, change) => {
    const value = fixture();
    change(value);
    refusal(value);
  });
  it("never evaluates getters, toJSON, or arbitrary error fields while refusing input", () => {
    const getter = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    const value = fixture();
    Object.defineProperty(value.marker, "versionId", { get: getter, enumerable: true });
    refusal(value, "input_invalid");
    expect(getter).not.toHaveBeenCalled();
    const serialize = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    const withSerializer = Object.assign(fixture(), { toJSON: serialize });
    refusal(withSerializer, "input_invalid");
    expect(serialize).not.toHaveBeenCalled();
  });
  it("rejects cycles, sparse arrays, nonplain objects, symbol fields and oversized packets", () => {
    const cycle = { self: null as unknown };
    cycle.self = cycle;
    const sparse = fixture();
    sparse.requestRows = new Array(1);
    const symbol = fixture();
    Object.defineProperty(symbol, Symbol("unexpected"), { value: true });
    const large = fixture();
    large.marker.versionId = "x".repeat(8193);
    for (const value of [cycle, sparse, symbol, large, new Map(), null, [], true])
      refusal(value, "input_invalid");
  });
  it("bounds node count before traversing a large nested structure", () => {
    const value = Array.from({ length: 25 }, () =>
      Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => null)),
    );
    expect(historicalCompletionEvidenceSha256(value)).toBeUndefined();
    refusal(value, "input_invalid");
  });
  it("never mints authority for copied, forged or hostile result objects", () => {
    const result = run(fixture());
    const get = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    const hostile = new Proxy({}, { get, getOwnPropertyDescriptor: get, ownKeys: get });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [
      { ...result },
      structuredClone(result),
      { outcome: "persisted_candidate" },
      hostile,
      revoked.proxy,
      null,
      undefined,
      "candidate",
      new Error("candidate"),
    ]) {
      expect(readHistoricalCompletionRepairCandidate(value)).toBeUndefined();
    }
    expect(get).not.toHaveBeenCalled();
    expect(readHistoricalCompletionRepairCandidate(result)).toBeDefined();
  });
});
