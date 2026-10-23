import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { createDatabase, type DatabaseHandle } from "@ai-job-apply/profile-service";
import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  RESTORED_CANDIDATE_RIGHTS_OWNERS,
} from "./candidate-deletion-restore-policy.js";
import { PRESERVATION_RELATIONS } from "./candidate-deletion-restore-preservation.js";
import {
  PostgresCandidateDeletionRestoreStore,
  readCandidateDeletionRestoreStoreFailure,
} from "./candidate-deletion-restore-store.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

type Row = Record<string, unknown>;
function fixture(offset = 0) {
  const uuid = (n: number) =>
    `019c2b89-79b2-7000-8000-${(offset + n).toString().padStart(12, "0")}`;
  const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[1];
  if (!policy) throw new Error("Synthetic policy missing");
  const issuer = "https://synthetic-restore.invalid/";
  const subject = `generated-${offset}`;
  const entry: CandidateDeletionRecoveryEntry = {
    requestId: uuid(1),
    operationId: uuid(2),
    userId: uuid(3),
    policyVersion: policy.version,
    policySha256: policy.sha256,
    subjectDigest: createHash("sha256")
      .update(`ai-job-apply/account-deletion-subject/v1\0${issuer}\0${subject}`)
      .digest("hex"),
    confirmedAt: new Date("2026-09-02T00:00:00.000Z"),
    backupExpiresAt: new Date("2026-10-07T00:00:00.000Z"),
    completedAt: new Date("2026-09-02T00:00:01.000Z"),
  };
  return {
    entry,
    user: {
      id: entry.userId,
      accountState: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
      quarantinedAt: null,
    } as Row | undefined,
    identities: [{ issuer, subject }] as Row[],
    requests: [] as Row[],
    operations: [] as Row[],
    ledgers: [] as Row[],
    documents: [
      {
        documentId: uuid(4),
        sourceObjectKey: `quarantine/${uuid(4)}/source`,
        sourceObjectVersion: null,
        normalizedObjectKey: null,
        normalizedObjectVersion: null,
        status: "awaiting_upload",
      },
    ] as Row[],
    coverLetters: [] as Row[],
    counts: Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, 1])) as Row,
  };
}

function database(
  fixtures: ReturnType<typeof fixture>[],
  changedAfterWrite = false,
  commitFails = false,
) {
  const queries: { query: string; values: string[] }[] = [];
  const unsafe = vi.fn((query: string, values: string[] = []) => {
    queries.push({ query, values });
    const value =
      fixtures.find((item) =>
        values.some((id) =>
          [item.entry.userId, item.entry.operationId, item.entry.requestId].includes(id),
        ),
      ) ?? fixtures[0];
    if (!value) throw new Error("Missing synthetic fixture");
    let output: Row[] = [];
    if (query.startsWith("SET LOCAL")) output = [];
    else if (query.includes("AS settings"))
      output = [
        {
          settings: [
            "UTC",
            "ISO, YMD",
            "iso_8601",
            "3",
            "hex",
            "off",
            "UTF8",
            "UTF8",
            16,
            "pg_catalog",
          ],
        },
      ];
    else if (query.includes("WITH tables AS"))
      output = [{ relations: [...PRESERVATION_RELATIONS].sort(), visible: true }];
    else if (query.startsWith("WITH row_hashes"))
      output = [
        {
          rows: "1",
          bytes: "40",
          largest: "40",
          sha: (changedAfterWrite &&
          queries.some(({ query }) => /^SELECT \w+\.delete_candidate_data/u.test(query))
            ? "c"
            : "a"
          ).repeat(64),
          schema: "b".repeat(64),
        },
      ];
    else if (query.includes('AS "ownerCounts"')) output = [{ ownerCounts: { ...value.counts } }];
    else if (query.startsWith("SELECT id, account_state"))
      output = value.user ? [{ ...value.user }] : [];
    else if (
      query.startsWith("SELECT id, user_id") &&
      query.includes("FROM profile.account_deletion_requests")
    )
      output = structuredClone(value.requests);
    else if (query.startsWith("SELECT id, user_id") && query.includes("FROM platform.operations"))
      output = structuredClone(value.operations);
    else if (query.startsWith("SELECT request_id")) output = structuredClone(value.ledgers);
    else if (query.startsWith("SELECT issuer")) output = structuredClone(value.identities);
    else if (query.startsWith("SELECT id AS") && query.includes("FROM documents.cover_letters"))
      output = structuredClone(value.coverLetters);
    else if (query.startsWith("SELECT id AS")) output = structuredClone(value.documents);
    else if (
      /^SELECT (notifications|applications|jobs|matching|billing|trust|documents|profile)\.delete_candidate_data/u.test(
        query,
      )
    ) {
      const owner = query.split(" ")[1]?.split(".")[0] ?? "";
      value.counts[owner] = 0;
      output = [{ result: { owner } }];
    } else if (query.startsWith("DELETE FROM identity.external_identities"))
      value.counts.identity = 0;
    else if (!/^(INSERT|UPDATE)/u.test(query))
      throw new Error(`Unexpected synthetic query ${query}`);
    return Object.assign(Promise.resolve(output), { cancel: vi.fn() });
  });
  const sql = { unsafe };
  const begin = vi.fn(
    async (_options: string, run: (transaction: typeof sql) => Promise<unknown>) => {
      const result = await run(sql);
      if (
        commitFails &&
        queries.some(({ query }) => /^SELECT \w+\.delete_candidate_data/u.test(query))
      )
        throw new Error("SyntheticCommitAcknowledgementFailed");
      return result;
    },
  );
  const handle = { client: { unsafe, begin } } as unknown as DatabaseHandle;
  return {
    handle,
    queries,
    unsafe,
    writes: () =>
      queries.filter(({ query }) =>
        /^(INSERT|UPDATE|DELETE)|^SELECT \w+\.delete_candidate_data/u.test(query),
      ),
  };
}

