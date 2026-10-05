import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PostgresCoverLetterResponseStore } from "../../../backend/services/documents/dist/src/cover-letter-response-store.js";
import { PostgresCoverLetterStore } from "../../../backend/services/documents/dist/src/cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "../../../backend/services/documents/dist/src/cover-letter-work-store.js";

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
