import { createHash } from "node:crypto";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  PostgresDocumentStore,
  RESUME_UPLOAD_HOLD_SECONDS,
  ResumeDocumentLimitError,
  type ResumeLimits,
  ResumeUploadInProgressError,
  type ResumeUploadSigner,
} from "./index.js";

const oneResume: ResumeLimits = { maxStoredResumes: async () => 1 };

describe("PostgresDocumentStore", () => {
  it("decodes a JSON-text idempotency replay returned by PostgreSQL", async () => {
    const input = {
      fileName: "synthetic-resume.pdf",
      mediaType: "application/pdf" as const,
      sizeBytes: 2048,
      sha256: "a".repeat(64),
    };
    const response = {
      document: {
        id: "019bf123-4567-789a-8bcd-ef0123456789",
        ...input,
        status: "awaiting_upload" as const,
        createdAt: "2026-08-12T12:00:00.000Z",
        updatedAt: "2026-08-12T12:00:00.000Z",
      },
      upload: {
        url: "https://synthetic-candidate-documents.example.test/",
        method: "POST" as const,
        fields: { policy: "synthetic-signed-policy" },
        expiresAt: "2026-08-12T12:05:00.000Z",
      },
    };
    const transaction = async (strings: TemplateStringsArray) =>
      strings.join("?").includes("SELECT request_hash")
        ? [
            {
              requestHash: createHash("sha256")
                .update(
                  JSON.stringify([input.fileName, input.mediaType, input.sizeBytes, input.sha256]),
                )
                .digest("hex"),
              response: JSON.stringify(response),
            },
          ]
        : [];
    const client = {
      begin: async <T>(callback: (sql: typeof transaction) => Promise<T>) => callback(transaction),
    } as unknown as postgres.Sql;
    const store = new PostgresDocumentStore(
      client,
      {
        createGrant: async () => {
          throw new Error("a replay must not mint another grant");
        },
      },
      oneResume,
    );
    await expect(
      store.createResumeUpload(
        "019bf123-4567-789a-8bcd-ef0123456788",
        input,
        "synthetic-idempotency-key-0001",
        "synthetic-trace-0001",
      ),
    ).resolves.toEqual(response);
  });

  it("binds JSONB writes as explicit JSON text without the driver JSON wrapper", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        statements.push({ sql, values });
        if (sql.includes("SELECT request_hash")) {
          return [];
        }
        if (sql.includes("SELECT count(*)")) {
          return [{ count: 0 }];
        }
        return [];
      },
      {
        // The Gateway's shared client installs an identity JSON serializer, so this wrapper fails there.
        json: () => {
          throw new Error("the driver JSON wrapper must not be used");
        },
      },
    );
    const client = {
      begin: async <T>(callback: (sql: typeof transaction) => Promise<T>) => callback(transaction),
    } as unknown as postgres.Sql;
    const signer: ResumeUploadSigner = {
      async createGrant(input) {
        return {
          url: "https://synthetic-candidate-documents.example.test/",
          method: "POST",
          fields: {
            key: input.objectKey,
            policy: "synthetic-signed-policy",
            "x-amz-signature": "synthetic-signature",
          },
          expiresAt: "2026-08-12T12:05:00.000Z",
        };
      },
    };
    const store = new PostgresDocumentStore(client, signer, oneResume);

    const response = await store.createResumeUpload(
      "019bf123-4567-789a-8bcd-ef0123456789",
      {
        fileName: "synthetic-resume.pdf",
        mediaType: "application/pdf",
        sizeBytes: 2048,
        sha256: "a".repeat(64),
      },
      "synthetic-idempotency-key-0001",
      "synthetic-trace-0001",
    );

    const idempotencyInsert = statements.find(({ sql }) =>
      sql.includes("INSERT INTO documents.idempotency_keys"),
    );
    const auditInsert = statements.find(({ sql }) =>
      sql.includes("INSERT INTO documents.audit_events"),
    );
    expect(idempotencyInsert?.sql).toContain("?::text::jsonb");
    expect(auditInsert?.sql).toContain("?::text::jsonb");
    expect(typeof idempotencyInsert?.values.at(-1)).toBe("string");
    expect(typeof auditInsert?.values.at(-1)).toBe("string");
    expect(JSON.parse(String(idempotencyInsert?.values.at(-1)))).toEqual(response);
    expect(JSON.parse(String(auditInsert?.values.at(-1)))).toEqual({
      version: 1,
      sizeBytes: 2048,
    });
  });
});

