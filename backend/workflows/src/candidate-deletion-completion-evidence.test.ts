import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { describe, expect, it, vi } from "vitest";
import {
  diagnoseHistoricalCompletion,
  historicalCompletionEvidenceSha256,
} from "./candidate-deletion-completion-diagnosis.js";
import {
  collectHistoricalCompletionEvidence,
  type HistoricalCompletionEvidenceTarget,
} from "./candidate-deletion-completion-evidence.js";

type Row = Record<string, unknown>;
const confirmedAt = "2026-09-01T00:00:00.000Z";
const completedAt = "2026-09-01T00:01:00.000000Z";
const backupExpiresAt = "2026-10-06T00:00:00.000Z";
const now = new Date("2026-09-01T00:03:00.000Z");
const id = (n: number) => "019c2b89-79b2-7000-8000-" + String(n).padStart(12, "0");
const error = "CandidateDeletionCompletionEvidenceRejected";
function fixture() {
  const entry = {
    userId: id(1),
    requestId: id(2),
    operationId: id(3),
    subjectDigest: "a".repeat(64),
    policyVersion: "d1-development-synthetic-v1",
    policySha256: "d9a04c500445c83fe75cc7666f5fc22351431ce4913d81da39abf8aaedd06fff",
    confirmedAt,
    backupExpiresAt,
    completedAt: "2026-09-01T00:02:00.000Z",
  };
  const target: HistoricalCompletionEvidenceTarget = {
    sourceSha: "b".repeat(40),
    restoreContextSha256: "c".repeat(64),
    configurationSha256: "d".repeat(64),
    markerSnapshotSha256: "e".repeat(64),
    marker: {
      bucketName: "synthetic-completion-ledger",
      expectedBucketOwner: "123456789012",
      key: "candidate-deletion-recovery/" + entry.requestId + ".json",
      versionId: "synthetic-version",
      etag: '"synthetic-etag"',
      contentLength: 1024,
      lastModified: confirmedAt,
      bodySha256: "1".repeat(64),
      checksumSha256: "1".repeat(64),
      metadataSha256: "2".repeat(64),
      encryptionSha256: "3".repeat(64),
      retentionSha256: "4".repeat(64),
      versionInventorySha256: "5".repeat(64),
      oldTagSet: [
        { Key: "state", Value: "completed" },
        { Key: "completed-at", Value: entry.completedAt },
      ],
      entry,
    },
  };
  return {
    target,
    users: [
      {
        id: entry.userId,
        accountState: "quarantined",
        createdAt: "2026-08-01T00:00:00.000000Z",
        quarantinedAt: "2026-09-01T00:00:00.000000Z",
      },
    ] as Row[],
    requests: [
      {
        id: entry.requestId,
        userId: entry.userId,
        operationId: entry.operationId,
        policyVersion: entry.policyVersion,
        state: "completed",
        version: 5,
        requestedAt: "2026-08-31T23:59:00.123456Z",
        updatedAt: completedAt,
        confirmedAt: "2026-09-01T00:00:00.000000Z",
        backupExpiresAt: "2026-10-06T00:00:00.000000Z",
        completedAt,
        backupExpiredAt: null,
      },
    ] as Row[],
    operations: [
      {
        id: entry.operationId,
        userId: entry.userId,
        kind: "account_deletion",
        state: "succeeded",
        result: { resourceId: entry.requestId, resourceType: "account_deletion_request" },
        errorCode: null,
        createdAt: "2026-09-01T00:00:00.000000Z",
        updatedAt: completedAt,
      },
    ] as Row[],
    ledgers: [
      {
        requestId: entry.requestId,
        subjectDigest: entry.subjectDigest,
        policyVersion: entry.policyVersion,
        policySha256: entry.policySha256,
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
        confirmedAt: "2026-09-01T00:00:00.000000Z",
        backupExpiresAt: "2026-10-06T00:00:00.000000Z",
        completedAt,
        backupExpiredAt: null,
        updatedAt: completedAt,
      },
    ] as Row[],
    dispatches: [] as Row[],
  };
}
function acknowledgedDispatch(target: HistoricalCompletionEvidenceTarget, eventNumber = 4): Row {
  const eventId = id(eventNumber);
  const entry = target.marker.entry;
  return {
    id: eventId,
    type: "profile.account-deletion.confirmed.v1",
    source: "urn:ai-job-apply:profile-service",
    subject: "account-deletion-request/" + entry.requestId,
    dataSchema:
      "https://schemas.ai-job-apply.internal/events/profile.account-deletion.confirmed.v1.json",
    data: {
      deletionRequestId: entry.requestId,
      operationId: entry.operationId,
      policyVersion: entry.policyVersion,
    },
    dispatchTarget: "lambda_durable",
    createdAt: "2026-09-01T00:00:00.500000Z",
    publishedAt: "2026-09-01T00:00:01.001000Z",
    durableStartedAt: "2026-09-01T00:00:01.002000Z",
    nudgeClaimedAt: null,
    durableExecutionName: "outbox-" + eventId,
    durableExecutionArn:
      "arn:aws:lambda:us-east-2:" +
      target.marker.expectedBucketOwner +
      ":function:ai-job-apply-development-profile-readiness-durable:12/durable-execution/outbox-" +
      eventId +
      "/synthetic-execution",
  };
}
function setup(value = fixture()) {
  const queries: { query: string; values: string[] }[] = [];
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const hooks: {
    before?: (query: string) => void;
    during?: (query: string) => Promise<void>;
    failure?: unknown;
    afterTransaction?: () => void;
  } = {};
  const unsafe = vi.fn((query: string, values: string[]) => {
    queries.push({ query, values });
    hooks.before?.(query);
    const cancel = vi.fn();
    cancels.push(cancel);
    const pending = (async () => {
      if (hooks.failure !== undefined) throw hooks.failure;
      await hooks.during?.(query);
      if (query.startsWith("SET LOCAL")) return [];
      if (query.includes("FROM identity.users")) return value.users;
      if (query.includes("FROM profile.account_deletion_requests")) return value.requests;
      if (query.includes("FROM platform.operations")) return value.operations;
      if (query.includes("FROM privacy.account_deletion_ledger")) return value.ledgers;
      if (query.includes("FROM platform.outbox_events")) return value.dispatches;
      throw new Error("SyntheticUnexpectedQuery");
    })();
    return Object.assign(pending, { cancel });
  });
  const sql = { unsafe };
  const begin = vi.fn(
    async (_mode: string, callback: (transaction: typeof sql) => Promise<unknown>) => {
      const result = await callback(sql);
      hooks.afterTransaction?.();
      return result;
    },
  );
  const database = { client: { unsafe, begin } } as unknown as DatabaseHandle;
  const controller = new AbortController();
  const collect = (clock = () => now) =>
    collectHistoricalCompletionEvidence(database, value.target, controller.signal, clock);
  return { value, queries, cancels, hooks, unsafe, begin, controller, collect };
}

