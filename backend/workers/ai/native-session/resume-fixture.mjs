import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createNativeMemorySession } from "../../../services/documents/src/native-memory-session.ts";
import {
  createNativeResumeSession,
  nativeResumeJobHash,
} from "../../../services/documents/src/native-resume-session.ts";
import {
  SYNTHETIC_RESUME,
  syntheticDocument,
} from "../../../services/documents/src/resume-ast/test-support.ts";

export async function exerciseNativeResume(mode, kernelPath) {
  const kernel = createRequire(import.meta.url)(kernelPath);
  const heartbeat = setInterval(() => {}, 5000);
  const ids = [1, 2, 3].map((n) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`);
  const document = syntheticDocument(SYNTHETIC_RESUME);
  const job = { title: "Backend engineer", description: "TypeScript PostgreSQL APIs" };
  const identity = {
    generationId: ids[2],
    ownerUserId: ids[0],
    applicationId: ids[1],
    version: 1,
    baseDocumentId: document.documentId,
    baseVersion: document.version,
    baseSha256: document.sourceSha256,
    jobContextSha256: nativeResumeJobHash(job),
  };
  let loads = 0,
    claims = 0,
    admitted = true;
  const session = createNativeResumeSession({
    identity,
    kernel,
    enabled: () => true,
    maximumLifetimeMs: 4000,
    bootBudgetMs: 5000,
    source: {
      load: async (fixed) => {
        assert.equal(fixed.baseDocumentId, document.documentId);
        loads++;
        return { document, job };
      },
    },
    checkAdmission: async () => {
      if (!admitted) throw Error("SyntheticResumeAdmissionWithdrawn");
    },
    completion: {
      claimOriginalCompletion: async (ref) => {
        claims++;
        assert.equal(ref.kind, "tailored_resume");
        if (mode === "resume-completion-pending") return await new Promise(() => {});
        return "claimed";
      },
    },
  });
  assert.throws(
    () => createNativeMemorySession({ documentVersion: 1, enabled: () => true, kernel }),
    /NativeMemorySessionUnavailable/u,
  );
  const pending = session.generate();
  // Mutable caller identity cannot retarget the captured original.
  identity.generationId = ids[0];
  const ready = await pending;
  assert.equal(ready.reference.generationId, ids[2]);
  assert.equal(ready.reference.expiresAtMs - ready.reference.completedAtMs, 1_800_000);
  await assert.rejects(session.generate());
  const preview = await session.read(ready.reference, "preview");
  assert.ok(preview.value.sections.length > 0);
  assert.equal(await preview.revalidate(), true);
  preview.release();
  assert.equal(preview.value.sections.length, 0);
  assert.equal(preview.isCurrent(), false);
  let files = 0;
  for (const format of ["pdf"]) {
    const response = await session.read(ready.reference, format);
    assert.ok(response.value.bytes.byteLength > 100);
    assert.ok(response.value.bytes.some((byte) => byte !== 0));
    response.release();
    assert.ok(response.value.bytes.every((byte) => byte === 0));
    files++;
  }
  await assert.rejects(session.read({ ...ready.reference, ownerUserId: ids[2] }, "preview"));
  await assert.rejects(
    session.read({ ...ready.reference, contentSha256: "f".repeat(64) }, "preview"),
  );
  admitted = false;
  await assert.rejects(session.read(ready.reference, "preview"));
  admitted = true;
  const held = await session.read(ready.reference, "preview");
  const cancel = new AbortController();
  const cancelled = await session.read(ready.reference, "preview", cancel.signal);
  cancel.abort();
  assert.equal(cancelled.isCurrent(), false);
  assert.equal(cancelled.value.sections.length, 0);
  assert.equal(loads, 1);
  assert.equal(claims, 1);
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      resumeAssertions: 20,
      actualFiles: files,
      originalCompletion: ready.reference.completedAtMs,
      originalExpiry: ready.reference.expiresAtMs,
    })}\n`,
  );
  if (mode === "resume-terminate") session.terminate();
  if (mode === "resume-busy") while (true) Math.sqrt(42);
  // Held output and idle server process die at the original absolute kernel bound.
  assert.equal(held.isCurrent(), true);
  void heartbeat;
  await new Promise(() => {});
}