describe("PostgresDocumentStore resume slots (ADR-032)", () => {
  const owner = "019bf123-4567-789a-8bcd-ef0123456788";
  const input = {
    fileName: "synthetic-resume.pdf",
    mediaType: "application/pdf" as const,
    sizeBytes: 2048,
    sha256: "a".repeat(64),
  };
  const key = "synthetic-idempotency-key-0001";
  const requestHash = createHash("sha256")
    .update(JSON.stringify([input.fileName, input.mediaType, input.sizeBytes, input.sha256]))
    .digest("hex");

  function build(
    options: {
      limits?: ResumeLimits;
      occupied?: Array<{ status: string; count: number }>;
      abandoned?: Array<{ id: string; version: number }>;
      prior?: unknown;
    } = {},
  ) {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let begins = 0;
    let grants = 0;
    const transaction = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      statements.push({ sql, values });
      if (sql.includes("SELECT request_hash")) return options.prior ? [options.prior] : [];
      if (sql.includes("UPDATE documents.resume_documents")) return options.abandoned ?? [];
      if (sql.includes("SELECT status, count(*)")) return options.occupied ?? [];
      return [];
    };
    const client = {
      begin: async <T>(callback: (sql: typeof transaction) => Promise<T>) => {
        begins += 1;
        return callback(transaction);
      },
    } as unknown as postgres.Sql;
    const signer: ResumeUploadSigner = {
      async createGrant() {
        grants += 1;
        return {
          url: "https://synthetic-candidate-documents.example.test/",
          method: "POST",
          fields: { policy: "synthetic-signed-policy" },
          expiresAt: "2026-09-20T12:05:00.000Z",
        };
      },
    };
    const store = new PostgresDocumentStore(client, signer, options.limits ?? oneResume);
    return {
      store,
      statements,
      counts: () => ({ begins, grants }),
      register: () => store.createResumeUpload(owner, input, key, "synthetic-trace-0001"),
    };
  }

  it("registers when nothing occupies a slot, after taking the per-candidate slot lock", async () => {
    const harness = build();
    await expect(harness.register()).resolves.toMatchObject({
      document: { status: "awaiting_upload" },
    });
    const sql = harness.statements.map(({ sql: text }) => text);
    const lock = sql.findIndex((text) => text.includes("pg_advisory_xact_lock") && text.length > 0);
    const slotLock = harness.statements.findIndex(
      ({ values }) => values[0] === `${owner}:documents.resume-slot`,
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(slotLock).toBeGreaterThan(0);
    expect(slotLock).toBeLessThan(
      sql.findIndex((text) => text.includes("SELECT status, count(*)")),
    );
    expect(
      sql.findIndex((text) => text.includes("INSERT INTO documents.resume_documents")),
    ).toBeGreaterThan(sql.findIndex((text) => text.includes("SELECT status, count(*)")));
  });

  it("refuses a new upload while a resume is uploading, scanning, or parsing, on any plan", async () => {
    for (const status of ["awaiting_upload", "scanning", "parsing"]) {
      const harness = build({
        limits: { maxStoredResumes: async () => 50 },
        occupied: [{ status, count: 1 }],
      });
      await expect(harness.register(), status).rejects.toBeInstanceOf(ResumeUploadInProgressError);
      expect(harness.counts().grants, status).toBe(0);
      expect(
        harness.statements.some(({ sql }) =>
          sql.includes("INSERT INTO documents.resume_documents"),
        ),
        status,
      ).toBe(false);
    }
  });

  it("refuses a new upload once the plan's stored-resume limit is reached", async () => {
    const atLimit = build({ occupied: [{ status: "parsed", count: 1 }] });
    await expect(atLimit.register()).rejects.toMatchObject({
      name: "ResumeDocumentLimitError",
      limit: 1,
    });
    expect(atLimit.counts().grants).toBe(0);
    const zero = build({ limits: { maxStoredResumes: async () => 0 } });
    await expect(zero.register()).rejects.toBeInstanceOf(ResumeDocumentLimitError);
  });

  it("follows the limit Billing supplies, so a larger plan allows another parsed resume", async () => {
    const larger = build({
      limits: { maxStoredResumes: async () => 2 },
      occupied: [{ status: "parsed", count: 1 }],
    });
    await expect(larger.register()).resolves.toMatchObject({
      document: { status: "awaiting_upload" },
    });
    const full = build({
      limits: { maxStoredResumes: async () => 2 },
      occupied: [{ status: "parsed", count: 2 }],
    });
    await expect(full.register()).rejects.toBeInstanceOf(ResumeDocumentLimitError);
  });

  it("reports an unfinished upload before the limit, so the candidate sees why", async () => {
    const harness = build({
      occupied: [
        { status: "parsed", count: 1 },
        { status: "scanning", count: 1 },
      ],
    });
    await expect(harness.register()).rejects.toBeInstanceOf(ResumeUploadInProgressError);
  });

  it("rejects instead of guessing when the limit cannot be determined, before touching the database", async () => {
    const failure = new Error("entitlement unavailable");
    const harness = build({
      limits: {
        maxStoredResumes: async () => {
          throw failure;
        },
      },
    });
    await expect(harness.register()).rejects.toBe(failure);
    expect(harness.counts()).toEqual({ begins: 0, grants: 0 });
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const malformed = build({ limits: { maxStoredResumes: async () => bad } });
      await expect(malformed.register(), String(bad)).rejects.toBeInstanceOf(
        ResumeDocumentLimitError,
      );
      expect(malformed.counts().begins, String(bad)).toBe(0);
    }
  });

  it("returns an earlier registration on replay even when the slot is now taken", async () => {
    const response = {
      document: { id: "019bf123-4567-789a-8bcd-ef0123456789", ...input, status: "awaiting_upload" },
      upload: {
        url: "https://synthetic-candidate-documents.example.test/",
        method: "POST",
        fields: {},
        expiresAt: "2026-09-20T12:05:00.000Z",
      },
    };
    const harness = build({
      occupied: [{ status: "parsed", count: 1 }],
      prior: { requestHash, response: JSON.stringify(response) },
    });
    await expect(harness.register()).resolves.toEqual(response);
    expect(harness.counts().grants).toBe(0);
    expect(harness.statements.some(({ sql }) => sql.includes("SELECT status, count(*)"))).toBe(
      false,
    );
  });

  it("marks abandoned registrations failed before counting, with an audit event for each", async () => {
    const harness = build({
      abandoned: [
        { id: "019bf123-4567-789a-8bcd-ef0123450001", version: 1 },
        { id: "019bf123-4567-789a-8bcd-ef0123450002", version: 1 },
      ],
    });
    await expect(harness.register()).resolves.toMatchObject({
      document: { status: "awaiting_upload" },
    });
    const sql = harness.statements.map(({ sql: text }) => text);
    const sweep = sql.findIndex((text) => text.includes("UPDATE documents.resume_documents"));
    expect(sweep).toBeGreaterThan(-1);
    expect(sweep).toBeLessThan(sql.findIndex((text) => text.includes("SELECT status, count(*)")));
    expect(harness.statements[sweep]?.sql).toContain("status = 'awaiting_upload'");
    expect(harness.statements[sweep]?.values).toContain(RESUME_UPLOAD_HOLD_SECONDS);
    const audits = harness.statements.filter(({ sql: text }) =>
      text.includes("'resume.processing.failed'"),
    );
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(JSON.parse(String(audit.values.at(-1)))).toEqual({
        version: 1,
        failureCode: "scan_failed",
      });
    }
  });

  it("holds an unfinished registration for the grant lifetime plus a scan margin", () => {
    expect(RESUME_UPLOAD_HOLD_SECONDS).toBe(15 * 60);
  });
});
