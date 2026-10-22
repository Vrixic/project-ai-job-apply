import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PutJobPreferencesRequest } from "@ai-job-apply/api-contracts";
import type { AuthPrincipal } from "@ai-job-apply/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccountQuarantinedError,
  createDatabase,
  createProfileSectionStore,
  loadCandidateRightsPolicy,
  PostgresProfileStore,
  PostgresResumeProposalWriter,
  ResumeProposalConflictError,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresProfileStore", () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
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
    const migrationExecutable = fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url));
    const migrationEnvironment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
    };
    const first = await execFileAsync(process.execPath, [migrationExecutable], {
      env: migrationEnvironment,
    });
    const replay = await execFileAsync(process.execPath, [migrationExecutable], {
      env: migrationEnvironment,
    });

    expect(first.stdout.trim()).toBe(
      "Database migrations through 0014_retire_profile_facts applied and verified.",
    );
    expect(replay.stdout.trim()).toBe(
      "Database migrations through 0014_retire_profile_facts applied and verified.",
    );
    expect(
      await database.client`
        SELECT version
        FROM platform.schema_migrations
        WHERE version = '0001_foundation'
      `,
    ).toHaveLength(1);
    expect(
      await database.client`
        SELECT version
        FROM platform.schema_migrations
        WHERE version IN (
          '0002_serverless_outbox',
          '0003_retire_legacy_dispatch',
          '0004_profile_fact_versions',
          '0005_resume_fact_proposals',
          '0006_candidate_rights',
          '0007_candidate_rights_export_null_omission',
          '0008_ugc_contribution_consents',
          '0009_ugc_contribution_consent_candidate_rights'
        )
      `,
    ).toHaveLength(8);
  });

  afterAll(async () => {
    await store.close();
  });

  it("omits an absent optional email from the portable candidate export", async () => {
    const runId = crypto.randomUUID();
    const principalWithoutEmail: AuthPrincipal = {
      issuer: principal.issuer,
      subject: `candidate-export-without-email-${runId}`,
      audience: principal.audience,
      scopes: principal.scopes,
    };
    const user = await store.resolveUser(principalWithoutEmail, "integration-trace");
    const [exported] = await database.client<
      Array<{ data: { candidate: Record<string, unknown> } }>
    >`
      SELECT profile.export_candidate_data(${user.id}::uuid) AS data
    `;

    expect(exported?.data.candidate).toMatchObject({ connectedAccounts: expect.any(Array) });
    expect(exported?.data.candidate).not.toHaveProperty("email");
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
      traceparent,
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

    const [event] = await database.client<
      Array<{ data: Record<string, unknown>; traceparent: string | null }>
    >`
      SELECT data, traceparent
      FROM platform.outbox_events
      WHERE type = 'profile.preferences.updated.v1'
        AND data ->> 'operationId' = ${first.operationId}
    `;
    expect(event?.data).toEqual({
      preferenceSetId: first.preferences.id,
      version: 1,
      operationId: first.operationId,
    });
    expect(event?.traceparent).toBe(traceparent);
    expect(JSON.stringify(event)).not.toContain("Software Engineer");
    expect(JSON.stringify(event)).not.toContain("New York");

    await store.markOperationRunning(first.operationId, first.preferences.id);
    await store.markOperationRunning(first.operationId, first.preferences.id);
    const readiness: Parameters<PostgresProfileStore["completeReadinessOperation"]>[2] = {
      completionPercent: 100,
      missingFields: [],
      calculatedAt: "2026-08-02T20:00:00.000Z",
    };
    await store.completeReadinessOperation(first.operationId, first.preferences.id, readiness);
    await store.completeReadinessOperation(first.operationId, first.preferences.id, readiness);
    await store.markOperationRunning(first.operationId, first.preferences.id);
    await store.failReadinessOperation(
      first.operationId,
      first.preferences.id,
      "SyntheticLateFailure",
    );
    const completedOperation = await store.getOperation(user.id, first.operationId);
    expect(completedOperation).toMatchObject({ state: "succeeded" });
    expect(completedOperation).not.toHaveProperty("errorCode");
    const [completionEvents] = await database.client<
      Array<{ count: number; pending: number; allAcknowledged: boolean }>
    >`
      SELECT
        count(*)::integer AS count,
        count(*) FILTER (WHERE published_at IS NULL)::integer AS pending,
        bool_and(published_at IS NOT NULL) AS "allAcknowledged"
      FROM platform.outbox_events
      WHERE type = 'profile.readiness.calculated.v1'
        AND data ->> 'operationId' = ${first.operationId}
    `;
    expect(completionEvents).toEqual({ count: 1, pending: 0, allAcknowledged: true });
  });

  it("persists candidate-rights requests atomically and quarantines confirmed accounts", async () => {
    const runId = crypto.randomUUID();
    const now = new Date("2026-08-25T15:00:00.000Z");
    const rightsStore = new PostgresProfileStore(database, {
      candidateDeletionConfirmationJournal: {
        recordConfirmed: async (entry) => entry,
      },
      candidateRightsPolicy: loadCandidateRightsPolicy({
        CANDIDATE_RIGHTS_POLICY_VERSION: "d1-synthetic-v1",
        CANDIDATE_RIGHTS_POLICY_SHA256: "a".repeat(64),
        CANDIDATE_RIGHTS_EXPORT_LIFETIME_SECONDS: "3600",
        CANDIDATE_RIGHTS_DOWNLOAD_GRANT_SECONDS: "300",
        CANDIDATE_RIGHTS_BACKUP_RETENTION_DAYS: "7",
        CANDIDATE_RIGHTS_RECENT_AUTH_MAX_AGE_SECONDS: "300",
        CANDIDATE_RIGHTS_OWNER_INVENTORY: "identity,profile,documents,jobs,matching,billing,trust",
        CANDIDATE_RIGHTS_SUBPROCESSOR_INVENTORY: "auth0,aws",
      }),
      clock: () => new Date(now.getTime()),
    });
    const rightsPrincipal: AuthPrincipal = {
      ...principal,
      subject: `candidate-rights-${runId}`,
      authenticatedAt: Math.floor(now.getTime() / 1_000),
      authenticationMethods: ["pwd", "mfa"],
    };
    const user = await rightsStore.resolveUser(rightsPrincipal, "rights-trace");
    let exportId: string | undefined;
    let deletionRequestId: string | undefined;
    try {
      const firstExport = await rightsStore.createCandidateDataExport(
        rightsPrincipal,
        user.id,
        `rights-export-${runId}`,
        "rights-export-trace",
        traceparent,
      );
      exportId = firstExport.id;
      expect(
        await rightsStore.createCandidateDataExport(
          rightsPrincipal,
          user.id,
          `rights-export-${runId}`,
          "rights-export-replay",
        ),
      ).toEqual(firstExport);
      expect(await rightsStore.getCandidateDataExport(user.id, firstExport.id)).toMatchObject({
        state: "queued",
        policyVersion: "d1-synthetic-v1",
      });

      const requested = await rightsStore.createAccountDeletionRequest(
        rightsPrincipal,
        user.id,
        `rights-delete-${runId}`,
        "rights-delete-trace",
      );
      deletionRequestId = requested.id;
      expect(requested).toMatchObject({ state: "requested", version: 1 });
      const confirmed = await rightsStore.confirmAccountDeletionRequest(
        rightsPrincipal,
        user.id,
        requested.id,
        requested.version,
        `rights-confirm-${runId}`,
        "rights-confirm-trace",
        traceparent,
      );
      expect(confirmed).toMatchObject({
        id: requested.id,
        state: "quarantined",
        version: 2,
        policyVersion: "d1-synthetic-v1",
      });
      expect(confirmed?.backupExpiresAt).toBe("2026-09-01T15:00:00.000Z");
      await expect(
        rightsStore.resolveUser(rightsPrincipal, "blocked-trace"),
      ).rejects.toBeInstanceOf(AccountQuarantinedError);
      expect(
        await rightsStore.resolveUser(rightsPrincipal, "rights-replay-trace", {
          allowQuarantined: true,
        }),
      ).toMatchObject({ id: user.id });
      expect(
        await rightsStore.confirmAccountDeletionRequest(
          rightsPrincipal,
          user.id,
          requested.id,
          requested.version,
          `rights-confirm-${runId}`,
          "rights-confirm-replay",
        ),
      ).toEqual(confirmed);

      const [ledger] = await database.client<
        Array<{
          state: string;
          subjectDigest: string;
          ownerInventory: Record<string, string>;
          subprocessorInventory: Record<string, string>;
        }>
      >`
        SELECT state, subject_digest AS "subjectDigest", owner_inventory AS "ownerInventory",
          subprocessor_inventory AS "subprocessorInventory"
        FROM privacy.account_deletion_ledger
        WHERE request_id = ${requested.id}
      `;
      expect(ledger).toMatchObject({
        state: "quarantined",
        ownerInventory: {
          identity: "pending",
          profile: "pending",
          documents: "pending",
          jobs: "pending",
          matching: "pending",
          billing: "pending",
          trust: "pending",
        },
        subprocessorInventory: { auth0: "pending", aws: "pending" },
      });
      expect(ledger?.subjectDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(ledger)).not.toContain(rightsPrincipal.subject);
      expect(JSON.stringify(ledger)).not.toContain(rightsPrincipal.email);

      const events = await database.client<Array<{ type: string; data: Record<string, unknown> }>>`
        SELECT type, data
        FROM platform.outbox_events
        WHERE data ->> 'dataExportId' = ${firstExport.id}
           OR data ->> 'deletionRequestId' = ${requested.id}
        ORDER BY type
      `;
      expect(events).toEqual([
        {
          type: "profile.account-deletion.confirmed.v1",
          data: {
            deletionRequestId: requested.id,
            operationId: expect.any(String),
            policyVersion: "d1-synthetic-v1",
          },
        },
        {
          type: "profile.data-export.requested.v1",
          data: {
            dataExportId: firstExport.id,
            operationId: expect.any(String),
            policyVersion: "d1-synthetic-v1",
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain(rightsPrincipal.subject);
      expect(JSON.stringify(events)).not.toContain(rightsPrincipal.email);

      const [exportEvent] = await database.client<Array<{ id: string; operationId: string }>>`
        SELECT id, data ->> 'operationId' AS "operationId"
        FROM platform.outbox_events WHERE data ->> 'dataExportId' = ${firstExport.id}
      `;
      if (!exportEvent) throw new Error("Candidate export outbox event was not created");
      const executionName = `outbox-${exportEvent.id}`;
      await database.client`
        UPDATE platform.outbox_events SET durable_execution_name = ${executionName},
          published_at = now() WHERE id = ${exportEvent.id}::uuid
      `;
      await rightsStore.reconcileDurableOperationFailure(executionName, "WorkflowTimedOut");
      const [recoveredOperation] = await database.client<
        Array<{ state: string; errorCode: string }>
      >`
        SELECT state, error_code AS "errorCode" FROM platform.operations
        WHERE id = ${exportEvent.operationId}::uuid
      `;
      expect(recoveredOperation).toEqual({
        state: "retryable_failure",
        errorCode: "WorkflowTimedOut",
      });
      const [replayCount] = await database.client<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM platform.outbox_events
        WHERE type = 'profile.data-export.requested.v1'
          AND data ->> 'operationId' = ${exportEvent.operationId}
      `;
      expect(replayCount?.count).toBe(2);

      await database.client`
        DELETE FROM identity.external_identities
        WHERE issuer = ${rightsPrincipal.issuer} AND subject = ${rightsPrincipal.subject}
      `;
      await expect(
        rightsStore.resolveUser(rightsPrincipal, "deleted-subject-replay"),
      ).rejects.toBeInstanceOf(AccountQuarantinedError);
      expect(
        await rightsStore.resolveUser(rightsPrincipal, "deleted-subject-rights-read", {
          allowQuarantined: true,
        }),
      ).toMatchObject({ id: user.id });
      const recreated = await database.client<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM identity.external_identities
        WHERE issuer = ${rightsPrincipal.issuer} AND subject = ${rightsPrincipal.subject}
      `;
      expect(recreated[0]?.count).toBe(0);
    } finally {
      if (deletionRequestId) {
        await database.client`
          DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${deletionRequestId}
        `;
        await database.client`
          DELETE FROM platform.outbox_events WHERE data ->> 'deletionRequestId' = ${deletionRequestId}
        `;
      }
      if (exportId) {
        await database.client`
          DELETE FROM platform.outbox_events WHERE data ->> 'dataExportId' = ${exportId}
        `;
      }
      await database.client`DELETE FROM identity.users WHERE id = ${user.id}`;
    }
  });

  it("keeps committed work recoverable when the post-commit SQS nudge fails", async () => {
    const runId = crypto.randomUUID();
    let operationId: string | undefined;
    const failingStore = new PostgresProfileStore(database, {
      dispatchTarget: "lambda_durable",
      nudgePublisher: {
        publish: async () => {
          throw new Error("SyntheticSqsFailure");
        },
      },
      nudgeRetryDelaySeconds: 60,
    });
    const user = await failingStore.resolveUser(
      { ...principal, subject: `serverless-candidate-${runId}` },
      "integration-trace",
    );

    try {
      const saved = await failingStore.putPreferences(
        user.id,
        {
          targetRoles: ["Platform Engineer"],
          locations: ["Columbus, OH"],
          workModes: ["hybrid"],
          employmentTypes: ["full_time"],
        },
        `serverless-integration-key-${runId}`,
        "integration-trace",
        traceparent,
      );
      operationId = saved.operationId;

      expect(await failingStore.getOperation(user.id, saved.operationId)).toMatchObject({
        state: "queued",
      });
      const [row] = await database.client<
        Array<{
          eventId: string;
          dispatchTarget: string;
          nudgeAttempts: number;
          nudgeLastErrorCode: string;
          publishedAt: Date | null;
        }>
      >`
      SELECT
        id AS "eventId",
        dispatch_target AS "dispatchTarget",
        nudge_attempts AS "nudgeAttempts",
        nudge_last_error_code AS "nudgeLastErrorCode",
        published_at AS "publishedAt"
      FROM platform.outbox_events
      WHERE data ->> 'operationId' = ${saved.operationId}
      `;
      if (!row) {
        throw new Error("Synthetic serverless outbox row was not created");
      }
      expect(row).toMatchObject({
        dispatchTarget: "lambda_durable",
        nudgeAttempts: 1,
        nudgeLastErrorCode: "Error",
        publishedAt: null,
      });
      expect(JSON.stringify(row)).not.toContain("Columbus");
      const executionName = `outbox-${row.eventId}`;
      await database.client`
        UPDATE platform.outbox_events
        SET durable_execution_name = ${executionName}
        WHERE id = ${row.eventId}
      `;
      await failingStore.failDurableReadinessOperation(executionName, "WorkflowStopped");
      await failingStore.failDurableReadinessOperation(executionName, "WorkflowStopped");
      expect(await failingStore.getOperation(user.id, saved.operationId)).toMatchObject({
        state: "failed",
        errorCode: "WorkflowStopped",
      });
    } finally {
      if (operationId) {
        await database.client`
          DELETE FROM platform.outbox_events
          WHERE data ->> 'operationId' = ${operationId}
            AND dispatch_target = 'lambda_durable'
        `;
      }
    }
  });

  it("claims serverless outbox pages without overlap and advances past the oldest page", async () => {
    const source = `urn:ai-job-apply:integration:${crypto.randomUUID()}`;
    const eventIds = Array.from({ length: 26 }, () => crypto.randomUUID());
    try {
      for (const [index, eventId] of eventIds.entries()) {
        await database.client`
          INSERT INTO platform.outbox_events (
            id,
            type,
            source,
            subject,
            data_schema,
            data,
            dispatch_target,
            created_at
          ) VALUES (
            ${eventId},
            ${"profile.preferences.updated.v1"},
            ${source},
            ${`preference-set/${crypto.randomUUID()}`},
            ${"https://schemas.ai-job-apply.internal/events/profile.preferences.updated.v1.json"},
            ${JSON.stringify({
              preferenceSetId: crypto.randomUUID(),
              version: 1,
              operationId: crypto.randomUUID(),
            })}::jsonb,
            ${"lambda_durable"},
            ${new Date(index).toISOString()}::timestamptz
          )
        `;
      }

      const first = await store.claimOutboxNudges(25, new Date(0));
      const second = await store.claimOutboxNudges(25, new Date(0));
      const claimedForSource = [...first, ...second].filter((event) => event.source === source);
      expect(first).toHaveLength(25);
      expect(first.every((event) => event.source === source)).toBe(true);
      expect(claimedForSource).toHaveLength(26);
      expect(new Set(claimedForSource.map((event) => event.id)).size).toBe(26);
      expect(JSON.stringify(claimedForSource)).not.toContain("targetRoles");
    } finally {
      await database.client`
        DELETE FROM platform.outbox_events
        WHERE source = ${source}
      `;
    }
  });
  it("imports resume drafts idempotently and retires only a purged resume's unsaved drafts (ADR-034, ADR-052)", async () => {
    const runId = crypto.randomUUID();
    const user = await store.resolveUser(
      { ...principal, subject: `resume-drafts-${runId}` },
      "integration-trace",
    );
    const other = await store.resolveUser(
      { ...principal, subject: `resume-drafts-other-${runId}` },
      "integration-trace",
    );
    const documentA = crypto.randomUUID();
    const documentB = crypto.randomUUID();
    const sections = createProfileSectionStore(database.client);
    const writer = new PostgresResumeProposalWriter();
    const importFor = (owner: string, documentId: string, names: string[]) =>
      database.client.begin((transaction) =>
        writer.importDrafts(transaction, {
          userId: owner,
          documentId,
          documentVersion: 1,
          parserVersion: "resume-parser-v1",
          traceId: "drafts-import",
          drafts: names.map((name) => ({ section: "skill" as const, values: { name } })),
        }),
      );

    expect(await importFor(user.id, documentA, ["Draft one", "Draft two", "Saved later"])).toBe(3);
    // The same import identity is idempotent, and different content under it is refused.
    expect(await importFor(user.id, documentA, ["Draft one", "Draft two", "Saved later"])).toBe(3);
    await expect(importFor(user.id, documentA, ["Different"])).rejects.toThrow(
      ResumeProposalConflictError,
    );
    expect(await importFor(user.id, documentB, ["Other resume"])).toBe(1);
    expect(await importFor(other.id, documentA, ["Someone else's"])).toBe(1);
    expect(await sections.listDrafts(user.id)).toHaveLength(4);
    expect(await sections.listEntries(user.id, "skill")).toEqual([]);

    // The candidate saves one suggestion; it becomes their own record.
    const drafts = await sections.listDrafts(user.id);
    const saved = drafts.find((draft) => (draft.values as { name: string }).name === "Saved later");
    if (!saved) throw new Error("expected a draft");
    await sections.saveDraft(user.id, saved.id, {}, `save-${crypto.randomUUID()}`, "drafts-save");
    // A candidate who saved or discarded a suggestion is never given it again.
    expect(await importFor(user.id, documentA, ["Draft one", "Draft two", "Saved later"])).toBe(3);
    expect(await sections.listDrafts(user.id)).toHaveLength(3);

    // Purging resume A removes its unsaved drafts only; the saved skill, resume B and other candidates stay.
    await database.client.begin((transaction) =>
      writer.retireDocumentProposals(transaction, {
        userId: user.id,
        documentId: documentA,
        traceId: "drafts-retire",
      }),
    );
    const left = await sections.listDrafts(user.id);
    expect(left.map((draft) => (draft.values as { name: string }).name)).toEqual(["Other resume"]);
    expect(await sections.listEntries(user.id, "skill")).toMatchObject([
      { name: "Saved later", origin: "imported" },
    ]);
    expect(await sections.listDrafts(other.id)).toHaveLength(1);
    const again = await database.client.begin((transaction) =>
      writer.retireDocumentProposals(transaction, {
        userId: user.id,
        documentId: documentA,
        traceId: "drafts-retire-again",
      }),
    );
    expect(again).toEqual({ proposalsErased: 0, importsErased: 0 });
  });

  it("retires a deleted resume's drafts through the store, for the caller only (ADR-034)", async () => {
    const runId = crypto.randomUUID();
    const user = await store.resolveUser(
      { ...principal, subject: `resume-store-retire-${runId}` },
      "integration-trace",
    );
    const other = await store.resolveUser(
      { ...principal, subject: `resume-store-retire-other-${runId}` },
      "integration-trace",
    );
    const documentId = crypto.randomUUID();
    const sections = createProfileSectionStore(database.client);
    const writer = new PostgresResumeProposalWriter();
    const importFor = (owner: string, name: string) =>
      database.client.begin((transaction) =>
        writer.importDrafts(transaction, {
          userId: owner,
          documentId,
          documentVersion: 1,
          parserVersion: "resume-parser-v1",
          traceId: "store-retire-import",
          drafts: [{ section: "skill" as const, values: { name } }],
        }),
      );
    await importFor(user.id, "Unsaved");
    await importFor(other.id, "Someone else's");
    expect(await sections.listDrafts(user.id)).toHaveLength(1);

    // The caller's identity scopes the erase: another candidate naming this document changes nothing.
    expect(
      await store.retireResumeProposals(other.id, crypto.randomUUID(), "store-retire-x"),
    ).toEqual({ proposalsErased: 0 });
    expect(await sections.listDrafts(user.id)).toHaveLength(1);
    expect(await store.retireResumeProposals(user.id, documentId, "store-retire-a")).toEqual({
      proposalsErased: 1,
    });
    expect(await sections.listDrafts(user.id)).toEqual([]);
    expect(await sections.listDrafts(other.id)).toHaveLength(1);
    expect(await store.retireResumeProposals(user.id, documentId, "store-retire-b")).toEqual({
      proposalsErased: 0,
    });
  });
});
