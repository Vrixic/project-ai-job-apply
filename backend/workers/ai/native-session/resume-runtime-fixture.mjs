import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { createRequire } from "node:module";
import { compileComponentValidator } from "../../../../packages/api-contracts/src/index.ts";
import { createTestTokenIssuer } from "../../../../packages/auth/src/testing.ts";
import { authorizeNativeResumeRead } from "../../../services/applications/src/native-material-read.ts";
import { nativeOwnerJson } from "../../../services/documents/src/native-owner-rpc-contract.ts";
import { startNativeResumeImage } from "../../../services/documents/src/native-resume-image-runtime.ts";
import { createNativeResumeOwnerRpcClient } from "../../../services/documents/src/native-resume-owner-rpc-client.ts";
import { createNativeResumeOwnerRpcHandler } from "../../../services/documents/src/native-resume-owner-rpc-handler.ts";
import { createNativeResumeRuntime } from "../../../services/documents/src/native-resume-runtime.ts";
import { nativeResumeJobHash } from "../../../services/documents/src/native-resume-session.ts";
import { createNativeResumeSourceRpcClient } from "../../../services/documents/src/native-resume-source-rpc-client.ts";
import { createNativeResumeSourceRpcHandler } from "../../../services/documents/src/native-resume-source-rpc-handler.ts";
import { startNativeResumeTask } from "../../../services/documents/src/native-resume-task-bootstrap.ts";
import {
  SYNTHETIC_RESUME,
  syntheticDocument,
} from "../../../services/documents/src/resume-ast/test-support.ts";

