import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { lockNativeMaterialApplicationAdmission } from "../../../backend/services/applications/dist/src/index.js";
import { PostgresCoverLetterStore } from "../../../backend/services/documents/dist/src/cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "../../../backend/services/documents/dist/src/cover-letter-work-store.js";
import { PostgresNativeApplicationDisposalStore } from "../../../backend/services/documents/dist/src/native-application-disposal-store.js";
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
  for (const state of ["pending", "bound", "retired", "abandoned"]) {
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
    if (state === "abandoned") {
      const disposal = new PostgresNativeApplicationDisposalStore(sql, () => true);
      const sealed = await disposal.sealApplication(ownerUserId, applicationId);
      assert.equal(sealed.epochId, intent.epochId);
      assert.deepEqual(sealed.intents, []);
      fixtures.push({ scope: fixed, original, abandoned: true });
      continue;
    }
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
    if (fixture.abandoned) {
      const [row] = await sql`SELECT state,launch_claimed_at,launch_configuration_sha256,task_arn,
        stopped_at_ms,observed_at_ms FROM documents.native_material_allocations
        WHERE id=${fixture.scope.allocationId} AND user_id=${fixture.scope.ownerUserId}`;
      assert.deepEqual(
        { ...row },
        {
          state: "abandoned",
          launch_claimed_at: null,
          launch_configuration_sha256: null,
          task_arn: null,
          stopped_at_ms: null,
          observed_at_ms: null,
        },
      );
      await assert.rejects(
        owner.claimLaunch(fixture.scope, digest),
        /^Error: NativeMaterialRegistryUnavailable$/u,
      );
      await assert.rejects(
        owner.readLaunch(fixture.scope, digest),
        /^Error: NativeMaterialRegistryUnavailable$/u,
      );
      assert.equal(
        await owner.confirmApplicationDisposed(
          fixture.scope.ownerUserId,
          fixture.scope.applicationId,
          fixture.scope.epochId,
        ),
        true,
      );
      // The restored immutable terminal guard must refuse resurrection, not just the TS caller.
      await assert.rejects(
        sql`UPDATE documents.native_material_allocations SET state='pending'
        WHERE id=${fixture.scope.allocationId}`,
        { code: "55000" },
      );
      const [portable] =
        await sql`SELECT documents.export_candidate_data(${fixture.scope.ownerUserId}::uuid) AS data`;
      const exported = portable.data.documents.nativeMaterialAllocations.find(
        (item) => item.id === fixture.scope.allocationId,
      );
      assert.equal(exported?.state, "abandoned");
      assert.equal(exported?.applicationId, fixture.scope.applicationId);
      assert.equal(exported?.generationId, fixture.scope.generationId);
      assert.equal(Object.hasOwn(exported, "stoppedAtEpochMs"), false);
      const [grant] = await sql`SELECT state FROM documents.cover_letter_work_authorizations
        WHERE id=${fixture.original.id}`;
      assert.equal(grant.state, "issued");
      continue;
    }
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
  const pending = fixtures.find((f) => f.record?.intent.state === "pending");
  assert.ok(pending);
  assert.equal(
    await owner.confirmApplicationDisposed(
      pending.scope.ownerUserId,
      pending.scope.applicationId,
      pending.scope.epochId,
    ),
    false,
  );
  const retired = fixtures.find((f) => f.record?.intent.state === "retired");
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
    nativeAbandonedLaunchesStillTerminal: fixtures.filter((f) => f.abandoned).length,
  };
}
