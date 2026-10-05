// Synthetic Linux child only. Native integration bundles this with the actual session/SDK.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { coverLetterContext } from "../../../../packages/ai-sdk/src/index.ts";
import { createNativeMemorySession } from "../../../services/documents/src/native-memory-session.ts";

const require = createRequire(import.meta.url);
const mode = process.argv[2];
const kernelPath = process.argv[3];
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
