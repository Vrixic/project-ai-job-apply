import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  completeD2RecoveryScope,
  preserveD2RecoveryScope,
  readD2RecoveryScope,
} from "../lib/d2-workload-recovery.mjs";

function scope() {
  return {
    schemaVersion: 2,
    kind: "d2_disposable_candidate_processing_v1",
    capabilityMode: "development",
    runId: "01994a12-0000-7000-8000-000000000001",
    apiOrigin: "https://synthetic.execute-api.us-east-2.amazonaws.com",
    issuedAt: "2026-09-15T16:00:00.000Z",
    expiresAt: "2026-09-15T16:30:00.000Z",
    disposableCandidate: true,
    identitySha256: "a".repeat(64),
    issuer: "https://synthetic.example.test/",
    audience: "ai-job-apply-api",
    clientId: "syntheticClient123",
    sourceAuthorized: true,
    actions: ["synthetic"],
    ugcPolicyVersion: "synthetic-v1",
    preview: {
      client: { surface: "browser_extension", version: "0.2.0" },
      source: {
        provider: "ashby",
        pageVariant: "ashby-job-board-v1",
        sourceUrl: "https://jobs.ashbyhq.com/Mintlify/4da2f7a2-3d5a-4652-bf01-aed59f4cb72b",
        externalJobId: "4da2f7a2-3d5a-4652-bf01-aed59f4cb72b",
        adapterVersion: "d2-job-page-v1",
      },
      posting: { title: "Backend Engineer" },
      observedAt: "2026-09-15T16:00:00.000Z",
    },
    previewSha256: "b".repeat(64),
    readRequests: 1,
  };
}
test("Windows DPAPI recovery roundtrip, retained completion, no overwrite and exact-handle guard", {
  skip: process.platform !== "win32",
}, async (t) => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const root = join(tmpdir(), `d2-recovery-test-${randomUUID().replaceAll("-", "")}`);
  // The helper creates the final private directory with a protected ACL.
  const options = { testRoot: root };
  t.after(async () => {
    assert.equal(root.startsWith(join(tmpdir(), "d2-recovery-test-")), true);
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  });
  const original = scope();
  const handle = await preserveD2RecoveryScope(original, options);
  const ciphertext = await readFile(join(root, handle.fileName));
  assert.equal(ciphertext.includes(Buffer.from("Backend Engineer")), false);
  assert.deepEqual(await readD2RecoveryScope(handle, options), original);
  assert.deepEqual(await completeD2RecoveryScope(handle, options), { completed: true });
  assert.deepEqual(await readD2RecoveryScope(handle, options), original);
  await assert.rejects(completeD2RecoveryScope(handle, options), /d2_recovery_unavailable/u);
  await assert.rejects(
    readD2RecoveryScope({ ...handle, sha256: "0".repeat(64) }, options),
    /d2_recovery_unavailable/u,
  );
  await assert.rejects(
    readD2RecoveryScope({ ...handle, fileName: "../unsafe" }, options),
    /d2_recovery_unavailable/u,
  );
  await assert.rejects(
    preserveD2RecoveryScope({ ...original, accessToken: "SYNTHETIC" }, options),
    /d2_recovery_unavailable/u,
  );
});
test("recovery refuses caller directory override outside test and inherited-ACL directories", {
  skip: process.platform !== "win32",
}, async () => {
  const old = process.env.NODE_ENV;
  const root = join(tmpdir(), `d2-recovery-test-${randomUUID().replaceAll("-", "")}`);
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      preserveD2RecoveryScope(scope(), { testRoot: root }),
      /d2_recovery_unavailable/u,
    );
    process.env.NODE_ENV = "test";
    await mkdir(root);
    await assert.rejects(
      preserveD2RecoveryScope(scope(), { testRoot: root }),
      /d2_recovery_unavailable/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});