function completedFixture(state: "completed" | "backup_expired" = "completed") {
  const value = fixture();
  const confirmedAt = new Date(Date.now() - 40 * 86_400_000);
  value.entry.confirmedAt = confirmedAt;
  value.entry.backupExpiresAt = new Date(confirmedAt.getTime() + 35 * 86_400_000);
  value.entry.completedAt = new Date(confirmedAt.getTime() + 1_000);
  const backupExpiredAt =
    state === "backup_expired"
      ? new Date(value.entry.backupExpiresAt.getTime() + 1_000).toISOString()
      : null;
  value.user = {
    id: value.entry.userId,
    accountState: "quarantined",
    createdAt: new Date(confirmedAt.getTime() - 1_000).toISOString(),
    quarantinedAt: confirmedAt.toISOString(),
  };
  value.identities = [];
  value.documents = [];
  value.counts = Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, 0]));
  value.requests = [
    {
      id: value.entry.requestId,
      userId: value.entry.userId,
      operationId: value.entry.operationId,
      policyVersion: value.entry.policyVersion,
      state,
      version: 5,
      requestedAt: confirmedAt.toISOString(),
      confirmedAt: confirmedAt.toISOString(),
      backupExpiresAt: value.entry.backupExpiresAt.toISOString(),
      completedAt: value.entry.completedAt.toISOString(),
      backupExpiredAt,
    },
  ];
  value.operations = [
    {
      id: value.entry.operationId,
      userId: value.entry.userId,
      kind: "account_deletion",
      state: "succeeded",
      result: { resourceId: value.entry.requestId, resourceType: "account_deletion_request" },
    },
  ];
  value.ledgers = [
    {
      requestId: value.entry.requestId,
      subjectDigest: value.entry.subjectDigest,
      policyVersion: value.entry.policyVersion,
      policySha256: value.entry.policySha256,
      state,
      ownerInventory: Object.fromEntries(
        RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, "completed"]),
      ),
      subprocessorInventory: {},
      confirmedAt: confirmedAt.toISOString(),
      backupExpiresAt: value.entry.backupExpiresAt.toISOString(),
      completedAt: value.entry.completedAt.toISOString(),
      backupExpiredAt,
    },
  ];
  return value;
}

