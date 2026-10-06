// Generated synthetic inputs only; actual runtime, SDK, renderer, HTTPS and kernel process.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { createRequire } from "node:module";
import { coverLetterContext } from "../../../../packages/ai-sdk/src/index.ts";
import { compileComponentValidator } from "../../../../packages/api-contracts/src/index.ts";
import { createTestTokenIssuer } from "../../../../packages/auth/src/testing.ts";
import { createCoverLetterProviderControlHandler } from "../../../services/documents/src/cover-letter-provider-control-handler.ts";
import { createNativeCoverLetterRuntime } from "../../../services/documents/src/native-cover-letter-runtime.ts";
import { startNativeImage } from "../../../services/documents/src/native-image-runtime.ts";
import { nativeOwnerJson } from "../../../services/documents/src/native-owner-rpc-contract.ts";
import { createNativeOwnerRpcHandler } from "../../../services/documents/src/native-owner-rpc-handler.ts";
import { createNativeReadAuthorizationClient } from "../../../services/documents/src/native-read-authorization-client.ts";
import { startNativeMaterialTask } from "../../../services/documents/src/native-task-bootstrap.ts";
import { prepareOriginalCoverLetterRequest } from "../../../services/documents/src/original-cover-letter-generation.ts";
import { createTemporaryMaterialCompletionHandler } from "../../../services/documents/src/temporary-material-completion-handler.ts";

