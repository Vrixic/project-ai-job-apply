import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { coverLetterContext } from "../../../../packages/ai-sdk/src/context.ts";
import { createNativeMemorySession } from "../../../services/documents/src/native-memory-session.ts";
import { prepareNativeApproval } from "./approval-fixture.mjs";

const require = createRequire(import.meta.url);
const kernel = require(process.argv[2]);
assert.match(readFileSync("/proc/self/limits", "utf8"), /Max core file size\s+0\s+0\s+bytes/u);
const ids = [1, 2, 3, 4, 5].map((n) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`);
const exercise = await prepareNativeApproval(ids);
const now = new Date();
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
const identity = {
  id: ids[2],
  ownerUserId: ids[0],
  applicationId: ids[1],
  ...coverLetterContext({ facts, job, now }),
  noticeVersion: "openai-cover-letter.v1",
  approvedAt: now,
  expiresAt: new Date(now.getTime() + 900000),
};
let claimed = false;
const session = createNativeMemorySession({
  identity,
  documentVersion: 1,
  kernel,
  enabled: () => true,
  maximumLifetimeMs: 30000,
  bootBudgetMs: 5000,
  source: { load: async () => ({ facts, job }) },
  provider: {
    identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
    complete: async () => ({
      text: JSON.stringify({
        paragraphs: [{ text: "I have experience with TypeScript.", factIds: [ids[3]] }],
      }),
    }),
  },
  work: {
    claimProviderDispatch: async (input) => {
      assert.equal(claimed, false);
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
    settleProviderDispatch: async () => {},
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
});
const generated = await session.generate();
assert.equal(generated.kind, "ready");
await exercise(session, generated);
process.exit(0);