describe("restore-only whole-set database preflight", () => {
  it.each(["completed", "backup_expired"] as const)(
    "preserves valid historical %s inventories with all current owners empty",
    async (state) => {
      const value = completedFixture(state);
      const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[1];
      if (!policy) throw new Error("SyntheticPolicyMissing");
      value.ledgers[0] = {
        ...value.ledgers[0],
        ownerInventory: Object.fromEntries(
          policy.ownerInventory.map((owner) => [owner, "completed"]),
        ),
      };
      const db = database([value]);
      const store = new PostgresCandidateDeletionRestoreStore(db.handle);
      expect(
        await store.reconcile([value.entry], await store.preflight([value.entry])),
      ).toMatchObject({ restoredUsersAlreadyReconciled: 1, restoredUsersReconciled: 0 });
      expect(db.writes()).toHaveLength(0);
    },
  );

  it("inventories independent pending and ready cover letters in the original preflight", async () => {
    const value = fixture();
    const documentId = "019c2b89-79b2-7000-8000-000000000009";
    value.coverLetters = [
      {
        documentId,
        objectKey: `normalized/${documentId}/cover-letter.v1.json`,
        objectVersion: null,
        status: "pending",
      },
    ];
    const db = database([value]);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    expect((await store.preflight([value.entry])).documentObjects[1]).toEqual({
      kind: "cover_letter",
      userId: value.entry.userId,
      documentId,
      objectKey: `normalized/${documentId}/cover-letter.v1.json`,
    });
    value.coverLetters[0] = {
      ...value.coverLetters[0],
      objectVersion: "ready-original",
      status: "ready",
    };
    expect((await store.preflight([value.entry])).documentObjects[1]).toMatchObject({
      objectVersion: "ready-original",
    });
    expect(db.writes()).toHaveLength(0);
  });

  it.each([
    { objectKey: "normalized/foreign/cover-letter.v1.json" },
    { status: "ready", objectVersion: null },
    { status: "pending", objectVersion: "unexpected" },
    { status: "invalid" },
    { documentId: "invalid" },
  ])("rejects malformed cover inventory before any writes %j", async (mutation) => {
    const value = fixture();
    const documentId = "019c2b89-79b2-7000-8000-000000000009";
    value.coverLetters = [
      {
        documentId,
        objectKey: `normalized/${documentId}/cover-letter.v1.json`,
        objectVersion: null,
        status: "pending",
        ...mutation,
      },
    ];
    const db = database([value]);
    await expect(
      new PostgresCandidateDeletionRestoreStore(db.handle).preflight([value.entry]),
    ).rejects.toThrow("DocumentInventoryRejected");
    expect(db.writes()).toHaveLength(0);
  });
  it("brands only its own unchanged refusal without reading error properties or prototypes", async () => {
    const value = fixture();
    const db = database([value]);
    const failure = await new PostgresCandidateDeletionRestoreStore(db.handle)
      .preflight([value.entry], AbortSignal.abort())
      .catch((error: unknown) => error);
    if (!(failure instanceof Error)) throw new Error("SyntheticStoreRefusalMissing");
    expect(failure.message).toBe("CandidateDeletionRestoreAborted");
    expect(Object.keys(failure)).toEqual([]);
    const accessed = vi.fn(() => {
      throw new Error("PRIVATE thrown value accessed");
    });
    for (const key of ["name", "message", "stack", "code", "cause", "toJSON"])
      Object.defineProperty(failure, key, { configurable: true, get: accessed });
    Object.setPrototypeOf(failure, null);
    expect(readCandidateDeletionRestoreStoreFailure(failure)).toBe("Aborted");
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const unowned of [
      undefined,
      null,
      "CandidateDeletionRestoreAborted",
      1,
      true,
      Symbol("Aborted"),
      () => undefined,
      new Error("CandidateDeletionRestoreAborted"),
      { storeFailure: "Aborted", message: "CandidateDeletionRestoreAborted" },
      Object.create(failure),
      new Proxy(failure, { get: accessed, ownKeys: accessed, getPrototypeOf: accessed }),
      revoked.proxy,
    ])
      expect(readCandidateDeletionRestoreStoreFailure(unowned)).toBeUndefined();
    expect(accessed).not.toHaveBeenCalled();
    expect(db.writes()).toHaveLength(0);
  });

  it.each(["valid", "double_encoded_result", "string_owner_counts"] as const)(
    "preserves preflight semantics with the installed Profile/Drizzle parsers: %s",
    async (mode) => {
      const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
        throw new Error("SyntheticUnexpectedNetwork");
      });
      const actual = createDatabase(
        "postgres://platform:synthetic@127.0.0.1:1/ai_job_apply?sslmode=require",
        { maxConnections: 1 },
      );
      try {
        // The pool stays unopened; only its actual installed parsers/transforms are used.
        const { parsers, transform } = actual.client.options;
        const columnFrom = transform.column.from;
        const valueFrom = transform.value.from;
        if (!columnFrom || !valueFrom) throw new Error("SyntheticParserMissing");
        const types: Record<string, number> = {
          version: 23,
          createdAt: 1184,
          quarantinedAt: 1184,
          requestedAt: 1184,
          confirmedAt: 1184,
          backupExpiresAt: 1184,
          completedAt: 1184,
          backupExpiredAt: 1184,
          result: 3802,
          ownerInventory: 3802,
          subprocessorInventory: 3802,
          ownerCounts: 3802,
        };
        const fromWire = (row: Row): Row =>
          Object.fromEntries(
            Object.entries(row).map(([name, value]) => {
              const type = types[name] ?? 25;
              const encoded = type === 3802 ? JSON.stringify(value) : String(value);
              const parser = parsers[type];
              const parsed = value === null ? null : parser ? parser(encoded) : encoded;
              return [columnFrom(name), valueFrom(parsed, { name, type, table: 0, number: 0 })];
            }),
          );
        const value = completedFixture();
        if (mode === "double_encoded_result" && value.operations[0])
          value.operations[0].result = JSON.stringify(value.operations[0].result);
        if (mode === "string_owner_counts") value.counts.identity = "0";
        if (value.user) value.user = fromWire(value.user);
        value.requests = value.requests.map(fromWire);
        value.operations = value.operations.map(fromWire);
        value.ledgers = value.ledgers.map(fromWire);
        value.counts = fromWire({ ownerCounts: value.counts }).ownerCounts as Row;
        expect(typeof value.user?.createdAt).toBe("string");
        expect(typeof value.requests[0]?.version).toBe("number");
        expect(typeof value.ledgers[0]?.ownerInventory).toBe("object");
        const db = database([value]);
        const preflight = new PostgresCandidateDeletionRestoreStore(db.handle).preflight([
          value.entry,
        ]);
        if (mode === "valid") {
          await expect(preflight).resolves.toMatchObject({ restoredSubjectsPresent: 1 });
        } else {
          const failure = await preflight.catch((error: unknown) => error);
          expect(readCandidateDeletionRestoreStoreFailure(failure)).toBe(
            mode === "double_encoded_result" ? "OperationCollision" : "OwnerInventoryRejected",
          );
        }
        expect(db.writes()).toHaveLength(0);
        expect(connect).not.toHaveBeenCalled();
      } finally {
        await actual.client.end();
        connect.mockRestore();
      }
    },
  );

  it("accepts only the independently inspectable canonical normalized-document key shape", async () => {
    const value = fixture();
    const document = value.documents[0];
    if (!document) throw new Error("Synthetic document missing");
    value.documents[0] = {
      ...document,
      status: "parsed",
      sourceObjectVersion: "source-v1",
      normalizedObjectVersion: "normalized-v1",
      normalizedObjectKey: `normalized/${document.documentId}/${"a".repeat(64)}/parser-v1/resume.json`,
    };
    const db = database([value]);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    expect((await store.preflight([value.entry])).documentObjects[0]).toMatchObject({
      sourceObjectVersion: "source-v1",
      normalizedObjectVersion: "normalized-v1",
    });
    value.documents[0] = {
      ...value.documents[0],
      normalizedObjectKey: `normalized/${document.documentId}/arbitrary.json`,
    };
    await expect(store.preflight([value.entry])).rejects.toThrow("DocumentInventoryRejected");
    value.documents[0] = { ...document, sourceObjectVersion: "null" };
    await expect(store.preflight([value.entry])).rejects.toThrow("DocumentInventoryRejected");
    expect(db.writes()).toHaveLength(0);
  });
  it.each(["completed", "backup_expired"] as const)(
    "preserves an already-reconciled %s tombstone without writes",
    async (state) => {
      const value = completedFixture(state);
      const db = database([value]);
      const store = new PostgresCandidateDeletionRestoreStore(db.handle);
      const before = JSON.stringify(value);
      const preflight = await store.preflight([value.entry]);
      expect(await store.reconcile([value.entry], preflight)).toMatchObject({
        restoredUsersReconciled: 0,
        restoredUsersAbsent: 0,
        restoredUsersAlreadyReconciled: 1,
      });
      expect(db.writes()).toHaveLength(0);
      expect(JSON.stringify(value)).toBe(before);
    },
  );

  it("does not downgrade a backup_expired tombstone to authorize resurrected owner data", async () => {
    const value = completedFixture("backup_expired");
    value.counts.trust = 1;
    const db = database([value]);
    await expect(
      new PostgresCandidateDeletionRestoreStore(db.handle).preflight([value.entry]),
    ).rejects.toThrow("ExpiredRestoreStateConflict");
    expect(db.writes()).toHaveLength(0);
  });

  it.each(["policy", "operation", "request", "time", "inventory", "subject", "completion"])(
    "rejects conflicting persisted %s even after identities have been removed",
    async (field) => {
      const value = completedFixture();
      if (field === "policy")
        value.ledgers[0] = { ...value.ledgers[0], policySha256: "0".repeat(64) };
      if (field === "operation")
        value.operations[0] = { ...value.operations[0], userId: fixture(10).entry.userId };
      if (field === "request")
        value.requests[0] = { ...value.requests[0], operationId: fixture(10).entry.operationId };
      if (field === "time")
        value.ledgers[0] = { ...value.ledgers[0], confirmedAt: new Date("invalid") };
      if (field === "inventory")
        value.ledgers[0] = { ...value.ledgers[0], ownerInventory: { profile: "completed" } };
      if (field === "subject")
        value.ledgers[0] = { ...value.ledgers[0], subjectDigest: "0".repeat(64) };
      if (field === "completion")
        value.requests[0] = { ...value.requests[0], completedAt: value.entry.confirmedAt };
      const db = database([value]);
      await expect(
        new PostgresCandidateDeletionRestoreStore(db.handle).preflight([value.entry]),
      ).rejects.toThrow();
      expect(db.writes()).toHaveLength(0);
    },
  );
  it("preflights all users/documents read-only, accepts awaiting upload, and binds preflight to its store", async () => {
    const first = fixture();
    const second = fixture(10);
    const db = database([first, second]);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    const preflight = await store.preflight([second.entry, first.entry]);
    expect(preflight).toMatchObject({ restoredSubjectsPresent: 2, restoredSubjectsAbsent: 0 });
    expect(preflight.documentObjects).toHaveLength(2);
    expect(preflight.documentObjects[0]).not.toHaveProperty("sourceObjectVersion");
    expect(db.writes()).toHaveLength(0);
    expect(Object.isFrozen(preflight.documentObjects[0])).toBe(true);
    await expect(
      new PostgresCandidateDeletionRestoreStore(db.handle).reconcile(
        [first.entry, second.entry],
        preflight,
      ),
    ).rejects.toThrow("PreflightBindingRejected");
    await expect(store.reconcile([first.entry, second.entry], { ...preflight })).rejects.toThrow(
      "PreflightBindingRejected",
    );
    expect(db.writes()).toHaveLength(0);
  });

  it("reconciles completed deletions without scanning unrelated whole rows", async () => {
    const value = fixture();
    const db = database([value], true);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    const preflight = await store.preflight([value.entry]);
    expect(await store.reconcile([value.entry], preflight)).toEqual({
      restoredUsersReconciled: 1,
      restoredUsersAbsent: 0,
      restoredUsersAlreadyReconciled: 0,
    });
    expect(db.queries.filter(({ query }) => query.startsWith("WITH row_hashes"))).toHaveLength(0);
  });

  it("never returns an attestation when COMMIT acknowledgement fails", async () => {
    const value = fixture();
    const db = database([value], false, true);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    const preflight = await store.preflight([value.entry]);
    await expect(store.reconcile([value.entry], preflight)).rejects.toThrow(
      "SyntheticCommitAcknowledgementFailed",
    );
    expect(db.queries.filter(({ query }) => query.startsWith("WITH row_hashes"))).toHaveLength(0);
  });

  it("revalidates the whole set before invoking all nine owners and never receives cloud mutation ports", async () => {
    const values = [fixture(), fixture(10)];
    const db = database(values);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    const entries = values.map((value) => value.entry);
    const preflight = await store.preflight(entries);
    expect(await store.reconcile(entries, preflight)).toMatchObject({
      restoredUsersReconciled: 2,
      restoredUsersAbsent: 0,
      restoredUsersAlreadyReconciled: 0,
    });
    const firstWrite = db.queries.findIndex(({ query }) =>
      query.startsWith("UPDATE identity.users"),
    );
    expect(
      db.queries
        .slice(0, firstWrite)
        .filter(
          ({ query }) =>
            query.startsWith("SELECT id AS") && query.includes("FROM documents.resume_documents"),
        ),
    ).toHaveLength(4);
    const ports = db
      .writes()
      .filter(({ query }) => query.startsWith("SELECT "))
      .map(({ query }) => query.split(".")[0]);
    const owners = [
      "SELECT notifications",
      "SELECT applications",
      "SELECT jobs",
      "SELECT matching",
      "SELECT billing",
      "SELECT trust",
      "SELECT documents",
      "SELECT profile",
    ];
    expect(ports).toEqual([...owners, ...owners]);
    expect(
      db
        .writes()
        .filter(({ query }) => query.startsWith("DELETE FROM identity.external_identities")),
    ).toHaveLength(2);
  });

  it.each(["request", "operation", "subject", "document", "ledger"])(
    "rejects late %s collision without writing an earlier valid owner",
    async (kind) => {
      const values = [fixture(), fixture(10)];
      const second = values[1];
      if (!second) throw new Error("Synthetic fixture missing");
      if (kind === "request")
        second.requests = [
          {
            id: second.entry.requestId,
            userId: values[0]?.entry.userId,
            policyVersion: second.entry.policyVersion,
            state: "requested",
            version: 1,
            requestedAt: second.entry.confirmedAt,
          },
        ];
      if (kind === "operation")
        second.operations = [
          {
            id: second.entry.operationId,
            userId: second.entry.userId,
            kind: "candidate_data_export",
            state: "queued",
            result: null,
          },
        ];
      if (kind === "subject")
        second.identities[0] = { issuer: "https://wrong.invalid", subject: "another-candidate" };
      if (kind === "document")
        second.documents[0] = {
          ...second.documents[0],
          sourceObjectKey: `quarantine/${values[0]?.documents[0]?.documentId}/source`,
        };
      if (kind === "ledger")
        second.ledgers = [{ requestId: second.entry.requestId, policySha256: "f".repeat(64) }];
      const db = database(values);
      await expect(
        new PostgresCandidateDeletionRestoreStore(db.handle).preflight(
          values.map((value) => value.entry),
        ),
      ).rejects.toThrow();
      expect(db.writes()).toHaveLength(0);
    },
  );

  it.each(["subject", "document", "counts"])(
    "rejects changed %s on transactional revalidation before any write",
    async (kind) => {
      const first = fixture();
      const db = database([first]);
      const store = new PostgresCandidateDeletionRestoreStore(db.handle);
      const preflight = await store.preflight([first.entry]);
      if (kind === "subject")
        first.identities = [{ issuer: "https://wrong.invalid/", subject: "wrong" }];
      if (kind === "document") first.documents = [];
      if (kind === "counts") first.counts.jobs = 2;
      await expect(store.reconcile([first.entry], preflight)).rejects.toThrow();
      expect(db.writes()).toHaveLength(0);
    },
  );

  it("distinguishes physically absent users and rejects orphaned owned data", async () => {
    const first = fixture();
    first.user = undefined;
    first.identities = [];
    first.documents = [];
    first.counts = Object.fromEntries(RESTORED_CANDIDATE_RIGHTS_OWNERS.map((owner) => [owner, 0]));
    const db = database([first]);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    const preflight = await store.preflight([first.entry]);
    expect(preflight).toMatchObject({
      restoredSubjectsAbsent: 1,
      restoredSubjectsPresent: 0,
      documentObjects: [],
    });
    expect(await store.reconcile([first.entry], preflight)).toMatchObject({
      restoredUsersReconciled: 0,
      restoredUsersAbsent: 1,
      restoredUsersAlreadyReconciled: 0,
    });
    first.counts.trust = 1;
    await expect(store.preflight([first.entry])).rejects.toThrow("AbsentIdentityHasOwnedData");
    expect(db.writes()).toHaveLength(0);
  });

  it("rejects an unbound missing identity, invalid document state and aborted work", async () => {
    const first = fixture();
    const db = database([first]);
    const store = new PostgresCandidateDeletionRestoreStore(db.handle);
    first.identities = [];
    await expect(store.preflight([first.entry])).rejects.toThrow("IdentityCollision");
    first.identities = fixture().identities;
    first.documents[0] = { ...first.documents[0], status: "parsed" };
    await expect(store.preflight([first.entry])).rejects.toThrow("DocumentInventoryRejected");
    await expect(store.preflight([first.entry], AbortSignal.abort())).rejects.toThrow("Aborted");
    expect(db.writes()).toHaveLength(0);
  });
});
