// Synthetic Linux child only. Native integration bundles this with the actual session/SDK.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { coverLetterContext } from "../../../../packages/ai-sdk/src/index.ts";
import { createCoverLetterProviderControlHandler } from "../../../services/documents/src/cover-letter-provider-control-handler.ts";
import { createNativeMaterialControls } from "../../../services/documents/src/native-material-controls.ts";
import { createNativeMemorySession } from "../../../services/documents/src/native-memory-session.ts";
import { prepareOriginalCoverLetterRequest } from "../../../services/documents/src/original-cover-letter-generation.ts";
import { createTemporaryMaterialCompletionHandler } from "../../../services/documents/src/temporary-material-completion-handler.ts";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
const kernelPath = process.argv[3];
if (mode.startsWith("resume-runtime")) {
  const { exerciseResumeRuntime } = await import("./resume-runtime-fixture.mjs");
  await exerciseResumeRuntime(mode, kernelPath);
  process.exit(0);
}
if (mode.startsWith("resume-")) {
  const { exerciseNativeResume } = await import("./resume-fixture.mjs");
  await exerciseNativeResume(mode, kernelPath);
  process.exit(0);
}
if (mode.startsWith("runtime")) {
  const { exerciseNativeRuntime } = await import("./runtime-fixture.mjs");
  await exerciseNativeRuntime(mode, kernelPath);
  // Pre-content refusal scenarios return after assertions. Never fall through into the
  // separate legacy kernel/session fixture and admit a second synthetic generation.
  process.exit(0);
}
const kernel = require(kernelPath);
if (!/Max core file size\s+0\s+0\s+bytes/u.test(readFileSync("/proc/self/limits", "utf8")))
  throw Error("SyntheticCoreGuardMissing");
