import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PostgresNativeMaterialCleanupQueue } from "../../../backend/services/applications/dist/src/native-material-cleanup-queue.js";
import { PostgresNativeMaterialWithdrawalStore } from "../../../backend/services/applications/dist/src/native-material-withdrawal.js";

const dependency = createRequire(
  new URL("../../../backend/services/applications/package.json", import.meta.url),
);
const { v7: uuidv7 } = await import(pathToFileURL(dependency.resolve("uuid")).href);

export async function seedNativeCleanup(sql) {
  const owner = uuidv7();
  await sql`INSERT INTO identity.users(id,account_state) VALUES (${owner},'active')`;
  const withdrawals = new PostgresNativeMaterialWithdrawalStore(sql, () => true);
  const queue = new PostgresNativeMaterialCleanupQueue(sql, () => true);
  const settled = await withdrawals.withdraw(owner, uuidv7());
  const completedClaim = await queue.claim();
  assert.equal(completedClaim.requestId, settled.requestId);
  assert.equal(
    await queue.finish(completedClaim, { state: "native_tasks_settled", nextApplicationId: null }),
    true,
  );
  const processing = await withdrawals.withdraw(owner, uuidv7());
  const staleClaim = await queue.claim();
  assert.equal(staleClaim.requestId, processing.requestId);
  const cursor = uuidv7();
  await sql`UPDATE applications.native_material_cleanup_queue SET after_application_id=${cursor},
    lease_expires_at=clock_timestamp()-interval '1 second' WHERE request_id=${processing.requestId}`;
  const pending = await withdrawals.withdraw(owner, uuidv7());
  return { owner, settled, processing, pending, staleClaim, completedClaim, cursor };
}

export async function exerciseRestoredNativeCleanup(sql, fixture) {
  const queue = new PostgresNativeMaterialCleanupQueue(sql, () => true);
  const withdrawals = new PostgresNativeMaterialWithdrawalStore(sql, () => true);
  for (const receipt of [fixture.settled, fixture.processing, fixture.pending]) {
    assert.deepEqual(await withdrawals.withdraw(fixture.owner, receipt.requestId), receipt);
    const restored = await queue.read(fixture.owner, receipt.requestId);
    assert.equal(restored.cutoffEpochMicros, receipt.cutoffEpochMicros);
    assert.equal(restored.state, receipt === fixture.settled ? "native_tasks_settled" : "pending");
    assert.equal(await queue.read(uuidv7(), receipt.requestId), null);
  }
  const recovered = await queue.claim();
  assert.equal(recovered.requestId, fixture.processing.requestId);
  assert.equal(recovered.afterApplicationId, fixture.cursor);
  assert.notEqual(recovered.claimToken, fixture.staleClaim.claimToken);
  const complete = { state: "native_tasks_settled", nextApplicationId: null };
  assert.equal(await queue.finish(fixture.staleClaim, complete), false);
  assert.equal(await queue.finish(recovered, complete), true);
  const pending = await queue.claim();
  assert.equal(pending.requestId, fixture.pending.requestId);
  assert.equal(await queue.finish(pending, complete), true);
  assert.equal(await queue.finish(fixture.completedClaim, complete), false);
  assert.equal(await queue.claim(), null);
  await assert.rejects(
    sql`UPDATE applications.native_material_cleanup_queue SET available_at=clock_timestamp()
    WHERE request_id=${fixture.settled.requestId}`,
    { code: "55000" },
  );
  return {
    nativeCleanupReceiptsRestored: 3,
    nativeCleanupExpiredLeaseRecovered: true,
    nativeCleanupStaleClaimRefused: true,
  };
}
