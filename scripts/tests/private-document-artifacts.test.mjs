import assert from "node:assert/strict";
import { test } from "node:test";
import {
  privateDocumentArtifacts,
  verifyPrivateDocumentBundle,
} from "../lib/private-document-artifacts.mjs";

test("private artifact inventory is closed and separate from document processing", () => {
  assert.deepEqual(
    privateDocumentArtifacts.map((artifact) => artifact.name),
    [
      "cover-letter-provider-control-lambda",
      "cover-letter-response-capture-lambda",
      "cover-letter-cleanup-lambda",
    ],
  );
  assert.ok(Object.isFrozen(privateDocumentArtifacts));
  for (const artifact of privateDocumentArtifacts) assert.ok(Object.isFrozen(artifact));
});

for (const artifact of privateDocumentArtifacts) {
  test(`${artifact.name}: smoke refuses disabled work and rejects content`, async () => {
    const priorFlag = process.env[artifact.flag];
    const priorFetch = globalThis.fetch;
    let calls = 0;
    await verifyPrivateDocumentBundle(
      {
        handler: async (input) => {
          calls++;
          assert.equal(process.env[artifact.flag], "false");
          if (Object.hasOwn(input, "content")) throw new Error(artifact.error);
          return structuredClone(artifact.unavailable);
        },
      },
      artifact,
    );
    assert.equal(calls, 2);
    assert.equal(process.env[artifact.flag], priorFlag);
    assert.equal(globalThis.fetch, priorFetch);
  });

  test(`${artifact.name}: unexpected transport fails even when handler swallows it`, async () => {
    const priorFlag = process.env[artifact.flag];
    const priorFetch = globalThis.fetch;
    await assert.rejects(
      () =>
        verifyPrivateDocumentBundle(
          {
            handler: async (input) => {
              if (Object.hasOwn(input, "content")) throw new Error(artifact.error);
              try {
                await globalThis.fetch("https://synthetic.invalid");
              } catch {
                /* synthetic */
              }
              return structuredClone(artifact.unavailable);
            },
          },
          artifact,
        ),
      /attempted secret transport/,
    );
    assert.equal(process.env[artifact.flag], priorFlag);
    assert.equal(globalThis.fetch, priorFetch);
  });

  test(`${artifact.name}: wrong receipt fails and restores ambient configuration`, async () => {
    const priorFlag = process.env[artifact.flag];
    const priorFetch = globalThis.fetch;
    await assert.rejects(() =>
      verifyPrivateDocumentBundle({ handler: async () => ({}) }, artifact),
    );
    assert.equal(process.env[artifact.flag], priorFlag);
    assert.equal(globalThis.fetch, priorFetch);
  });
}

test("caller-created artifact descriptors cannot select a handler or flag", async () => {
  await assert.rejects(
    () => verifyPrivateDocumentBundle({}, { ...privateDocumentArtifacts[0] }),
    /Unknown private artifact/,
  );
});