const heartbeat = setInterval(() => {}, 5000);
const now = Date.now();
const ids = [1, 2, 3, 4, 5].map((n) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`);
if (mode === "future") kernel.bindCompletion(now + 60_000, 1_000);
if (mode === "expired") kernel.bindCompletion(now - 60_000, 1_000);
if (mode === "oversize") kernel.bindCompletion(now, 1_800_001);
if (mode === "invalid") kernel.bindCompletion("synthetic-secret-not-logged", 1_000);
if (mode === "reload") {
  delete require.cache[kernelPath];
  require(kernelPath);
}
if (mode === "worker") new Worker(`require(${JSON.stringify(kernelPath)})`, { eval: true });
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
const context = coverLetterContext({ facts, job, now: new Date(now) });
const identity = {
  id: ids[2],
  ownerUserId: ids[0],
  applicationId: ids[1],
  ...context,
  noticeVersion: "openai-cover-letter.v1",
  approvedAt: new Date(now),
  expiresAt: new Date(now + 900_000),
};
let claimed = false;
let calls = 0;
const provider = {
  identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
  complete: async () => {
    calls++;
    return {
      text: JSON.stringify({
        paragraphs: [
          {
            text: "I have experience with TypeScript.",
            factIds: [ids[3]],
          },
        ],
      }),
    };
  },
};
const options = {
  documentVersion: 1,
  identity,
  provider,
  kernel,
  enabled: () => mode !== "disabled",
  maximumLifetimeMs: mode === "transport" ? 4500 : 1500,
  bootBudgetMs: mode === "boot" ? 400 : 5000,
  source: {
    load: async () => {
      if (mode === "boot") return await new Promise(() => {});
      return { facts, job };
    },
  },
  work: {
    claimProviderDispatch: async (input) => {
      if (claimed) return { kind: "unavailable" };
      claimed = true;
      return {
        kind: "claimed",
        reference: {
          id: ids[4],
          documentId: ids[2],
          purpose: "provider_dispatch",
          requestSha256: input.requestSha256,
        },
      };
    },
    settleProviderDispatch: async () => {
      if (mode === "settlement") {
        process.stdout.write("settlement-pending\n");
        return await new Promise(() => {});
      }
    },
    settleRejectedProviderDispatch: async () => {},
    settleUndispatchedProviderDispatch: async () => {},
  },
  completion: { claimOriginalCompletion: async () => "claimed" },
  render: async (_doc, _owner, _app, contentSha256, format) => ({
    format,
    contentSha256,
    mediaType:
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: `cover-letter.${format}`,
    sha256: "b".repeat(64),
    sizeBytes: 1,
    contentBase64: "eA==",
  }),
};
let controlInvocations = 0;
if (mode === "controls") {
  const prepared = prepareOriginalCoverLetterRequest(identity, { facts, job, now: new Date(now) });
  if (!prepared) throw Error("SyntheticOriginalBindingMissing");
  const original = {
    id: ids[4],
    documentId: ids[2],
    purpose: "provider_dispatch",
    requestSha256: prepared.requestSha256,
  };
  prepared.request.system = "";
  prepared.request.user = "";
  const workTarget = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-work:9";
  const completionTarget =
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-original-completion:7";
  const workHandler = createCoverLetterProviderControlHandler({
    functionArn: workTarget,
    work: options.work,
    enabled: () => true,
  });
  const completionHandler = createTemporaryMaterialCompletionHandler({
    functionArn: completionTarget,
    store: options.completion,
    enabled: () => true,
  });
  const controls = createNativeMaterialControls({
    allocation: {
      allocationId: "019a4000-0000-7000-8000-000000000001",
      ownerUserId: ids[0],
      applicationId: ids[1],
      generationId: ids[2],
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
    original,
    consentExpiresAt: identity.expiresAt.toISOString(),
    workFunctionArn: workTarget,
    completionFunctionArn: completionTarget,
    enabled: () => true,
    testClient: {
      send: async (command) => {
        controlInvocations++;
        const target = command.input.FunctionName;
        const input = JSON.parse(new TextDecoder().decode(command.input.Payload));
        const result =
          target === workTarget
            ? await workHandler(input, { invokedFunctionArn: target })
            : await completionHandler(input, { invokedFunctionArn: target });
        return {
          StatusCode: 200,
          ExecutedVersion: target === workTarget ? "9" : "7",
          Payload: new TextEncoder().encode(JSON.stringify(result)),
        };
      },
    },
  });
  options.work = controls.work;
  options.completion = controls.completion;
}
const session = createNativeMemorySession(options);
if (mode === "multiple") {
  try {
    createNativeMemorySession({ ...options, identity: { ...identity, ownerUserId: ids[4] } });
    throw Error("SecondSessionAccepted");
  } catch (error) {
    if (error.message !== "NativeMemorySessionUnavailable") throw error;
  }
}
const generated = await session.generate();
if (generated.kind !== "ready") throw Error("SyntheticGenerationMissing");
const preview = await session.reader.coverLetterPreview(ids[0], ids[1], generated.reference);
if (!JSON.stringify(preview.value).includes("TypeScript")) throw Error("SyntheticPreviewMissing");
preview.release();
try {
  await session.reader.current(ids[4], ids[1], generated.reference);
  throw Error("ScopeNotRejected");
} catch (error) {
  if (error.message !== "NativeMemorySessionUnavailable") throw error;
}
if ((await session.generate()).kind !== "in_progress" || calls !== 1)
  throw Error("OriginalRedispatched");
let transportAssertions;
if (mode === "transport") {
  const { exerciseNativeTransport } = await import("./transport-fixture.mjs");
  transportAssertions = await exerciseNativeTransport(session, generated, ids);
}
process.stdout.write(
  `${JSON.stringify({
    ready: true,
    originalCompletion: generated.reference.completedAtMs,
    originalExpiry: generated.reference.expiresAtMs,
    providerCalls: calls,
    ...(mode === "controls" ? { controlInvocations } : {}),
    ...(transportAssertions ? { transportAssertions } : {}),
  })}\n`,
);
if (mode === "renew") kernel.bindCompletion(Date.now(), 1500);
if (mode === "terminate") session.terminate();
if (mode === "cancel") await session.reader.discardApplication(ids[0], ids[1]);
if (mode === "busy") {
  while (true) {}
}
await new Promise(() => {});
clearInterval(heartbeat);