describe("private restored completion evidence collector", () => {
  it("uses one read-only repeatable-read transaction and only seven fixed bounded reads/settings", async () => {
    const h = setup();
    const evidence = await h.collect();
    expect(h.begin).toHaveBeenCalledExactlyOnceWith(
      "read only isolation level repeatable read",
      expect.any(Function),
    );
    expect(h.queries).toHaveLength(7);
    expect(h.queries.slice(0, 2).map((item) => item.query)).toEqual([
      "SET LOCAL statement_timeout = '15s'",
      "SET LOCAL lock_timeout = '2s'",
    ]);
    for (const { query } of h.queries.slice(2, 6)) {
      expect(query).toMatch(/^SELECT /u);
      expect(query).toMatch(/ LIMIT 2$/u);
      expect(query).not.toMatch(/\b(?:FOR UPDATE|INSERT|DELETE|UPSERT|ALTER|COPY|CREATE|CALL)\b/u);
      expect(query).toContain(" AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
    }
    expect(evidence.dispatchRows).toEqual([]);
    expect(evidence.durable).toBeNull();
    const proof = historicalCompletionEvidenceSha256(evidence);
    expect(diagnoseHistoricalCompletion(evidence, proof ?? "", now).outcome).toBe(
      "persisted_candidate",
    );
  });
  it("preserves original request/operation/subject collision selectors without interpolating identifiers", async () => {
    const h = setup();
    await h.collect();
    const entry = h.value.target.marker.entry;
    expect(h.queries[2]?.values).toEqual([entry.userId]);
    expect(h.queries[3]?.values).toEqual([entry.requestId, entry.operationId, entry.userId]);
    expect(h.queries[3]?.query).toContain(
      "WHERE id = $1::uuid OR operation_id = $2::uuid OR (user_id = $3::uuid AND state IN ('requested', 'quarantined', 'active_systems_deleted', 'subprocessors_pending'))",
    );
    expect(h.queries[4]?.values).toEqual([entry.operationId]);
    expect(h.queries[5]?.values).toEqual([entry.requestId, entry.subjectDigest]);
    expect(h.queries[5]?.query).toContain("WHERE request_id = $1::uuid OR subject_digest = $2");
    expect(h.queries[6]?.values).toEqual([entry.operationId]);
    expect(h.queries[6]?.query).toMatch(
      / FROM platform\.outbox_events WHERE data ->> 'operationId' = \$1 ORDER BY created_at, id LIMIT 4$/u,
    );
    expect(h.queries[6]?.query).not.toMatch(
      /\b(?:FOR UPDATE|INSERT|DELETE|UPSERT|ALTER|COPY|CREATE|CALL|AND|OR)\b/u,
    );
    expect(h.queries[6]?.query).toContain("nudge_claimed_at");
    expect(h.queries[6]?.query).not.toContain("nudge_next_attempt_at");
    for (const { query } of h.queries)
      for (const value of [entry.userId, entry.requestId, entry.operationId, entry.subjectDigest])
        expect(query).not.toContain(value);
  });
  it("preserves six-digit microseconds/nulls and JSON values without date conversion or unwrapping", async () => {
    const h = setup();
    const request = h.value.requests[0];
    const ledger = h.value.ledgers[0];
    if (!request || !ledger) throw new Error("SyntheticMissingRows");
    request.completedAt = "2026-09-01T00:01:00.000001Z";
    ledger.ownerInventory = JSON.stringify(ledger.ownerInventory);
    const evidence = await h.collect();
    expect(evidence.requestRows[0]?.completedAt).toBe(request.completedAt);
    expect(evidence.requestRows[0]?.backupExpiredAt).toBeNull();
    expect(evidence.ledgerRows[0]?.ownerInventory).toBe(ledger.ownerInventory);
  });
  it("strips driver array metadata without modifying source row arrays", async () => {
    const h = setup();
    Object.assign(h.value.requests, { count: 1, command: "SELECT", columns: ["id"] });
    const evidence = await h.collect();
    expect(Object.keys(evidence.requestRows)).toEqual(["0"]);
    expect(Object.hasOwn(h.value.requests, "columns")).toBe(true);
  });
  it("privately preserves acknowledged operation attempts and exact timestamp precision", async () => {
    const h = setup();
    h.value.dispatches = [acknowledgedDispatch(h.value.target)];
    const before = structuredClone(h.value.dispatches);
    const evidence = await h.collect();
    expect(evidence.dispatchRows).toEqual(before);
    expect(h.value.dispatches).toEqual(before);
    expect(evidence.dispatchRows[0]?.createdAt).toBe("2026-09-01T00:00:00.500000Z");
    const result = diagnoseHistoricalCompletion(
      evidence,
      historicalCompletionEvidenceSha256(evidence) ?? "",
      now,
    );
    expect(result).toMatchObject({
      outcome: "persisted_candidate",
      dispatchEvidence: {
        status: "acknowledged_unclaimed",
        attemptCount: 1,
        latestCreatedAt: "2026-09-01T00:00:00.500000Z",
        latestAcknowledgedAt: "2026-09-01T00:00:01.002000Z",
      },
    });
  });
  it("retains four exact-operation rows as a refusal sentinel rather than truncating three", async () => {
    const h = setup();
    h.value.dispatches = Array.from({ length: 4 }, (_, index) =>
      acknowledgedDispatch(h.value.target, index + 4),
    );
    const evidence = await h.collect();
    expect(evidence.dispatchRows).toHaveLength(4);
    expect(
      diagnoseHistoricalCompletion(
        evidence,
        historicalCompletionEvidenceSha256(evidence) ?? "",
        now,
      ),
    ).toMatchObject({
      outcome: "refused",
      reason: "dispatch_corroboration_missing",
      dispatchEvidence: null,
    });
  });
  it.each(["pending", "wrong event", "JSON string"])(
    "never filters an inconvenient %s same-operation row",
    async (kind) => {
      const h = setup();
      const row = acknowledgedDispatch(h.value.target);
      if (kind === "pending") row.publishedAt = null;
      if (kind === "wrong event") row.type = "unexpected-event";
      if (kind === "JSON string") row.data = JSON.stringify(row.data);
      h.value.dispatches = [row];
      const evidence = await h.collect();
      expect(evidence.dispatchRows).toHaveLength(1);
      expect(
        diagnoseHistoricalCompletion(
          evidence,
          historicalCompletionEvidenceSha256(evidence) ?? "",
          now,
        ),
      ).toMatchObject({
        outcome: "refused",
        reason: "dispatch_corroboration_missing",
        dispatchEvidence: null,
      });
    },
  );
  it("rejects a driver violating the dispatch LIMIT 4 bound", async () => {
    const h = setup();
    h.value.dispatches = Array.from({ length: 5 }, () => ({}));
    await expect(h.collect()).rejects.toThrow(error);
  });
  it("cancels the exact-operation dispatch read before any evidence is returned", async () => {
    const h = setup();
    h.hooks.during = async (query) => {
      if (query.includes("FROM platform.outbox_events")) h.controller.abort();
    };
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.cancels[6]).toHaveBeenCalledOnce();
    expect(h.queries).toHaveLength(7);
  });
  it.each(["users", "requests", "operations", "ledgers"] as const)(
    "retains zero/two %s rows so the pure authority check refuses cardinality",
    async (key) => {
      for (const count of [0, 2]) {
        const value = fixture();
        const row = value[key][0];
        if (!row) throw new Error("SyntheticMissingRow");
        value[key] = Array.from({ length: count }, () => structuredClone(row));
        const h = setup(value);
        const evidence = await h.collect();
        const result = diagnoseHistoricalCompletion(
          evidence,
          historicalCompletionEvidenceSha256(evidence) ?? "",
          now,
        );
        expect(result.outcome).toBe("refused");
      }
    },
  );
  it.each(["users", "requests", "operations", "ledgers"] as const)(
    "rejects a client violating the LIMIT 2 bound for %s",
    async (key) => {
      const value = fixture();
      value[key] = [{}, {}, {}];
      await expect(setup(value).collect()).rejects.toThrow(new RegExp("^" + error + "$", "u"));
    },
  );
  it("checks cancellation before starting the transaction", async () => {
    const h = setup();
    h.controller.abort();
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.begin).not.toHaveBeenCalled();
  });
  it("cancels a pending statement and removes its listener on abort", async () => {
    const h = setup();
    const add = vi.spyOn(h.controller.signal, "addEventListener");
    const remove = vi.spyOn(h.controller.signal, "removeEventListener");
    h.hooks.during = async (query) => {
      if (query.includes("FROM identity.users")) h.controller.abort();
    };
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.cancels.filter((cancel) => cancel.mock.calls.length > 0)).toHaveLength(1);
    expect(remove.mock.calls).toHaveLength(add.mock.calls.length);
    expect(h.queries).toHaveLength(3);
  });
  it("covers abort occurring between statement creation and listener registration", async () => {
    const h = setup();
    h.hooks.before = (query) => {
      if (query.includes("FROM identity.users")) h.controller.abort();
    };
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.cancels[2]).toHaveBeenCalledOnce();
    expect(h.queries).toHaveLength(3);
  });
  it("refuses cancellation after the transaction callback rather than returning stale authority", async () => {
    const h = setup();
    h.hooks.afterTransaction = () => h.controller.abort();
    await expect(h.collect()).rejects.toThrow(error);
  });
  it("observes a query rejection when abort races listener registration", async () => {
    const h = setup();
    h.hooks.before = (query) => {
      if (query.includes("FROM identity.users")) {
        h.hooks.failure = new Error("SyntheticCancelledStatement");
        h.controller.abort();
      }
    };
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.cancels[2]).toHaveBeenCalledOnce();
  });
  it("does not inspect hostile thrown provider errors or print row data", async () => {
    const h = setup();
    const accessed = vi.fn(() => {
      throw new Error("SyntheticPrivateValue");
    });
    h.hooks.failure = new Proxy({}, { get: accessed, ownKeys: accessed, getPrototypeOf: accessed });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(h.collect()).rejects.toThrow(new RegExp("^" + error + "$", "u"));
      expect(accessed).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      report.mockRestore();
    }
  });
  it.each([
    [
      "source",
      (value: ReturnType<typeof fixture>) => {
        value.target.sourceSha = "invalid";
      },
    ],
    [
      "context",
      (value: ReturnType<typeof fixture>) => {
        value.target.restoreContextSha256 = "invalid";
      },
    ],
    [
      "key",
      (value: ReturnType<typeof fixture>) => {
        value.target = { ...value.target, marker: { ...value.target.marker, key: "other" } };
      },
    ],
    [
      "version",
      (value: ReturnType<typeof fixture>) => {
        value.target = { ...value.target, marker: { ...value.target.marker, versionId: "null" } };
      },
    ],
    [
      "request",
      (value: ReturnType<typeof fixture>) => {
        value.target = {
          ...value.target,
          marker: {
            ...value.target.marker,
            entry: { ...value.target.marker.entry, requestId: "malformed" },
          },
        };
      },
    ],
    [
      "policy",
      (value: ReturnType<typeof fixture>) => {
        value.target = {
          ...value.target,
          marker: {
            ...value.target.marker,
            entry: { ...value.target.marker.entry, policySha256: "0".repeat(64) },
          },
        };
      },
    ],
  ] as const)("refuses invalid target %s before SQL", async (_label, change) => {
    const value = fixture();
    change(value);
    const h = setup(value);
    await expect(h.collect()).rejects.toThrow(error);
    expect(h.begin).not.toHaveBeenCalled();
  });
  it("refuses a regressing clock and never rounds SQL timestamps", async () => {
    const h = setup();
    let calls = 0;
    await expect(h.collect(() => new Date(now.getTime() - calls++))).rejects.toThrow(error);
  });
});
