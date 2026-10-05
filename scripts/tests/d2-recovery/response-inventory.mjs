import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PostgresCoverLetterResponseStore } from "../../../backend/services/documents/dist/src/cover-letter-response-store.js";
import { PostgresCoverLetterStore } from "../../../backend/services/documents/dist/src/cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "../../../backend/services/documents/dist/src/cover-letter-work-store.js";
import { PostgresTemporaryMaterialCompletionStore } from "../../../backend/services/documents/dist/src/temporary-material-completion-store.js";

const dependency = createRequire(
  new URL("../../../backend/services/documents/package.json", import.meta.url),
);
const { v7: uuidv7 } = await import(pathToFileURL(dependency.resolve("uuid")).href);

/** Synthetic ledger effects only. No model/object call or purported remote stopping evidence. */
export async function seedResponseInventory(sql, ownerUserId) {
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("SyntheticUnexpectedObjectWrite");
    },
    read: async () => {
      throw Error("SyntheticUnexpectedObjectRead");
    },
  });
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  const responses = new PostgresCoverLetterResponseStore(sql, () => true);
  const fixtures = [];
  for (const [state, failure] of [
    ["reserved", null],
    ["acknowledged", null],
    ["disposed", null],
    ["acknowledged", "failed"],
    ["disposed", "failed"],
  ]) {
    const documentId = uuidv7();
    await documents.reserve({
      id: documentId,
      ownerUserId,
      applicationId: uuidv7(),
      jobRevision: "b".repeat(64),
      confirmedFactsHash: "c".repeat(64),
    });
    const { authorization } = await work.issue({
      ownerUserId,
      documentId,
      purpose: "provider_dispatch",
      requestSha256: "a".repeat(64),
      consentExpiresAt: new Date(Date.now() + 900_000),
    });
    const reference = {
      id: authorization.id,
      documentId,
      purpose: "provider_dispatch",
      requestSha256: authorization.requestSha256,
    };
    assert.equal((await work.claim(reference)).kind, "claimed");
    assert.equal((await responses.reserve(reference)).kind, "reserved");
    const response = {
      schemaVersion: 1,
      responseId: `resp_${uuidv7().replaceAll("-", "")}`,
      createdAt: Math.floor(Date.now() / 1000),
    };
    if (state !== "reserved") await responses.recordCreation(reference, response);
    if (failure)
      await work.settleTerminalProviderDispatch(reference, {
        kind: "terminal_no_content",
        reference: response,
        terminalStatus: failure,
      });
    if (state === "disposed")
      await responses.recordDisposal(reference, {
        kind: "response_deleted",
        reference: response,
        terminalStatus: failure ?? "cancelled",
      });
    fixtures.push({ reference, snapshot: await responses.read(reference), response, failure });
  }
  return fixtures;
}