export async function exerciseNativeRuntime(mode, kernelPath, externalImage = false) {
  const ids = [1, 2, 3, 4, 5, 6].map(
    (n) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`,
  );
  const facts = [
    {
      id: ids[3],
      kind: "skill",
      key: "skill",
      value: "TypeScript",
      verification: "confirmed",
      sensitivity: "standard",
      source: { type: "user", reference: "synthetic" },
      version: 1,
    },
  ];
  const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
  const now = new Date();
  const identity = {
    id: ids[2],
    ownerUserId: ids[0],
    applicationId: ids[1],
    ...coverLetterContext({ facts, job, now }),
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: now,
    expiresAt: new Date(now.getTime() + 900_000),
  };
  const prepared = prepareOriginalCoverLetterRequest(identity, { facts, job, now });
  assert.ok(prepared);
  const original = {
    id: ids[4],
    documentId: ids[2],
    purpose: "provider_dispatch",
    requestSha256: prepared.requestSha256,
  };
  prepared.request.system = "";
  prepared.request.user = "";
  const allocation = {
    allocationId: ids[5],
    ownerUserId: ids[0],
    applicationId: ids[1],
    generationId: ids[2],
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
    taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
    containerName: "material",
  };
  const binding = {
    allocation,
    original,
    scope: {
      allocationId: ids[5],
      ownerUserId: ids[0],
      applicationId: ids[1],
      generationId: ids[2],
      epochId: ids[4],
    },
  };
  let providerCalls = 0,
    controlInvocations = 0,
    admissions = 0;
  const imageMode = mode.startsWith("runtime-image");
  const bootstrapMode = mode.startsWith("runtime-bootstrap") || imageMode;
  const workTarget = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-work:9";
  const completionTarget = bootstrapMode
    ? workTarget
    : "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-completion:7";
  const workHandler = createCoverLetterProviderControlHandler({
    functionArn: workTarget,
    enabled: () => true,
    work: {
      claimProviderDispatch: async () => ({ kind: "claimed", reference: original }),
      settleProviderDispatch: async () => {},
    },
  });
  const completionHandler = createTemporaryMaterialCompletionHandler({
    functionArn: completionTarget,
    enabled: () => true,
    store: { claimOriginalCompletion: async () => "claimed" },
  });
  const issuer = await createTestTokenIssuer();
  const token = await issuer.issue("synthetic-candidate", { scope: "applications:read" });
  const certificate = readFileSync("/native/cert.pem");
  let reference;
  const documentVersion = mode === "runtime-image-version-two" ? 2 : 1;
  const options = {
    documentVersion,
    binding,
    identity,
    enabled: () => true,
    maximumLifetimeMs: 5000,
    bootBudgetMs: 10_000,
    checkAdmission: async (fixed) => {
      assert.deepEqual(fixed, binding);
      admissions++;
      if (mode === "runtime-revoked" && admissions === 3)
        throw Error("synthetic-private-secret-not-logged");
    },
    loadKernel: () => createRequire(import.meta.url)(kernelPath),
    source: { load: async () => ({ facts, job }) },
    provider: {
      identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
      complete: async () => {
        providerCalls++;
        return {
          text: JSON.stringify({
            paragraphs: [{ text: "I have experience with TypeScript.", factIds: [ids[3]] }],
          }),
        };
      },
    },
    controls: {
      workFunctionArn: workTarget,
      completionFunctionArn: completionTarget,
      testClient: {
        send: async (command) => {
          controlInvocations++;
          if (mode === "runtime-controls-failure")
            return {
              StatusCode: 200,
              ExecutedVersion: "9",
              FunctionError: "Unhandled",
              Payload: new TextEncoder().encode("{}"),
            };
          const target = command.input.FunctionName;
          const input = JSON.parse(new TextDecoder().decode(command.input.Payload));
          const output =
            target === workTarget
              ? await workHandler(input, { invokedFunctionArn: target })
              : await completionHandler(input, { invokedFunctionArn: target });
          return {
            StatusCode: 200,
            ExecutedVersion: target === workTarget ? "9" : "7",
            Payload: new TextEncoder().encode(JSON.stringify(output)),
          };
        },
      },
    },
    transport: {
      identity: {
        issuer: "https://test-issuer.invalid/",
        audience: "ai-job-apply-api",
        subject: "synthetic-candidate",
      },
      host: "material.test.invalid",
      origin: "https://candidate.test.invalid",
      tls: { key: readFileSync("/native/key.pem"), cert: certificate },
      testVerifier: issuer.verifier,
      authorize: createNativeReadAuthorizationClient({
        apiOrigin: "https://control.test.invalid",
        enabled: () => true,
        fetch: async (_url, init) => {
          assert.equal(
            (await issuer.verifier.verify(init.headers.authorization.slice(7))).subject,
            "synthetic-candidate",
          );
          const { ownerUserId: _owner, applicationId: _app, ...metadata } = reference;
          return new Response(
            JSON.stringify({
              schemaVersion: 1,
              packetId: ids[4],
              packetHash: "b".repeat(64),
              temporaryMaterial: metadata,
            }),
            { headers: { "cache-control": "no-store", "content-type": "application/json" } },
          );
        },
      }),
    },
  };
  let permitted = true;
  let metadataReads = 0,
    portLoads = 0;
  const self = {
    DockerId: `${"a".repeat(32)}-1234567890`,
    Name: "material",
    Type: "NORMAL",
    Image: "synthetic-pinned-image",
    ImageID: `sha256:${"b".repeat(64)}`,
    DesiredStatus: "RUNNING",
    KnownStatus: "RUNNING",
    Labels: {
      "com.amazonaws.ecs.task-arn": allocation.taskArn,
      "com.amazonaws.ecs.cluster": allocation.clusterArn,
      "com.amazonaws.ecs.container-name": "material",
      "com.amazonaws.ecs.task-definition-family": "native",
      "com.amazonaws.ecs.task-definition-version": "3",
    },
  };
  const receiver = createNativeOwnerRpcHandler({
    targetArn: workTarget,
    taskRoleArn: "arn:aws:iam::123456789012:role/native-task",
    deployment: allocation,
    enabled: () => true,
    testFetch: async () =>
      new Response(
        `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-task/${"a".repeat(32)}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${"a".repeat(32)}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
        { headers: { "content-type": "text/xml" } },
      ),
    owners: async () => ({
      checkAdmission: async (fixed) => {
        assert.deepEqual(fixed, binding);
        admissions++;
        if (mode === "runtime-bootstrap-admission-refused") throw Error("SyntheticUnbound");
        if (mode === "runtime-bootstrap-delayed" && admissions === 1)
          throw Error("SyntheticPendingBind");
        if (mode === "runtime-bootstrap-revoked" && admissions >= 10)
          throw Error("SyntheticRevoked");
      },
      bootstrap: async () => ({
        documentVersion,
        ...identity,
        approvedAt: identity.approvedAt.toISOString(),
        expiresAt: identity.expiresAt.toISOString(),
      }),
      principal: async (_binding, requestedIssuer) => ({
        issuer: requestedIssuer,
        subject: "synthetic-candidate",
      }),
      evidence: () => ({ load: async () => ({ facts: structuredClone(facts), job: { ...job } }) }),
      work: async (input, context) => {
        controlInvocations++;
        return workHandler(input, context);
      },
      completion: async (input, context) => {
        controlInvocations++;
        return completionHandler(input, context);
      },
    }),
  });
  const bootstrapOptions = {
    deployment: allocation,
    ownerFunctionArn: workTarget,
    enabled: () => permitted,
    maximumLifetimeMs: options.maximumLifetimeMs,
    bootBudgetMs: options.bootBudgetMs,
    environment: () => ({
      ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/synthetic",
      NATIVE_MATERIAL_ALLOCATION_ID: ids[5],
      NATIVE_MATERIAL_OWNER_USER_ID: ids[0],
      NATIVE_MATERIAL_APPLICATION_ID: ids[1],
      NATIVE_MATERIAL_GENERATION_ID: ids[2],
      NATIVE_MATERIAL_EPOCH_ID: ids[4],
      NATIVE_MATERIAL_WORK_ID: ids[4],
      NATIVE_MATERIAL_REQUEST_SHA256: original.requestSha256,
    }),
    testFetch: async (url) => {
      metadataReads++;
      return new Response(
        JSON.stringify(
          String(url).endsWith("/task")
            ? {
                Cluster: allocation.clusterArn,
                TaskARN: allocation.taskArn,
                Family: "native",
                Revision: "3",
                LaunchType: "FARGATE",
                KnownStatus: "RUNNING",
                DesiredStatus: "RUNNING",
                Containers: [self],
              }
            : self,
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
    testCredentials: {
      accessKeyId: `ASIA${"A".repeat(16)}`,
      secretAccessKey: "synthetic-only-test-signing-secret",
      sessionToken: "synthetic-only-session",
    },
    testClient: {
      send: async (command) => {
        const raw = JSON.parse(new TextDecoder().decode(command.input.Payload));
        assert.ok(raw.proof && raw.binding && raw.request);
        const output = await receiver(raw, { invokedFunctionArn: workTarget });
        return {
          StatusCode: 200,
          ExecutedVersion: "9",
          Payload: new TextEncoder().encode(nativeOwnerJson(output)),
        };
      },
    },
    loadPorts: async () => {
      portLoads++;
      assert.equal(metadataReads, 2);
      assert.equal(providerCalls, 0);
      if (mode === "runtime-bootstrap-ports-revoked") permitted = false;
      return {
        provider: options.provider,
        transport: options.transport,
        loadKernel: options.loadKernel,
      };
    },
  };
  if (mode === "runtime-bootstrap-expired") {
    identity.approvedAt = new Date(Date.now() - 900_001);
    identity.expiresAt = new Date(identity.approvedAt.getTime() + 900_000);
  }
  if (
    [
      "runtime-bootstrap-expired",
      "runtime-bootstrap-admission-refused",
      "runtime-bootstrap-ports-revoked",
    ].includes(mode)
  ) {
    await assert.rejects(
      startNativeMaterialTask(bootstrapOptions),
      /NativeTaskBootstrapUnavailable/u,
    );
    assert.equal(providerCalls, 0);
    assert.equal(controlInvocations, 0);
    assert.equal(metadataReads, 2);
    assert.equal(portLoads, mode === "runtime-bootstrap-ports-revoked" ? 1 : 0);
    process.stdout.write(
      `${JSON.stringify({ bootstrapRefused: true, providerCalls, controlInvocations, metadataReads, portLoads })}\n`,
    );
    return;
  }
  const imageHost = `${ids[5]}.material.test.invalid`;
  const secretReference = (name) => ({
    arn: `arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic/${name}-Abc123`,
    versionId: "12345678-1234-1234-1234-123456789012",
  });
  const imageConfiguration = {
    schemaVersion: 1,
    enabled: true,
    providerEnabled: true,
    deployment: {
      clusterArn: allocation.clusterArn,
      taskDefinitionArn: allocation.taskDefinitionArn,
      containerName: allocation.containerName,
    },
    ownerFunctionArn: workTarget,
    providerSecret: secretReference("provider"),
    tlsSecret: secretReference("tls"),
    apiOrigin: "https://api.test.invalid",
    issuer: options.transport.identity.issuer,
    audience: options.transport.identity.audience,
    origin: options.transport.origin,
    baseHost: "material.test.invalid",
    port: 8443,
  };
  let secretReads = 0;
  const imageOptions = {
    configuration: imageConfiguration,
    loadKernel: options.loadKernel,
    maximumLifetimeMs: options.maximumLifetimeMs,
    testCredentials: bootstrapOptions.testCredentials,
    testMetadataFetch: bootstrapOptions.testFetch,
    testRpcClient: bootstrapOptions.testClient,
    testSecretClient: {
      send: async (command) => {
        secretReads++;
        assert.equal(command.input.VersionId, imageConfiguration.providerSecret.versionId);
        assert.equal(providerCalls, 0);
        const tls = command.input.SecretId === imageConfiguration.tlsSecret.arn;
        return {
          $metadata: {},
          ARN: command.input.SecretId,
          VersionId:
            mode === "runtime-image-secret-refused" ? "f".repeat(32) : command.input.VersionId,
          SecretString: tls
            ? JSON.stringify({
                key: readFileSync("/native/key.pem", "utf8"),
                cert: certificate.toString(),
              })
            : "synthetic-provider-key-never-real",
        };
      },
    },
    testModelFetch: async (url, init) => {
      providerCalls++;
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(init.method, "POST");
      const request = JSON.parse(init.body);
      assert.equal(request.store, false);
      assert.equal(request.background, false);
      assert.equal(request.stream, false);
      assert.equal(request.model, "gpt-6-luna");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    paragraphs: [{ text: "I have experience with TypeScript.", factIds: [ids[3]] }],
                  }),
                },
              ],
            },
          ],
        }),
      );
    },
    testAuthorizationFetch: async (url, init) => {
      const claims = await issuer.verifier.verify(
        init.headers.authorization.replace(/^Bearer /u, ""),
      );
      assert.equal(claims.subject, "synthetic-candidate");
      assert.equal(
        String(url),
        `https://api.test.invalid/v1/applications/${ids[1]}/cover-letter/authorization?generationId=${ids[2]}`,
      );
      const { ownerUserId: _owner, applicationId: _app, ...metadata } = reference;
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          packetId: ids[4],
          packetHash: "b".repeat(64),
          temporaryMaterial: metadata,
        }),
        { headers: { "content-type": "application/json", "cache-control": "no-store" } },
      );
    },
    testVerifier: issuer.verifier,
  };
  if (mode === "runtime-image-tls-refused") imageConfiguration.baseHost = "wrong.test.invalid";
  if (imageMode) Object.assign(process.env, bootstrapOptions.environment());
  if (["runtime-image-secret-refused", "runtime-image-tls-refused"].includes(mode)) {
    await assert.rejects(startNativeImage(imageOptions), /NativeImageConfigurationUnavailable/u);
    assert.equal(secretReads, 2);
    assert.equal(providerCalls, 0);
    assert.equal(controlInvocations, 0);
    process.stdout.write(
      `${JSON.stringify({ imageRefused: true, secretReads, providerCalls, controlInvocations })}\n`,
    );
    return;
  }
  const runtime = imageMode
    ? await startNativeImage(imageOptions)
    : bootstrapMode
      ? await startNativeMaterialTask(bootstrapOptions)
      : await createNativeCoverLetterRuntime(options);
  if (bootstrapMode) {
    assert.equal(metadataReads, 2);
    assert.equal(portLoads, imageMode ? 0 : 1);
    await assert.rejects(
      externalImage ? startNativeImage(imageOptions) : startNativeMaterialTask(bootstrapOptions),
      externalImage ? /NativeImageConfigurationUnavailable/u : /NativeTaskBootstrapUnavailable/u,
    );
    assert.equal(portLoads, imageMode ? 0 : 1);
  }
  reference = runtime.reference;
  assert.equal(reference.version, documentVersion);
  assert.equal(providerCalls, 1);
  assert.equal(controlInvocations, 3);
  assert.equal(Object.hasOwn(runtime, "reader"), false);
  assert.equal(Object.hasOwn(runtime, "session"), false);
  assert.ok(Object.isFrozen(runtime.reference) && Object.isFrozen(runtime.letter.sourceFactIds));
  if (!externalImage)
    await assert.rejects(
      createNativeCoverLetterRuntime(options),
      /NativeCoverLetterRuntimeUnavailable/u,
    );
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  let files = 0;
  for (const suffix of ["", "/file?format=pdf", "/file?format=docx"]) {
    const result = await new Promise((resolve, reject) => {
      const call = request(
        {
          hostname: "127.0.0.1",
          port: runtime.server.address().port,
          path: `/v1/applications/${ids[1]}/cover-letter${suffix}`,
          servername: imageMode ? imageHost : "material.test.invalid",
          ca: certificate,
          minVersion: "TLSv1.3",
          headers: {
            host: imageMode ? `${imageHost}:8443` : "material.test.invalid",
            authorization: `Bearer ${token}`,
            origin: "https://candidate.test.invalid",
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              bytes: Buffer.concat(chunks),
            }),
          );
          response.on("error", reject);
        },
      );
      call.on("error", reject);
      call.end();
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    const data = JSON.parse(result.bytes.toString());
    assert.equal(
      compileComponentValidator(
        suffix ? "ApplicationCoverLetterFile" : "ApplicationCoverLetterPreview",
      )(data),
      true,
    );
    assert.equal(data.temporaryMaterial.expiresAtMs, reference.expiresAtMs);
    if (suffix) {
      const bytes = Buffer.from(data.contentBase64, "base64");
      assert.ok(bytes.length > 100);
      assert.equal(
        bytes.subarray(0, suffix.includes("pdf") ? 4 : 2).toString(),
        suffix.includes("pdf") ? "%PDF" : "PK",
      );
      bytes.fill(0);
      files++;
    } else assert.ok(data.paragraphs[0].text.includes("TypeScript"));
    result.bytes.fill(0);
  }
  assert.equal(controlInvocations, 3);
  assert.equal(providerCalls, 1);
  assert.ok(admissions >= 10);
  process.stdout.write(
    `${JSON.stringify({ ready: true, providerCalls, controlInvocations, actualFiles: files, originalCompletion: reference.completedAtMs, originalExpiry: reference.expiresAtMs })}\n`,
  );
  if (mode === "runtime-terminate") runtime.terminate();
  setInterval(() => {}, 5000);
  await new Promise(() => {});
}
