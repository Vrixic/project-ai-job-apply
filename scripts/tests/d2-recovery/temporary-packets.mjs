import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "../../../backend/services/applications/dist/src/index.js";

const dependency = createRequire(
  new URL("../../../backend/services/applications/package.json", import.meta.url),
);
const { v7: uuidv7 } = await import(pathToFileURL(dependency.resolve("uuid")).href);
const key = () => `restore-material-${uuidv7()}`;
const hash = "c".repeat(64);

/** Scalar metadata and technical submission states only; no material, provider or ATS access. */
export async function seedTemporaryPackets(sql, ownerUserId, restrictedPackets) {
  const fixtures = [];
  for (const outcome of ["expired", "confirmed", "ambiguous"]) {
    const completedAtMs = Date.now() - (outcome === "expired" ? 1_800_001 : 1);
    const at = new Date(completedAtMs + 1);
    const store = new PostgresApplicationStore(sql, () => at, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets,
    });
    const created = await store.createApplication({
      ownerUserId,
      canonicalJobId: uuidv7(),
      idempotencyKey: key(),
    });
    const applicationId = created.view.application.id;
    const reference = {
      schemaVersion: 1,
      kind: "tailored_resume",
      generationId: uuidv7(),
      ownerUserId,
      applicationId,
      version: 1,
      contentSha256: hash,
      completedAtMs,
      expiresAtMs: completedAtMs + 1_800_000,
    };
    const packeted = await store.createPacket({
      ownerUserId,
      applicationId,
      expectedRevision: 1,
      idempotencyKey: key(),
      packet: {
        jobRevision: "a".repeat(64),
        form: null,
        fields: [],
        artifactHashes: { resume: hash },
        temporaryMaterials: [reference],
      },
    });
    const packet = packeted.view.currentPacket;
    assert.ok(packet);
    const current = {
      jobRevision: packet.jobRevision,
      resumeHash: hash,
      temporaryMaterials: [reference],
    };
    if (outcome !== "expired") {
      const approved = await store.approve({
        ownerUserId,
        applicationId,
        expectedRevision: 2,
        idempotencyKey: key(),
        current,
        request: { packetHash: packet.packetHash, consentId: uuidv7(), acknowledgedFieldKeys: [] },
      });
      const start = await store.startAttempt({
        ownerUserId,
        applicationId,
        expectedRevision: approved.view.application.revision,
        idempotencyKey: key(),
        current,
        adapterId: "synthetic",
        adapterVersion: "1",
      });
      assert.equal(start.kind, "started");
      await store.dispatchAttempt({
        ownerUserId,
        applicationId,
        attemptId: start.attempt.id,
        current,
      });
      await store.recordResult({
        ownerUserId,
        applicationId,
        attemptId: start.attempt.id,
        idempotencyKey: key(),
        result:
          outcome === "confirmed"
            ? {
                kind: "confirmed",
                evidence: {
                  kind: "provider_confirmation_page",
                  observedAt: at,
                  fingerprintSha256: hash,
                  adapterId: "synthetic",
                  adapterVersion: "1",
                },
              }
            : { kind: "timeout" },
      });
    }
    fixtures.push({
      outcome,
      ownerUserId,
      applicationId,
      packet,
      reference,
      current,
      original: await store.getApplication(ownerUserId, applicationId),
    });
  }
  return fixtures;
}

export async function exerciseRestoredTemporaryPackets(sql, fixtures, restrictedPackets) {
  for (const fixture of fixtures) {
    const { ownerUserId, applicationId, packet, reference, current, original, outcome } = fixture;
    const store = new PostgresApplicationStore(sql, () => new Date(reference.expiresAtMs), {
      definitions: defaultFieldDefinitions(),
      restrictedPackets,
    });
    assert.deepEqual(await store.getApplication(ownerUserId, applicationId), original);
    const [exported] =
      await sql`SELECT applications.export_candidate_data(${ownerUserId}::uuid) AS data`;
    assert.equal(Array.isArray(exported.data.applications.preparations), true);
    const portable = exported.data.applications.packets.find(
      (item) => item.id === packet.id,
    ).temporaryMaterials;
    assert.equal(portable.length, 1);
    assert.equal(portable[0].expiresAtMs, reference.expiresAtMs);
    assert.equal(Object.hasOwn(portable[0], "ownerUserId"), false);
    assert.equal(Object.hasOwn(portable[0], "applicationId"), false);
    if (outcome === "expired") {
      await assert.rejects(
        store.approve({
          ownerUserId,
          applicationId,
          expectedRevision: original.application.revision,
          idempotencyKey: key(),
          current,
          request: {
            packetHash: packet.packetHash,
            consentId: uuidv7(),
            acknowledgedFieldKeys: [],
          },
        }),
        { reasons: ["temporary_material_expired"] },
      );
      // Forged backdated authority is refused by the restored native trigger, independent of TS clock.
      await assert.rejects(
        sql`INSERT INTO applications.approvals
        (id,packet_id,application_id,owner_user_id,packet_hash,consent_id,acknowledged_field_keys,approved_at,expires_at)
        VALUES (${uuidv7()},${packet.id},${applicationId},${ownerUserId},${packet.packetHash},${uuidv7()},
          ARRAY[]::text[],${packet.createdAt},${new Date(reference.expiresAtMs)})`,
        { code: "55000" },
      );
    } else {
      await assert.rejects(
        store.dispatchAttempt({
          ownerUserId,
          applicationId,
          attemptId: original.attempts[0].id,
          current,
        }),
        { code: "ILLEGAL_ATTEMPT_TRANSITION" },
      );
    }
    await assert.rejects(
      sql`INSERT INTO applications.packets
      (id,application_id,owner_user_id,version,packet_hash,job_revision,form_adapter_id,form_variant_id,
       form_hash,resume_hash,cover_letter_hash,fields,created_at,temporary_materials)
      SELECT ${uuidv7()},application_id,owner_user_id,version+1,${"b".repeat(64)},job_revision,
        form_adapter_id,form_variant_id,form_hash,resume_hash,cover_letter_hash,fields,created_at,'[]'::jsonb
      FROM applications.packets WHERE id = ${packet.id}`,
      { code: "55000" },
    );
    assert.deepEqual(await store.getApplication(ownerUserId, applicationId), original);
  }
  return {
    temporaryPacketRowsRestored: fixtures.length,
    temporaryPacketOwnershipRedactionsVerified: fixtures.length,
    temporaryPacketBindingRemovalsRejected: fixtures.length,
    temporaryPacketExpiredAuthorityRejected: 2,
    temporaryPacketSettledRedispatchesRejected: 2,
  };
}
