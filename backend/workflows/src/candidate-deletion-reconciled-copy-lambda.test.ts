import { fileURLToPath } from "node:url";
import manifest from "@ai-job-apply/database-migrations/restore-manifest.json" with {
  type: "json",
};
import { verifyRestoreDatabase } from "@ai-job-apply/database-migrations/restore-verifier";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyReconciledCandidateDeletionCopyWithDocumentContinuity } from "./candidate-deletion-reconciled-copy.js";
import {
  createReconciledCopyVerificationHandler,
  type ReconciledCopyDependencies,
} from "./candidate-deletion-reconciled-copy-lambda.js";
import { reconciledRuntimeFixture } from "./candidate-deletion-reconciled-copy-runtime.fixture.js";
import { CURRENT_RESTORE_MANIFEST_SHA256 } from "./candidate-deletion-restore-contract.js";

vi.mock("@ai-job-apply/database-migrations/restore-verifier", async (original) => ({
  ...(await original<object>()),
  verifyRestoreDatabase: vi.fn(),
}));
vi.mock("./candidate-deletion-reconciled-copy.js", () => ({
  verifyReconciledCandidateDeletionCopyWithDocumentContinuity: vi.fn(),
}));

function setup() {
  const f = reconciledRuntimeFixture();
  const close = vi.fn(async () => undefined);
  const database = {
    client: {
      begin: vi.fn(async (_options: unknown, action: (sql: unknown) => unknown) =>
        action({ unsafe: vi.fn() }),
      ),
    },
  } as unknown as DatabaseHandle;
  const dependencies: ReconciledCopyDependencies = {
    environment: () => f.environment,
    now: () => new Date(Date.now()),
    openDatabase: vi.fn(async () => ({ database, close })),
    ledger: vi.fn(() => ({ inspectCompletedMarkers: vi.fn(), assertUnchanged: vi.fn() })),
    documents: vi.fn(() => ({ inspectReplayDocumentContinuity: vi.fn() })),
  };
  const schema = {
    schemaVersion: 1 as const,
    aggregateDigest: "a".repeat(64),
    manifestId: manifest.manifestId,
    manifestSha256: CURRENT_RESTORE_MANIFEST_SHA256,
    ownerCount: manifest.contributors.length,
    relationCount: manifest.contributors.flatMap((c) => c.relations).length,
    migrationCount: manifest.contributors.flatMap((c) => c.migrations).length,
  };
  vi.mocked(verifyRestoreDatabase).mockResolvedValue(schema);
  const privacy = {
    markerSnapshotSha256: f.originalReceipt.markerSnapshotSha256,
    markersValidated: 0,
    restoredSubjectsPresent: 0,
    restoredSubjectsAbsent: 0,
    reconciled: f.originalReceipt.preservation.reconciled,
    documentContinuitySha256: "6".repeat(64),
  };
  vi.mocked(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).mockResolvedValue(privacy);
  return {
    ...f,
    close,
    database,
    dependencies,
    schema,
    privacy,
    handler: createReconciledCopyVerificationHandler(dependencies),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T00:01:00.000Z"));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());
const error = "CandidateDeletionReconciledCopyVerificationRejected";

describe("private read-only copy verification runtime", () => {
  it("excludes replay stores and deletion activities, and never calls cloud writes", async () => {
    const bundle = await build({
      entryPoints: [
        fileURLToPath(new URL("./candidate-deletion-reconciled-copy-lambda.ts", import.meta.url)),
      ],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      metafile: true,
    });
    expect(Object.keys(bundle.metafile?.inputs ?? {}).join("\n")).not.toMatch(
      /candidate-deletion-restore-store|candidate-deletion-restore-lambda|candidate-rights-activities|candidate-rights-aws/u,
    );
    // Node's AWS SDK CommonJS entry points retain unused write-command definitions.
    // Inspect every emitted application module, while keeping the full input-graph
    // guard above: SDK definitions alone do not establish an application call port.
    const sections = bundle.outputFiles[0]?.text.split(/^\/\/ (.+)$/mu) ?? [];
    const application = sections
      .filter((_section, index) => index > 0 && index % 2 === 0)
      .filter((_section, index) => !sections[index * 2 + 1]?.includes("node_modules/"))
      .join("\n");
    expect(application).toContain("new import_client_s3.ListObjectVersionsCommand");
    expect(application).toContain("new import_client_kms.DecryptCommand");
    expect(
      [
        ...new Set(
          [...application.matchAll(/import_client_s3\d*\.(\w+Command)/gu)].map((m) => m[1]),
        ),
      ].sort(),
    ).toEqual([
      "GetObjectCommand",
      "GetObjectRetentionCommand",
      "GetObjectTaggingCommand",
      "ListObjectVersionsCommand",
    ]);
    expect([
      ...new Set(
        [...application.matchAll(/import_client_kms\d*\.(\w+Command)/gu)].map((m) => m[1]),
      ),
    ]).toEqual(["DecryptCommand"]);
    expect(application).not.toMatch(
      /\.delete_candidate_data|EncryptCommand|PutObjectCommand|DeleteObjectCommand|PutObjectTaggingCommand/u,
    );
  });
  it("accepts the actual manifest's seven contributors, 96 relations and 79 migrations only after closing", async () => {
    const f = setup();
    const result = await f.handler(f.request, f.context);
    expect(f.schema).toMatchObject({ ownerCount: 7, relationCount: 96, migrationCount: 79 });
    expect(result).toMatchObject({
      outcome: "verified",
      schemaVerification: f.schema,
      originalReceiptSha256: f.configuration.originalReceiptSha256,
    });
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.close.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).mock
        .invocationCallOrder[0] ?? 0,
    );
  });
  it("rejects missing admission before secret, SQL or marker work", async () => {
    const f = setup();
    delete f.environment.RECONCILED_COPY_CONFIG_JSON;
    await expect(f.handler(f.request, f.context)).rejects.toThrow(error);
    expect(f.dependencies.openDatabase).not.toHaveBeenCalled();
    expect(f.dependencies.ledger).not.toHaveBeenCalled();
  });
  it("rejects insufficient Lambda time before opening a database", async () => {
    const f = setup();
    await expect(
      f.handler(f.request, { ...f.context, getRemainingTimeInMillis: () => 129_999 }),
    ).rejects.toThrow(error);
    expect(f.dependencies.openDatabase).not.toHaveBeenCalled();
  });
  it("closes and rejects a wrong schema or failed privacy verification", async () => {
    for (const kind of ["schema", "privacy"]) {
      const f = setup();
      if (kind === "schema")
        vi.mocked(verifyRestoreDatabase).mockResolvedValue({ ...f.schema, ownerCount: 8 });
      else
        vi.mocked(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).mockRejectedValue(
          new Error("synthetic-sensitive-error"),
        );
      await expect(f.handler(f.request, f.context)).rejects.toThrow(error);
      expect(f.close).toHaveBeenCalledOnce();
    }
  });
  it("never emits success when close fails", async () => {
    const f = setup();
    f.close.mockRejectedValue(new Error("synthetic-secret"));
    await expect(f.handler(f.request, f.context)).rejects.toThrow(error);
  });
  it("bounds an uncooperative close", async () => {
    const f = setup();
    f.close.mockImplementation(() => new Promise(() => undefined));
    const refusal = expect(f.handler(f.request, f.context)).rejects.toThrow(error);
    await vi.advanceTimersByTimeAsync(5001);
    await refusal;
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("enforces the absolute deadline even if an abort timer is delayed", async () => {
    const f = setup();
    vi.mocked(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).mockImplementation(
      async () => {
        vi.setSystemTime(Date.now() + 120_000);
        throw new Error("expired");
      },
    );
    await expect(f.handler(f.request, f.context)).rejects.toThrow(error);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("refuses late successful verification after wall-clock expiry", async () => {
    const f = setup();
    vi.mocked(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).mockImplementation(
      async () => {
        vi.setSystemTime(Date.now() + 120_001);
        return f.privacy;
      },
    );
    await expect(f.handler(f.request, f.context)).rejects.toThrow(error);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("closes a connection that opens after global cancellation", async () => {
    const f = setup();
    let finish: ((value: { database: DatabaseHandle; close: typeof f.close }) => void) | undefined;
    f.dependencies.openDatabase = vi.fn(
      () =>
        new Promise<{ database: DatabaseHandle; close: typeof f.close }>((resolve) => {
          finish = resolve;
        }),
    );
    const execution = f.handler(f.request, f.context);
    const rejection = expect(execution).rejects.toThrow(error);
    await vi.advanceTimersByTimeAsync(120_001);
    await rejection;
    finish?.({ database: f.database, close: f.close });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.close).toHaveBeenCalledOnce();
    expect(verifyRestoreDatabase).not.toHaveBeenCalled();
  });
  it("cancels an outstanding schema query before closing on the global deadline", async () => {
    const f = setup();
    let rejectQuery: ((error: Error) => void) | undefined;
    const cancel = vi.fn(() => rejectQuery?.(new Error("synthetic-query-cancelled")));
    const pending = Object.assign(
      new Promise<Record<string, unknown>[]>((_resolve, reject) => {
        rejectQuery = reject;
      }),
      { cancel },
    );
    vi.mocked(f.database.client.begin).mockImplementation((async (
      _options: unknown,
      work: (sql: unknown) => unknown,
    ) => work({ unsafe: () => pending })) as typeof f.database.client.begin);
    vi.mocked(verifyRestoreDatabase).mockImplementation(async (client) => {
      await client.begin("read only isolation level repeatable read", async (sql) =>
        sql.unsafe("SELECT 1"),
      );
      return f.schema;
    });
    const rejection = expect(f.handler(f.request, f.context)).rejects.toThrow(error);
    await vi.advanceTimersByTimeAsync(120_001);
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      Number(f.close.mock.invocationCallOrder[0]),
    );
    expect(verifyReconciledCandidateDeletionCopyWithDocumentContinuity).not.toHaveBeenCalled();
  });
});
