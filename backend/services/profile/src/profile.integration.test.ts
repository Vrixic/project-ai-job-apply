import { readFile } from "node:fs/promises";
import type { PutJobPreferencesRequest } from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, PostgresProfileStore } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgresProfileStore", () => {
  const database = createDatabase(databaseUrl ?? "postgres://invalid");
  const store = new PostgresProfileStore(database);
  const principal: AuthPrincipal = {
    issuer: "https://integration-issuer.invalid/",
    subject: "candidate-1",
    audience: ["ai-job-apply-api"],
    scopes: ["profile:read", "profile:write"],
    email: "candidate@example.test",
  };

  beforeAll(async () => {
    const migration = await readFile(
      new URL("../migrations/0001_foundation.sql", import.meta.url),
      "utf8",
    );
    await database.client.unsafe(migration);
  });

  afterAll(async () => {
    await store.close();
  });

  it("commits preferences, operation, audit, and identifier-only outbox data idempotently", async () => {
    const runId = crypto.randomUUID();
    const user = await store.resolveUser(
      { ...principal, subject: `candidate-${runId}` },
      "integration-trace",
    );
    const input: PutJobPreferencesRequest = {
      targetRoles: ["Software Engineer"],
      locations: ["New York, NY"],
      workModes: ["remote"],
      employmentTypes: ["full_time"],
    };
    const first = await store.putPreferences(
      user.id,
      input,
      `integration-key-${runId}`,
      "integration-trace",
    );
    const replay = await store.putPreferences(
      user.id,
      input,
      `integration-key-${runId}`,
      "integration-trace",
    );

    expect(replay).toEqual(first);
    expect(await store.getPreferences(user.id)).toEqual(first.preferences);
    const otherUser = await store.resolveUser(
      { ...principal, subject: `candidate-without-preferences-${runId}` },
      "integration-trace",
    );
    expect(await store.getPreferences(otherUser.id)).toBe(null);
    expect(await store.getOperation(user.id, first.operationId)).toMatchObject({
      kind: "profile_readiness",
    });
    expect(
      await store.getOperation("019b4e12-7ea3-7c36-9357-aea35ab542cc", first.operationId),
    ).toBe(null);

    const events = await store.getPendingOutboxEvents(10);
    const event = events.find(
      (candidate) => (candidate.data as { operationId?: string }).operationId === first.operationId,
    );
    expect(event?.data).toEqual({
      preferenceSetId: first.preferences.id,
      version: 1,
      operationId: first.operationId,
    });
    expect(JSON.stringify(event)).not.toContain("Software Engineer");
    expect(JSON.stringify(event)).not.toContain("New York");
  });
});