export async function exerciseResumeRuntime(mode, kernelPath, imageStart = startNativeResumeImage) {
  const id = (n) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
  const job = { title: "Backend engineer", description: "TypeScript PostgreSQL APIs" };
  const document = syntheticDocument(SYNTHETIC_RESUME);
  const deployment = {
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
    containerName: "material",
  };
  const binding = {
    schemaVersion: 1,
    kind: "tailored_resume",
    configurationSha256: "f".repeat(64),
    scope: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      allocationId: id(4),
      epochId: id(5),
    },
    allocation: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      allocationId: id(4),
      ...deployment,
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
    },
  };
  const bootstrap = {
    identity: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      version: 1,
      baseDocumentId: document.documentId,
      baseVersion: document.version,
      baseSha256: document.sourceSha256,
      jobContextSha256: nativeResumeJobHash(job),
    },
    normalizedSha256: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
    canonicalJobId: id(6),
  };
  const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-owner:7";
  const sourceTarget = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-source:8";
  const credentials = {
    accessKeyId: "ASIASYNTHETICEXAMPLE",
    secretAccessKey: "synthetic-local-signing-secret-only",
    sessionToken: "synthetic-local-signing-token-only",
  };
  let admitted = true,
    kernelLoaded = false,
    loads = 0,
    claims = 0,
    readyCalls = 0,
    original,
    readMode = "ready",
    proofs = 0;
  const enabled = () => true;
  const checkAdmission = async (supplied) => {
    assert.deepEqual(supplied, binding);
    if (!admitted) throw Error("SyntheticAdmissionClosed");
  };
  const testFetch = async () =>
    new Response(
      `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-resume/${"a".repeat(32)}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${"a".repeat(32)}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
      { headers: { "content-type": "text/xml" } },
    );
  const common = {
    taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
    deployment,
    enabled,
    testFetch,
  };
  const owner = createNativeResumeOwnerRpcHandler({
    ...common,
    targetArn: target,
    owners: async () => ({
      checkAdmission,
      bootstrap: async () => structuredClone(bootstrap),
      principal: async (_binding, issuer) => ({ issuer, subject: "synthetic-candidate" }),
      claimOriginalCompletion: async (_binding, ref) => {
        assert.equal(kernelLoaded, true);
        assert.equal(claims++, 0);
        original = { ...ref };
        return "claimed";
      },
      publishReady: async (_binding, ref) => {
        assert.deepEqual(ref, original);
        readyCalls++;
        if (mode === "resume-runtime-ready-pending") await new Promise(() => {});
      },
    }),
  });
  const sourceHandler = createNativeResumeSourceRpcHandler({
    ...common,
    targetArn: sourceTarget,
    owners: async () => ({
      checkAdmission,
      load: async (_binding, expected) => {
        assert.equal(kernelLoaded, true);
        assert.deepEqual(expected, bootstrap);
        loads++;
        return { document, job };
      },
    }),
  });
  const testClient = {
    send: async (command) => {
      const input = JSON.parse(new TextDecoder().decode(command.input.Payload));
      const recipient = command.input.FunctionName;
      assert.ok(recipient === target || recipient === sourceTarget);
      const result = await (recipient === target ? owner : sourceHandler)(input, {
        invokedFunctionArn: recipient,
      });
      return {
        StatusCode: 200,
        ExecutedVersion: recipient === target ? "7" : "8",
        Payload: new TextEncoder().encode(nativeOwnerJson(result)),
      };
    },
  };
  const controls = createNativeResumeOwnerRpcClient({
    binding,
    targetArn: target,
    enabled,
    testClient,
    testCredentials: credentials,
  });
  const source = createNativeResumeSourceRpcClient({
    binding,
    bootstrap,
    targetArn: sourceTarget,
    enabled,
    testClient,
    testCredentials: credentials,
  });
  const issuer = await createTestTokenIssuer();
  const token = await issuer.issue("synthetic-candidate", { scope: "applications:read" });
  const foreign = await issuer.issue("other-candidate", { scope: "applications:read" });
  const unscoped = await issuer.issue("synthetic-candidate", { scope: "profile:read" });
  const certificate = readFileSync("/native/cert.pem");
  let releaseProof, pendingSignal;
  const transport = {
    identity: {
      issuer: "https://test-issuer.invalid/",
      audience: "ai-job-apply-api",
      subject: "synthetic-candidate",
    },
    host: "material.test.invalid",
    origin: "https://candidate.test.invalid",
    tls: { key: readFileSync("/native/key.pem"), cert: certificate },
    testVerifier: issuer.verifier,
    authorize: async (ownerUserId, applicationId, reference, signal, accessToken) => {
      assert.equal(accessToken, token);
      proofs++;
      if (readMode === "pending")
        await new Promise((resolve) => {
          releaseProof = resolve;
          pendingSignal = signal;
        });
      const packetHash = (readMode === "packet-race" && proofs > 1 ? "c" : "b").repeat(64);
      return authorizeNativeResumeRead({
        ownerUserId,
        reference,
        signal,
        store: {
          getApplication: async () => ({
            application: {
              id: applicationId,
              ownerUserId,
              status: readMode === "terminal" ? "applied" : "review_required",
              currentPacketId: id(7),
            },
            currentPacket: {
              id: id(7),
              applicationId,
              userId: ownerUserId,
              packetHash,
              artifactHashes: { resume: reference.contentSha256 },
              temporaryMaterials: [reference],
            },
          }),
        },
      });
    },
  };
  const loadKernel = () => {
    assert.equal(kernelLoaded, false);
    kernelLoaded = true;
    return createRequire(import.meta.url)(kernelPath);
  };
  const options = {
    binding,
    bootstrap,
    source,
    controls,
    loadKernel,
    transport,
    enabled,
    maximumLifetimeMs: 5000,
    bootBudgetMs: 5000,
  };
  let runtime;
  const imageMode = mode === "resume-runtime-image";
  const host = imageMode ? `${id(4)}.material.test.invalid:8443` : "material.test.invalid";
  if (mode === "resume-runtime-bootstrap" || imageMode) {
    const self = {
      DockerId: `${"a".repeat(32)}-1234567890`,
      Name: "material",
      Type: "NORMAL",
      Image: "synthetic-image",
      ImageID: `sha256:${"c".repeat(64)}`,
      DesiredStatus: "RUNNING",
      KnownStatus: "RUNNING",
      Labels: {
        "com.amazonaws.ecs.task-arn": binding.allocation.taskArn,
        "com.amazonaws.ecs.cluster": deployment.clusterArn,
        "com.amazonaws.ecs.container-name": "material",
        "com.amazonaws.ecs.task-definition-family": "native",
        "com.amazonaws.ecs.task-definition-version": "3",
      },
    };
    const task = {
      Cluster: deployment.clusterArn,
      TaskARN: binding.allocation.taskArn,
      Family: "native",
      Revision: "3",
      LaunchType: "FARGATE",
      DesiredStatus: "RUNNING",
      KnownStatus: "RUNNING",
      Containers: [self],
    };
    const environment = {
      ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/synthetic-endpoint",
      NATIVE_MATERIAL_OWNER_USER_ID: id(1),
      NATIVE_MATERIAL_APPLICATION_ID: id(2),
      NATIVE_MATERIAL_GENERATION_ID: id(3),
      NATIVE_MATERIAL_ALLOCATION_ID: id(4),
      NATIVE_MATERIAL_EPOCH_ID: id(5),
      NATIVE_RESUME_CONFIGURATION_SHA256: binding.configurationSha256,
    };
    const metadataFetch = async (url) =>
      new Response(JSON.stringify(String(url).endsWith("/task") ? task : self), {
        headers: { "content-type": "application/json" },
      });
    if (imageMode) {
      Object.assign(process.env, environment);
      const tlsSecret = {
        arn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic/tls-Abc123",
        versionId: "12345678-1234-1234-1234-123456789012",
      };
      let secretReads = 0;
      runtime = await imageStart({
        configuration: {
          schemaVersion: 1,
          enabled: true,
          deployment,
          ownerFunctionArn: target,
          sourceFunctionArn: sourceTarget,
          tlsSecret,
          apiOrigin: "https://api.test.invalid",
          issuer: transport.identity.issuer,
          audience: transport.identity.audience,
          origin: transport.origin,
          baseHost: "material.test.invalid",
          port: 8443,
        },
        loadKernel,
        testRpcClient: testClient,
        testCredentials: credentials,
        testMetadataFetch: metadataFetch,
        maximumLifetimeMs: 5000,
        testVerifier: issuer.verifier,
        testSecretClient: {
          send: async (command) => {
            assert.equal(secretReads++, 0);
            assert.equal(command.input.SecretId, tlsSecret.arn);
            assert.equal(command.input.VersionId, tlsSecret.versionId);
            return {
              ARN: tlsSecret.arn,
              VersionId: tlsSecret.versionId,
              SecretString: JSON.stringify({
                key: transport.tls.key.toString(),
                cert: certificate.toString(),
              }),
            };
          },
        },
        testAuthorizationFetch: async (url, init) => {
          assert.equal(
            url,
            `https://api.test.invalid/v1/applications/${id(2)}/resume/authorization?generationId=${id(3)}`,
          );
          const proof = await transport.authorize(
            id(1),
            id(2),
            original,
            init.signal,
            init.headers.authorization.slice(7),
          );
          const {
            ownerUserId: _owner,
            applicationId: _application,
            ...metadata
          } = proof?.reference ?? {};
          return new Response(
            JSON.stringify(
              proof
                ? {
                    schemaVersion: 1,
                    packetId: proof.packetId,
                    packetHash: proof.packetHash,
                    temporaryMaterial: metadata,
                  }
                : {},
            ),
            {
              status: proof ? 200 : 409,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        },
      });
      assert.equal(secretReads, 1);
    } else
      runtime = await startNativeResumeTask({
        deployment,
        ownerFunctionArn: target,
        sourceFunctionArn: sourceTarget,
        enabled,
        testClient,
        testCredentials: credentials,
        maximumLifetimeMs: 5000,
        bootBudgetMs: 5000,
        environment: () => ({
          ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/synthetic-endpoint",
          NATIVE_MATERIAL_OWNER_USER_ID: id(1),
          NATIVE_MATERIAL_APPLICATION_ID: id(2),
          NATIVE_MATERIAL_GENERATION_ID: id(3),
          NATIVE_MATERIAL_ALLOCATION_ID: id(4),
          NATIVE_MATERIAL_EPOCH_ID: id(5),
          NATIVE_RESUME_CONFIGURATION_SHA256: binding.configurationSha256,
        }),
        testFetch: async (url) =>
          new Response(JSON.stringify(String(url).endsWith("/task") ? task : self), {
            headers: { "content-type": "application/json" },
          }),
        loadPorts: async (context) => {
          assert.deepEqual(context.binding, binding);
          assert.deepEqual(context.identity, bootstrap);
          assert.equal(kernelLoaded, false);
          assert.equal(loads, 0);
          return { loadKernel, transport };
        },
      });
  } else runtime = await createNativeResumeRuntime(options);
  assert.equal(loads, 1);
  assert.equal(claims, 1);
  assert.equal(readyCalls, 1);
  assert.equal(Object.hasOwn(runtime, "session"), false);
  assert.equal(Object.hasOwn(runtime, "reader"), false);
  assert.deepEqual(runtime.reference, original);
  await assert.rejects(createNativeResumeRuntime(options), /NativeResumeRuntimeUnavailable/u);
  const server = runtime.server;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const path = `/v1/applications/${id(2)}/resume`;
  const send = (url = path, authorization = `Bearer ${token}`, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: url,
          servername: "material.test.invalid",
          ca: certificate,
          minVersion: "TLSv1.3",
          ...extra.tls,
          headers: {
            host,
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
  let assertions = 0,
    files = 0;
  const status = async (expected, ...args) => {
    const r = await send(...args);
    assert.equal(r.status, expected);
    assert.equal(r.headers["cache-control"], "no-store");
    r.bytes.fill(0);
    assertions++;
  };
  const available = await send(path, `Bearer ${token}`, { method: "HEAD" });
  assert.equal(available.status, 204);
  assert.equal(available.bytes.byteLength, 0);
  assert.equal(available.headers["cache-control"], "no-store");
  assert.deepEqual(
    JSON.parse(
      Buffer.from(available.headers["x-native-material-reference"], "base64url").toString("utf8"),
    ),
    original,
  );
  assertions++;
  for (const format of ["preview", "pdf"]) {
    const r = await send(
      format === "preview" ? path : `${path}/file?format=${format}`,
      `Bearer ${token}`,
      { headers: { origin: "https://candidate.test.invalid" } },
    );
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["access-control-allow-origin"], "https://candidate.test.invalid");
    const value = JSON.parse(r.bytes.toString());
    assert.equal(
      compileComponentValidator(
        format === "preview" ? "ApplicationResumePreview" : "ApplicationResumeFile",
      )(value),
      true,
    );
    assert.equal(value.temporaryMaterial.kind, "tailored_resume");
    assert.equal(value.temporaryMaterial.generationId, id(3));
    assert.equal(value.temporaryMaterial.expiresAtMs, original.expiresAtMs);
    assert.equal(Object.hasOwn(value.temporaryMaterial, "ownerUserId"), false);
    assert.equal(value.contentSha256, original.contentSha256);
    if (format !== "preview") {
      const bytes = Buffer.from(value.contentBase64, "base64");
      assert.ok(bytes.byteLength > 100);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), value.sha256);
      bytes.fill(0);
      value.contentBase64 = "";
      files++;
    } else assert.ok(value.sections.length > 0);
    r.bytes.fill(0);
    assertions++;
  }
  await status(401, path, "");
  await status(401, path, "Bearer forged.synthetic.token");
  await status(403, path, `Bearer ${foreign}`);
  await status(403, path, `Bearer ${unscoped}`);
  for (const url of [
    `${path}?owner=other`,
    `${path}/file?format=pdf&format=docx`,
    path.replace(id(2), id(3)),
    `${path}/file?format=txt`,
    path.replace("resume", "cover-letter"),
  ])
    await status(400, url);
  await status(400, path, `Bearer ${token}`, { headers: { origin: "https://wrong.test.invalid" } });
  await status(400, path, `Bearer ${token}`, { headers: { host: "wrong.test.invalid" } });
  await status(400, path, `Bearer ${token}`, {
    headers: { authorization: [`Bearer ${token}`, `Bearer ${token}`] },
  });
  await status(400, path, `Bearer ${token}`, { method: "POST" });
  await status(204, path, "", {
    method: "OPTIONS",
    headers: {
      origin: "https://candidate.test.invalid",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  await assert.rejects(
    send(path, `Bearer ${token}`, { tls: { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } }),
  );
  assertions++;
  for (const change of ["terminal", "packet-race"]) {
    readMode = change;
    proofs = 0;
    await status(409);
  }
  readMode = "pending";
  const pending = send();
  while (!releaseProof) await new Promise((resolve) => setTimeout(resolve, 1));
  await status(503);
  readMode = "ready";
  releaseProof();
  const result = await pending;
  assert.equal(result.status, 200);
  result.bytes.fill(0);
  assertions++;
  admitted = false;
  await status(503);
  admitted = true;
  assert.equal(loads, 1);
  assert.equal(claims, 1);
  assert.equal(readyCalls, 1);
  assert.ok(assertions >= 20);
  assert.equal(pendingSignal.aborted, true);
  process.stdout.write(
    `${JSON.stringify({ ready: true, runtimeAssertions: assertions, actualFiles: files, originalCompletion: original.completedAtMs, originalExpiry: original.expiresAtMs })}\n`,
  );
  if (mode === "resume-runtime-terminate") runtime.terminate();
  await new Promise(() => {});
}
