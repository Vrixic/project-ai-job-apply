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
import { createNativeReadAuthorizationClient } from "../../../services/documents/src/native-read-authorization-client.ts";
import { prepareOriginalCoverLetterRequest } from "../../../services/documents/src/original-cover-letter-generation.ts";
import { createTemporaryMaterialCompletionHandler } from "../../../services/documents/src/temporary-material-completion-handler.ts";

export async function exerciseNativeRuntime(mode, kernelPath) {
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
  const workTarget = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-work:9";
  const completionTarget =
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-completion:7";
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
  const options = {
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
  const runtime = await createNativeCoverLetterRuntime(options);
  reference = runtime.reference;
  assert.equal(providerCalls, 1);
  assert.equal(controlInvocations, 3);
  assert.equal(Object.hasOwn(runtime, "reader"), false);
  assert.equal(Object.hasOwn(runtime, "session"), false);
  assert.ok(Object.isFrozen(runtime.reference) && Object.isFrozen(runtime.letter.sourceFactIds));
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
          servername: "material.test.invalid",
          ca: certificate,
          minVersion: "TLSv1.3",
          headers: {
            host: "material.test.invalid",
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
