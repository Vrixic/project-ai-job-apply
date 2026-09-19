import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createApplicationsDatabase,
  defaultFieldDefinitions,
} from "@ai-job-apply/applications-service";
import { createDatabase } from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplicationsRuntime } from "./applications-runtime.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

const jobId = "019d04cf-1f80-7000-8000-0000000000e1";

function runtimeFor(client: ReturnType<typeof createApplicationsDatabase>) {
  return createApplicationsRuntime({
    client,
    definitions: defaultFieldDefinitions(),
    profile: { listProfileFacts: async () => ({ facts: [] }) },
    documents: { listResumeDocuments: async () => ({ documents: [] }) },
    catalog: {
      async resolveActiveJobSummaries() {
        return {
          catalogRevision: "r1",
          items: [
            {
              requestedJobId: jobId,
              job: {
                id: jobId,
                company: { id: "019d04cf-1f80-7000-8000-0000000000e2", name: "Synthetic Co" },
                title: "Backend Engineer",
                locations: ["Remote - US"],
                firstObservedAt: new Date(),
                lastVerifiedAt: new Date(),
                expiresAt: new Date(Date.now() + 86_400_000),
              },
            },
          ],
        } as never;
      },
    },
  });
}

describeWithDatabase("Applications database client boundary", () => {
  const shared = createDatabase(databaseUrl ?? "postgres://invalid", { maxConnections: 2 });
  const dedicated = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 2,
  });

  beforeAll(async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    for (const owner of ["profile", "applications"]) {
      await execFileAsync(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env },
      );
    }
  }, 60_000);

  afterAll(async () => {
    await shared.client.end({ timeout: 5 });
    await dedicated.end({ timeout: 5 });
  });

  it("creates an application over the dedicated client the gateway composes", async () => {
    const owner = uuidv7();
    const created = await runtimeFor(dedicated).create(owner, jobId, `dedicated-${uuidv7()}`);
    expect(created).toMatchObject({ canonicalJobId: jobId, status: "preparing", revision: 1 });
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);
  });

  it("cannot be served by the shared gateway client, which is why it is never composed", async () => {
    // The shared client camel-cases columns and installs Drizzle's JSON and timestamp handling; the
    // store's create fails on it, exactly as the deployed Gateway did before this boundary existed.
    await expect(
      runtimeFor(shared.client).create(uuidv7(), jobId, `shared-${uuidv7()}`),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });
});