export async function exerciseRestoredResponseInventory(sql, fixtures) {
  const responses = new PostgresCoverLetterResponseStore(sql, () => true);
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  let unresolvedInventoryDeletesRejected = 0;
  let failureProofRowsRestored = 0;
  let failureProofMutationsRejected = 0;
  for (const { reference, snapshot, response, failure } of fixtures) {
    assert.deepEqual(await responses.read(reference), snapshot);
    assert.equal((await responses.reserve(reference)).kind, "already_reserved");
    if (snapshot.state === "reserved") {
      await assert.rejects(
        responses.recordDisposal(reference, {
          kind: "response_deleted",
          reference: response,
          terminalStatus: failure ?? "cancelled",
        }),
        { message: "CoverLetterResponseUnavailable" },
      );
    } else {
      await responses.recordCreation(reference, response);
      await assert.rejects(
        responses.recordCreation(reference, {
          ...response,
          responseId: `resp_${uuidv7().replaceAll("-", "")}`,
        }),
        { message: "CoverLetterResponseUnavailable" },
      );
      if (snapshot.state === "disposed")
        await responses.recordDisposal(reference, {
          kind: "response_deleted",
          reference: response,
          terminalStatus: failure ?? "cancelled",
        });
    }
    assert.deepEqual(await responses.read(reference), snapshot);
    const [original] =
      await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id = ${reference.id}`;
    assert.equal(original.state, failure ? "settled" : "running");
    assert.deepEqual(await responses.readFailed(reference), failure ? snapshot : null);
    const [proof] =
      await sql`SELECT provider_failure AS failure FROM documents.cover_letter_work_authorizations WHERE id = ${reference.id}`;
    assert.equal(proof.failure, failure);
    if (failure) {
      failureProofRowsRestored++;
      await assert.rejects(
        sql`UPDATE documents.cover_letter_work_authorizations SET provider_failure = NULL WHERE id = ${reference.id}`,
        { code: "55000" },
      );
      await assert.rejects(work.settleRejectedProviderDispatch(reference), {
        message: "CoverLetterWorkUnavailable",
      });
      failureProofMutationsRejected++;
    }
    // All work here is synthetic ledger-only: explicit test settlement cannot stand in for a
    // real provider's positive stopping evidence. Retention still protects unresolved rows.
    await work.recordSettled(reference);
    if (snapshot.state !== "disposed") {
      await assert.rejects(async () => {
        await sql`DELETE FROM documents.cover_letters WHERE id = ${reference.documentId}`;
      });
      unresolvedInventoryDeletesRejected++;
      assert.deepEqual(await responses.read(reference), snapshot);
    }
  }
  return {
    failureProofRowsRestored,
    failureProofMutationsRejected,
    populatedResponseRowsRestored: fixtures.length,
    responseReservationReplaysDenied: fixtures.length,
    unresolvedInventoryDeletesRejected,
  };
}

/** Original completion tuple survives logical recovery; generated content never enters SQL. */
export async function seedTemporaryMaterialCompletion(sql, ownerUserId) {
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("SyntheticUnexpectedObjectWrite");
    },
    read: async () => {
      throw Error("SyntheticUnexpectedObjectRead");
    },
  });
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  const documentId = uuidv7();
  const reserved = await documents.reserve({
    id: documentId,
    ownerUserId,
    applicationId: uuidv7(),
    jobRevision: "b".repeat(64),
    confirmedFactsHash: "c".repeat(64),
  });
  const { authorization } = await work.issue({
    ownerUserId,
    documentId,
    purpose: "provider_dispatch",
    requestSha256: "a".repeat(64),
    consentExpiresAt: new Date(Date.now() + 900000),
  });
  const reference = {
    id: authorization.id,
    documentId,
    purpose: "provider_dispatch",
    requestSha256: authorization.requestSha256,
  };
  assert.equal((await work.claim(reference)).kind, "claimed");
  const completedAtMs = Date.now();
  const material = {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: documentId,
    ownerUserId,
    applicationId: reserved.applicationId,
    version: reserved.version,
    contentSha256: "d".repeat(64),
    completedAtMs,
    expiresAtMs: completedAtMs + 1800000,
  };
  assert.equal(
    await new PostgresTemporaryMaterialCompletionStore(sql, () => true).claimOriginalCompletion(
      reference,
      material,
    ),
    "claimed",
  );
  return { reference, material };
}

export async function exerciseRestoredTemporaryMaterialCompletion(sql, { reference, material }) {
  const completion = new PostgresTemporaryMaterialCompletionStore(sql, () => true);
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  assert.equal(await completion.claimOriginalCompletion(reference, material), "already_completed");
  assert.equal(
    await completion.claimOriginalCompletion(reference, {
      ...material,
      completedAtMs: material.completedAtMs + 1,
      expiresAtMs: material.expiresAtMs + 1,
    }),
    "unavailable",
  );
  await assert.rejects(
    sql`UPDATE documents.cover_letters SET material_completed_at_ms = material_completed_at_ms + 1, material_expires_at_ms = material_expires_at_ms + 1 WHERE id = ${reference.documentId}`,
    { code: "55000" },
  );
  await assert.rejects(
    sql`UPDATE documents.cover_letters SET material_work_id = NULL, material_sha256 = NULL, material_completed_at_ms = NULL, material_expires_at_ms = NULL WHERE id = ${reference.documentId}`,
    { code: "55000" },
  );
  assert.equal(await work.fenceForCleanup(reference), "pending");
  await assert.rejects(
    sql`DELETE FROM documents.cover_letters WHERE id = ${reference.documentId}`,
    { code: "55000" },
  );
  // Explicit synthetic settlement only; no real writer exists in this fixture.
  await work.recordSettled(reference);
  assert.equal(await work.fenceForCleanup(reference), "ledger_terminal");
  await sql`DELETE FROM documents.cover_letters WHERE id = ${reference.documentId}`;
  return {
    temporaryCompletionRowsRestored: 1,
    temporaryCompletionRenewalsRejected: 3,
    temporaryCompletionUnsettledDeletesRejected: 1,
  };
}
