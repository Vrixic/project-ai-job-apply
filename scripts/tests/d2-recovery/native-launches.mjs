import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { lockNativeMaterialApplicationAdmission } from "../../../backend/services/applications/dist/src/index.js";
import { PostgresCoverLetterStore } from "../../../backend/services/documents/dist/src/cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "../../../backend/services/documents/dist/src/cover-letter-work-store.js";
import { PostgresNativeMaterialRegistry } from "../../../backend/services/documents/dist/src/native-material-registry.js";

const dependency = createRequire(
  new URL("../../../backend/services/documents/package.json", import.meta.url),
);
const { v7: uuidv7 } = await import(pathToFileURL(dependency.resolve("uuid")).href);
const digest = "d".repeat(64);
const deployment = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
  containerName: "materials",
};
const registry = (sql) =>
  new PostgresNativeMaterialRegistry(sql, () => true, lockNativeMaterialApplicationAdmission);
const scope = (intent) =>
  Object.fromEntries(
    ["allocationId", "ownerUserId", "applicationId", "generationId", "epochId"].map((key) => [
      key,
      intent[key],
    ]),
  );

/** Synthetic scalar task evidence only. No ECS call, real task, provider, content or IAM proof. */
export async function seedNativeLaunches(sql, ownerUserId) {
  const documents = new PostgresCoverLetterStore(sql, {
    putIfAbsent: async () => {
      throw Error("UnexpectedFixtureObjectWrite");
    },
    read: async () => {
      throw Error("UnexpectedFixtureObjectRead");
    },
  });
  const work = new PostgresCoverLetterWorkStore(sql, () => true);
  const owner = registry(sql);
  const fixtures = [];
  for (const state of ["pending", "bound", "retired"]) {
    const applicationId = uuidv7(),
      generationId = uuidv7();
    await sql`INSERT INTO applications.applications (id,owner_user_id,canonical_job_id,status,created_at,updated_at)
      VALUES (${applicationId},${ownerUserId},${uuidv7()},'preparing',clock_timestamp(),clock_timestamp())`;
    await documents.reserve({
      id: generationId,
      ownerUserId,
      applicationId,
      jobRevision: "a".repeat(64),
      confirmedFactsHash: "b".repeat(64),
    });
    const grant = (
      await work.issue({
        ownerUserId,
        documentId: generationId,
        purpose: "provider_dispatch",
        requestSha256: "c".repeat(64),
        consentExpiresAt: new Date(Date.now() + 900_000),
      })
    ).authorization;
    const original = {
      id: grant.id,
      documentId: generationId,
      purpose: "provider_dispatch",
      requestSha256: grant.requestSha256,
    };
    const intent = await owner.admit({
      ownerUserId,
      applicationId,
      original,
      previousEpochId: null,
      deployment,
    });
    const fixed = scope(intent);
    const claimed = await owner.claimLaunch(fixed, digest);
    assert.equal(claimed.claimed, true);
    if (state !== "pending") {
      const allocation = {
        ...deployment,
        allocationId: intent.allocationId,
        ownerUserId,
        applicationId,
        generationId,
        taskArn: `arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/${uuidv7().replaceAll("-", "")}`,
      };
      await owner.bindTask(allocation);
      if (state === "retired") {
        await owner.sealApplication(ownerUserId, applicationId);
        const [clock] =
          await sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at`;
        const at = Number(clock.at);
        await owner.recordRetirement({
          schemaVersion: 1,
          kind: "native_task_stopped",
          allocationId: allocation.allocationId,
          ownerUserId,
          applicationId,
          generationId,
          clusterArn: allocation.clusterArn,
          taskArn: allocation.taskArn,
          taskDefinitionArn: allocation.taskDefinitionArn,
          stoppedAtEpochMs: at,
          observedAtEpochMs: at,
        });
      }
    }
    if (state === "pending") await owner.sealApplication(ownerUserId, applicationId);
    fixtures.push({ scope: fixed, record: await owner.readLaunch(fixed, digest), original });
  }
  return fixtures;
}

export async function exerciseRestoredNativeLaunches(sql, fixtures) {
  const owner = registry(sql);
  for (const fixture of fixtures) {
    assert.deepEqual(await owner.readLaunch(fixture.scope, digest), fixture.record);
    await assert.rejects(
      owner.readLaunch(fixture.scope, "e".repeat(64)),
      /^Error: NativeMaterialRegistryUnavailable$/u,
    );
    if (fixture.record.intent.state === "retired")
      await assert.rejects(
        owner.claimLaunch(fixture.scope, digest),
        /^Error: NativeMaterialRegistryUnavailable$/u,
      );
    else {
      const replay = await owner.claimLaunch(fixture.scope, digest);
      assert.equal(replay.claimed, false);
      assert.deepEqual(replay.record, fixture.record);
    }
    const [grant] =
      await sql`SELECT state FROM documents.cover_letter_work_authorizations WHERE id=${fixture.original.id}`;
    assert.equal(grant.state, "issued");
  }
  const pending = fixtures.find((f) => f.record.intent.state === "pending");
  assert.ok(pending);
  assert.equal(
    await owner.confirmApplicationDisposed(
      pending.scope.ownerUserId,
      pending.scope.applicationId,
      pending.scope.epochId,
    ),
    false,
  );
  const retired = fixtures.find((f) => f.record.intent.state === "retired");
  assert.ok(retired);
  assert.equal(
    await owner.confirmApplicationDisposed(
      retired.scope.ownerUserId,
      retired.scope.applicationId,
      retired.scope.epochId,
    ),
    true,
  );
  return {
    nativeLaunchRecordsMatched: fixtures.length,
    nativeRestoredLaunchReissues: 0,
    nativeUnknownLaunchStillUnresolved: true,
    nativeProviderGrantsUnsettled: true,
  };
}
