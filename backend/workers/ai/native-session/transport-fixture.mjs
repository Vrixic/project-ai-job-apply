// Synthetic HTTPS acceptance inside the actual Linux kernel-bounded material process.
import assert from "node:assert/strict";
import dns from "node:dns";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { compileComponentValidator } from "../../../../packages/api-contracts/src/index.ts";
import { createTestTokenIssuer } from "../../../../packages/auth/src/testing.ts";
import {
  createNativeMaterialAvailability,
  withNativeMaterialCredential,
} from "../../../gateway/src/native-material-availability.ts";
import { authorizeNativeMaterialRead } from "../../../services/applications/src/native-material-read.ts";
import { createNativeMemoryTransport } from "../../../services/documents/src/native-memory-transport.ts";
import { createNativeReadAuthorizationClient } from "../../../services/documents/src/native-read-authorization-client.ts";

export async function exerciseNativeTransport(session, generated, ids) {
  const issuer = await createTestTokenIssuer();
  const token = await issuer.issue("synthetic-candidate", { scope: "applications:read" });
  const foreign = await issuer.issue("other-candidate", { scope: "applications:read" });
  const unscoped = await issuer.issue("synthetic-candidate", { scope: "profile:read" });
  const nativeHost = `${ids[2]}.material.test.invalid`;
  const certificate = readFileSync("/native/cert.pem");
  let mode = "ready";
  let reads = 0;
  let resume;
  let pendingSignal;
  const view = () => ({
    application: {
      id: ids[1],
      ownerUserId: ids[0],
      status: mode === "terminal" ? "applied" : "review_required",
      currentPacketId: ids[4],
    },
    currentPacket: {
      userId: ids[0],
      applicationId: ids[1],
      id: ids[4],
      packetHash: (mode === "packet_race" && reads > 1 ? "c" : "b").repeat(64),
      artifactHashes: { coverLetter: generated.reference.contentSha256 },
      temporaryMaterials: [generated.reference],
    },
  });
  const transportOptions = {
    session,
    reference: generated.reference,
    enabled: () => mode !== "disabled",
    identity: {
      issuer: "https://test-issuer.invalid/",
      audience: "ai-job-apply-api",
      subject: "synthetic-candidate",
    },
    host: `${nativeHost}:8443`,
    origin: "https://candidate.test.invalid",
    tls: { key: readFileSync("/native/key.pem"), cert: certificate },
    testVerifier: issuer.verifier,
    authorize: createNativeReadAuthorizationClient({
      apiOrigin: "https://control.test.invalid",
      enabled: () => mode !== "disabled",
      fetch: async (url, init) => {
        assert.equal(
          url,
          `https://control.test.invalid/v1/applications/${ids[1]}/cover-letter/authorization?generationId=${ids[2]}`,
        );
        assert.equal(init.headers.authorization, `Bearer ${token}`);
        const principal = await issuer.verifier.verify(init.headers.authorization.slice(7));
        assert.equal(principal.subject, "synthetic-candidate");
        const ownerUserId = ids[0];
        const reference = generated.reference;
        const signal = init.signal;
        reads++;
        if (mode === "outage") throw Error("synthetic-private-secret-not-logged");
        if (mode === "pending")
          await new Promise((resolve) => {
            resume = resolve;
            pendingSignal = signal;
          });
        const proof = await authorizeNativeMaterialRead({
          ownerUserId,
          reference,
          signal,
          store: { getApplication: async () => view() },
        });
        const headers = { "cache-control": "no-store", "content-type": "application/json" };
        if (!proof) return new Response("{}", { status: 409, headers });
        const { ownerUserId: _owner, applicationId: _application, ...metadata } = proof.reference;
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            packetId: proof.packetId,
            packetHash: proof.packetHash,
            temporaryMaterial: metadata,
          }),
          { headers },
        );
      },
    }),
  };
  process.env.NODE_ENV = "production";
  assert.throws(
    () => createNativeMemoryTransport(transportOptions),
    /NativeMemoryTransportUnavailable/u,
  );
  process.env.NODE_ENV = "test";
  const server = createNativeMemoryTransport(transportOptions);
  server.listen(8443, "127.0.0.1");
  await once(server, "listening");
  const path = `/v1/applications/${ids[1]}/cover-letter`;
  const send = (url = path, authorization = `Bearer ${token}`, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: url,
          servername: nativeHost,
          ca: certificate,
          minVersion: "TLSv1.3",
          ...extra.tls,
          headers: {
            host: `${nativeHost}:8443`,
            ...(authorization ? { authorization } : {}),
            ...extra.headers,
          },
          method: extra.method ?? "GET",
          agent: false,
        },
        (res) => {
          const buffers = [];
          res.on("data", (chunk) => buffers.push(chunk));
          res.on("end", () => {
            const bytes = Buffer.concat(buffers);
            for (const chunk of buffers) chunk.fill(0);
            resolve({ status: res.statusCode, headers: res.headers, bytes });
          });
        },
      );
      req.once("error", reject);
      req.end();
      extra.capture?.(req);
    });
  let assertions = 1;
  const expectStatus = async (status, ...args) => {
    const result = await send(...args);
    assert.equal(result.status, status);
    assert.equal(result.headers["cache-control"], "no-store");
    if (status !== 200) assert.ok(!result.bytes.includes("TypeScript"));
    result.bytes.fill(0);
    assertions++;
  };
  for (const suffix of ["", "/file?format=pdf", "/file?format=docx"]) {
    const result = await send(`${path}${suffix}`, `Bearer ${token}`, {
      headers: { origin: "https://candidate.test.invalid" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["access-control-allow-origin"], "https://candidate.test.invalid");
    const data = JSON.parse(result.bytes.toString());
    assert.equal(
      compileComponentValidator(
        suffix ? "ApplicationCoverLetterFile" : "ApplicationCoverLetterPreview",
      )(data),
      true,
    );
    assert.equal(data.temporaryMaterial.generationId, ids[2]);
    assert.equal(data.temporaryMaterial.expiresAtMs, generated.reference.expiresAtMs);
    assert.equal(Object.hasOwn(data.temporaryMaterial, "ownerUserId"), false);
    if (!suffix) assert.ok(data.paragraphs[0].text.includes("TypeScript"));
    else assert.equal(data.contentBase64, "eA==");
    result.bytes.fill(0);
    assertions++;
  }
  const available = await send(path, `Bearer ${token}`, { method: "HEAD" });
  assert.equal(available.status, 204);
  assert.equal(available.bytes.byteLength, 0);
  assert.equal(available.headers["cache-control"], "no-store");
  assert.deepEqual(
    JSON.parse(
      Buffer.from(available.headers["x-native-material-reference"], "base64url").toString("utf8"),
    ),
    generated.reference,
  );
  assertions++;
  // Exercise the production Gateway client over real TLS with a synthetic DNS mapping.
  // The verifier process trusts only the generated test CA through NODE_EXTRA_CA_CERTS.
  const originalLookup = dns.lookup;
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== nativeHost) return originalLookup(hostname, options, callback);
    queueMicrotask(() =>
      options.all
        ? callback(null, [{ address: "127.0.0.1", family: 4 }])
        : callback(null, "127.0.0.1", 4),
    );
  };
  try {
    const availability = createNativeMaterialAvailability({
      enabled: () => true,
      coverLetter: {
        baseHost: "material.test.invalid",
        resolve: async () => `https://${nativeHost}:8443`,
      },
    });
    const current = await withNativeMaterialCredential(ids[0], ids[1], token, () =>
      availability.current(ids[0], ids[1], generated.reference),
    );
    assert.deepEqual(current, generated.reference);
    assertions++;
  } finally {
    dns.lookup = originalLookup;
  }
  await expectStatus(401, path, "", { method: "HEAD" });
  await expectStatus(403, path, `Bearer ${foreign}`, { method: "HEAD" });
  await expectStatus(400, `${path}/file?format=pdf`, `Bearer ${token}`, { method: "HEAD" });
  await expectStatus(401, path, "");
  await expectStatus(401, path, "Bearer forged.synthetic.token");
  await expectStatus(403, path, `Bearer ${foreign}`);
  await expectStatus(403, path, `Bearer ${unscoped}`);
  const before = reads;
  for (const url of [
    `${path}?owner=other`,
    `${path}/file?format=pdf&format=docx`,
    path.replace(ids[1], ids[2]),
    `${path}/file?format=txt`,
  ])
    await expectStatus(400, url);
  await expectStatus(400, path, `Bearer ${token}`, {
    headers: { origin: "https://unapproved.test.invalid" },
  });
  await expectStatus(400, path, `Bearer ${token}`, { method: "POST" });
  await expectStatus(400, path, `Bearer ${token}`, {
    headers: { authorization: [`Bearer ${token}`, `Bearer ${token}`] },
  });
  await expectStatus(400, path, `Bearer ${token}`, { headers: { host: "other.test.invalid" } });
  await expectStatus(400, path, `Bearer ${token}`, { headers: { "content-length": "1" } });
  await assert.rejects(
    send(path, `Bearer ${token}`, { tls: { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } }),
  );
  assertions++;
  assert.equal(reads, before);
  await expectStatus(204, path, "", {
    method: "OPTIONS",
    headers: {
      origin: "https://candidate.test.invalid",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(reads, before);
  for (const [testMode, status] of [
    ["terminal", 409],
    ["packet_race", 409],
    ["outage", 503],
    ["disabled", 503],
  ]) {
    mode = testMode;
    reads = 0;
    await expectStatus(status);
    reads = 0;
    await expectStatus(status, path, `Bearer ${token}`, { method: "HEAD" });
  }
  mode = "pending";
  reads = 0;
  const pending = send();
  while (!resume) await new Promise((resolve) => setTimeout(resolve, 1));
  await expectStatus(503);
  mode = "ready";
  resume();
  const result = await pending;
  assert.equal(result.status, 200);
  result.bytes.fill(0);
  assertions++;
  mode = "pending";
  resume = undefined;
  let client;
  const disconnected = send(path, `Bearer ${token}`, {
    capture: (req) => {
      client = req;
    },
  });
  const disconnectProof = assert.rejects(disconnected);
  while (!resume) await new Promise((resolve) => setTimeout(resolve, 1));
  client.destroy();
  await disconnectProof;
  while (!pendingSignal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
  // Disconnect requests cancellation but cannot free the unresolved private promise's slot.
  await expectStatus(503);
  mode = "ready";
  resume();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await expectStatus(200);
  assertions++;
  server.close();
  await once(server, "close");
  return assertions;
}
