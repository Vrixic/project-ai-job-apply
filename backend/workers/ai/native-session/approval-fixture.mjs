// Explicit synthetic local Linux/PostgreSQL composition; no managed provider or cloud call.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import dns from "node:dns";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createTestTokenIssuer } from "../../../../packages/auth/src/testing.ts";
import { createApplicationsRuntime } from "../../../gateway/src/applications-runtime.ts";
import {
  createNativeMaterialAvailability,
  withNativeMaterialCredential,
} from "../../../gateway/src/native-material-availability.ts";
import { createApplicationsDatabase } from "../../../services/applications/src/database.ts";
import { createRestrictedPacketKmsCipher } from "../../../services/applications/src/restricted-packet-runtime.ts";
import { PostgresApplicationStore } from "../../../services/applications/src/store.ts";
import { createNativeMemoryTransport } from "../../../services/documents/src/native-memory-transport.ts";

export async function prepareNativeApproval(ids) {
  assert.equal(process.env.NODE_ENV, "test");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: uncached explicit local runner, never a workspace task.
  assert.equal(process.env.NATIVE_APPROVAL_DATABASE, "synthetic-local-only");
  const owner = randomUUID();
  ids[0] = `${owner.slice(0, 14)}7${owner.slice(15)}`;
  const sql = createApplicationsDatabase(
    "postgres://synthetic:synthetic_local_only@127.0.0.1:5432/native_approval",
    { maxConnections: 2 },
  );
  const encryptionKeyArn =
    "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111";
  const fingerprintKeyArn = encryptionKeyArn.replaceAll(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );
  const material = randomBytes(32);
  const cipher = createRestrictedPacketKmsCipher({
    encryptionKeyArn,
    fingerprintKeyArn,
    enabled: () => true,
    testClient: {
      async send(command) {
        if (command.input.KeySpec === "AES_256")
          return {
            KeyId: encryptionKeyArn,
            Plaintext: Buffer.from(material),
            CiphertextBlob: Buffer.alloc(40, 7),
          };
        if (command.input.EncryptionAlgorithm === "SYMMETRIC_DEFAULT")
          return {
            KeyId: encryptionKeyArn,
            EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
            Plaintext: Buffer.from(material),
          };
        assert.equal(command.input.MacAlgorithm, "HMAC_SHA_256");
        return {
          KeyId: fingerprintKeyArn,
          MacAlgorithm: "HMAC_SHA_256",
          Mac: createHmac("sha256", material).update(command.input.Message).digest(),
        };
      },
    },
  });
  const restrictedPackets = { cipher, fingerprintKeyArn, enabled: () => true };
  const store = new PostgresApplicationStore(sql, undefined, {
    definitions: new Map(),
    restrictedPackets,
  });
  const jobId = "019d04cf-1f80-7000-8000-000000000076";
  const nativeHost = `${ids[2]}.material.test.invalid`;
  let enabled = true;
  const availability = createNativeMaterialAvailability({
    enabled: () => enabled,
    coverLetter: {
      baseHost: "material.test.invalid",
      resolve: async () => `https://${nativeHost}:8443`,
    },
  });
  const api = createApplicationsRuntime({
    client: sql,
    restrictedPackets,
    definitions: new Map(),
    profile: { listProfileFacts: async () => ({ facts: [] }) },
    catalog: {
      getActiveJob: async () => null,
      resolveActiveJobSummaries: async () => ({
        catalogRevision: "synthetic",
        items: [
          {
            requestedJobId: jobId,
            job: {
              id: jobId,
              company: { id: jobId, name: "Synthetic" },
              title: "Engineer",
              locations: ["Remote"],
              firstObservedAt: new Date(),
              lastVerifiedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
            },
          },
        ],
      }),
    },
    temporaryMaterials: availability,
    nativeReadAuthorizationsEnabled: () => true,
  });
  await sql`INSERT INTO identity.users(id) VALUES (${ids[0]}) ON CONFLICT DO NOTHING`;
  const app = await api.create(ids[0], jobId, randomUUID());
  ids[1] = app.id;
  const form = { adapterId: "greenhouse", variantId: "synthetic-native", formHash: "a".repeat(64) };
  const prepared = await api.preparePacket(
    ids[0],
    app.id,
    { expectedRevision: app.revision, form },
    randomUUID(),
  );
  return async (session, generated) => {
    let server;
    const originalLookup = dns.lookup;
    try {
      const packeted = await store.createPacket({
        ownerUserId: ids[0],
        applicationId: app.id,
        expectedRevision: prepared.revision,
        idempotencyKey: randomUUID(),
        packet: {
          jobRevision: prepared.currentPacket.jobRevision,
          form,
          fields: [],
          temporaryMaterials: [generated.reference],
          artifactHashes: { coverLetter: generated.reference.contentSha256 },
        },
      });
      const issuer = await createTestTokenIssuer();
      const token = await issuer.issue("synthetic-candidate", {
        scope: "applications:read applications:write",
      });
      let authorizations = 0;
      server = createNativeMemoryTransport({
        session,
        reference: generated.reference,
        enabled: () => true,
        identity: {
          issuer: "https://test-issuer.invalid/",
          audience: "ai-job-apply-api",
          subject: "synthetic-candidate",
        },
        host: `${nativeHost}:8443`,
        origin: "https://candidate.test.invalid",
        tls: { key: readFileSync("/native/key.pem"), cert: readFileSync("/native/cert.pem") },
        testVerifier: issuer.verifier,
        authorize: async (owner, application, reference, signal, forwardedToken) => {
          assert.equal(forwardedToken, token);
          authorizations++;
          const proof = await api.temporaryMaterialAuthorization(
            owner,
            application,
            reference.generationId,
            signal,
          );
          return {
            schemaVersion: 1,
            packetId: proof.packetId,
            packetHash: proof.packetHash,
            reference: {
              ...proof.temporaryMaterial,
              ownerUserId: owner,
              applicationId: application,
            },
          };
        },
      });
      server.listen(8443, "127.0.0.1");
      await once(server, "listening");
      dns.lookup = (hostname, options, callback) => {
        if (hostname !== nativeHost) return originalLookup(hostname, options, callback);
        queueMicrotask(() =>
          options.all
            ? callback(null, [{ address: "127.0.0.1", family: 4 }])
            : callback(null, "127.0.0.1", 4),
        );
      };
      const request = {
        expectedRevision: packeted.view.application.revision,
        packetHash: packeted.view.currentPacket.packetHash,
        acknowledgedFieldKeys: [],
      };
      await assert.rejects(api.approve(ids[0], app.id, request, randomUUID()));
      assert.equal((await store.getApplication(ids[0], app.id)).approval, null);
      const approved = await withNativeMaterialCredential(ids[0], app.id, token, () =>
        api.approve(ids[0], app.id, request, randomUUID()),
      );
      assert.equal(approved.status, "approved");
      assert.equal(
        new Date(approved.approval.expiresAt).getTime(),
        generated.reference.expiresAtMs,
      );
      assert.ok(authorizations >= 2);
      assert.equal(
        (await store.getApplication(ids[0], app.id)).approval.packetHash,
        request.packetHash,
      );
      enabled = false;
      await assert.rejects(
        withNativeMaterialCredential(ids[0], app.id, token, () =>
          availability.current(ids[0], app.id, generated.reference),
        ),
      );
      process.stdout.write("native-postgresql-approval:ok\n");
    } finally {
      dns.lookup = originalLookup;
      if (server) await new Promise((resolve) => server.close(resolve));
      await sql.end();
      material.fill(0);
    }
  };
}
