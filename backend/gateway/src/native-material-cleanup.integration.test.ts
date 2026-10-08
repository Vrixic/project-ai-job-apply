import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { expect, it } from "vitest";
import {
  createSyntheticAssuranceApplication,
  SYNTHETIC_OWNER_A,
} from "./d1-api-assurance-test-support.js";
import { nativeMaterialDisposalFromEnvironment } from "./native-material-disposal-runtime.js";

const url = process.env.NATIVE_CLEANUP_TEST_DATABASE_URL;
it.runIf(url)(
  "commits authenticated withdrawal and resumes queued cleanup after owner quarantine",
  async () => {
    const parsed = new URL(url ?? "postgres://invalid");
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/native_cleanup_queue")
      throw Error("SyntheticCleanupDatabaseRejected");
    for (const owner of ["profile", "applications", "jobs", "documents"])
      await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: { ...process.env, DATABASE_URL: url } },
      );
    const sql = postgres(url as string, { max: 1, onnotice: () => undefined });
    const env = {
      NATIVE_APPLICATION_DISPOSAL_ENABLED: "true",
      NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED: "true",
      NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS: JSON.stringify([
        {
          clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic",
          taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic:7",
          containerName: "materials",
        },
      ]),
    };
    const runtime = nativeMaterialDisposalFromEnvironment(url as string, env);
    if (!runtime) throw Error("SyntheticRuntimeMissing");
    const f = await createSyntheticAssuranceApplication({
      nativeMaterialWithdrawals: runtime.ownerRequests,
    });
    try {
      await sql`INSERT INTO identity.users(id) VALUES (${SYNTHETIC_OWNER_A})`;
      const token = await f.issuer.issue("synthetic-candidate-a", {
        scope: "applications:write applications:read",
      });
      const requestId = uuidv7(),
        path = `/v1/material-withdrawals/${requestId}`,
        headers = { authorization: `Bearer ${token}` };
      const accepted = await f.app.inject({ method: "PUT", url: path, headers });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({ requestId, state: "pending" });
      expect((await f.app.inject({ method: "PUT", url: path, headers })).json()).toEqual(
        accepted.json(),
      );
      await sql`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${SYNTHETIC_OWNER_A}`;
      expect(await runtime.runOwnerCleanup()).toEqual({ state: "native_tasks_settled" });
      expect(await runtime.runOwnerCleanup()).toEqual({ state: "idle" });
      const status = await f.app.inject({ method: "GET", url: path, headers });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ requestId, state: "native_tasks_settled" });
    } finally {
      await f.app.close();
      await runtime.close();
      await sql.end();
    }
  },
  60000,
);
