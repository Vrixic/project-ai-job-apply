import "reflect-metadata";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { coverLetterContext } from "@ai-job-apply/ai-sdk/context";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import {
  ApplicationsUnavailableError,
  ApprovalRefusedError,
  createApplicationsDatabase,
  createPreparationActivity,
  defaultFieldDefinitions,
  PostgresApplicationStore,
  StalePacketError,
  type VaultAdmissionQuery,
  VaultBindingsUnavailableError,
} from "@ai-job-apply/applications-service";
import { createTestTokenIssuer } from "@ai-job-apply/auth/testing";
import {
  createDatabase,
  createProfileSectionStore,
  PostgresProfileStore,
  PostgresRestrictedAnswerVaultStore,
  type RestrictedAnswerCipher,
} from "@ai-job-apply/profile-service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGatewayApplication } from "./application.js";
import {
  type ApplicationsRuntimeOptions,
  createApplicationsRuntime,
} from "./applications-runtime.js";

const { createSyntheticPacketProtection } = await import(
  new URL("../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const packetProtection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationsRuntimeOptions["restrictedPackets"]>;
  destroy(): void;
};

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const fieldKey = "authorization.us_authorized";
const form = { adapterId: "greenhouse", variantId: "synthetic-vault", formHash: "a".repeat(64) };
const context = { jobContextHash: "b".repeat(64), confirmedFactsHash: "c".repeat(64) };
const jobId = "019d04cf-1f80-7000-8000-000000000076";
const key = () => `vault-packet-${uuidv7()}`;

suite("Applications selected vault owner composition", () => {
  const profileDb = createDatabase(databaseUrl ?? "postgres://invalid", { maxConnections: 3 });
  const appDb = createApplicationsDatabase(databaseUrl ?? "postgres://invalid", {
    maxConnections: 4,
  });
  const values = new Map<
    string,
    { owner: string; field: string; context: string; value: string }
  >();
  let decryptCalls = 0;
  const cipher: RestrictedAnswerCipher = {
    async encrypt(input) {
      const handle = uuidv7();
      values.set(handle, {
        owner: input.userId,
        field: input.fieldKey,
        context: input.context,
        value: input.plaintext,
      });
      return {
        ciphertext: new TextEncoder().encode(handle),
        kmsKeyId: "synthetic-selection-key",
        encryptionAlgorithm: "SYMMETRIC_DEFAULT",
      };
    },
    async decrypt(input) {
      decryptCalls++;
      const entry = values.get(new TextDecoder().decode(input.ciphertext.ciphertext));
      if (
        !entry ||
        entry.owner !== input.userId ||
        entry.field !== input.fieldKey ||
        entry.context !== input.context
      )
        throw new Error("SyntheticCipherBindingMismatch");
      return entry.value;
    },
  };
  const vault = new PostgresRestrictedAnswerVaultStore(profileDb.client, cipher);
  const catalog = {
    async getActiveJob() {
      return null;
    },
    async resolveActiveJobSummaries() {
      return {
        catalogRevision: "synthetic",
        items: [
          {
            requestedJobId: jobId,
            job: {
              id: jobId,
              company: { id: "019d04cf-1f80-7000-8000-000000000077", name: "Synthetic employer" },
              title: "Synthetic backend role",
              locations: ["Remote"],
              firstObservedAt: new Date(),
              lastVerifiedAt: new Date(),
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          },
        ],
      } as never;
    },
  };
  const realProfile = new PostgresProfileStore(profileDb);
  const realSections = createProfileSectionStore(profileDb.client);
  const state = { at: new Date() };
  function runtime(enabled = true, afterMetadata?: () => void, admissionEnabled = true) {
    return createApplicationsRuntime({
      client: appDb,
      profile: realSections,
      catalog,
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
      restrictedAnswerReuseEnabled: enabled,
      restrictedAnswers: {
        ...(admissionEnabled
          ? { lockCurrentReferences: vault.lockCurrentReferences.bind(vault) }
          : {}),
        readSelectedValue: vault.readSelectedValue.bind(vault),
        readCurrentReference: async (owner, reference) => {
          const current = await vault.readCurrentReference(owner, reference);
          afterMetadata?.();
          return current;
        },
      },
      clock: () => state.at,
      coverLetterPreparationEnabled: true,
      coverLetters: {
        context: async () => context,
        preview: async () => {
          throw new Error("unused");
        },
        file: async () => {
          throw new Error("unused");
        },
        binding: async () => undefined,
      },
    });
  }
  beforeAll(async () => {
    for (const owner of ["profile", "applications"]) {
      await execFileAsync(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        { env: { ...process.env, DATABASE_URL: databaseUrl } },
      );
    }
  });
  afterAll(async () => {
    packetProtection.destroy();
    await appDb.end({ timeout: 5 });
    await profileDb.client.end({ timeout: 5 });
  });

  async function fixture(expiry?: Date) {
    state.at = new Date();
    const owner = uuidv7();
    await profileDb.client`INSERT INTO identity.users (id) VALUES (${owner}::uuid)`;
    const command = {
      userId: owner,
      fieldKey,
      context: "us",
      expectedVersion: 0,
      valueType: "boolean" as const,
      value: "false",
      sensitivity: "restricted" as const,
      confirmedAt: new Date(),
      sourceReference: "synthetic.vault-review",
      idempotencyKey: key(),
      traceId: "synthetic.vault-review",
      ...(expiry ? { expiresAt: expiry } : {}),
    };
    const saved = await vault.save(command);
    const api = runtime();
    const app = await api.create(owner, jobId, key());
    const selection = {
      ...saved,
      fieldKey,
      context: "us",
      questionHash: "d".repeat(64),
      meaningConfirmed: true as const,
    };
    const request = { expectedRevision: app.revision, form, vaultSelections: [selection] };
    const prepared = await api.preparePacket(owner, app.id, request, key());
    return { owner, command, api, app: prepared, selection, request };
  }
  it("queues native HTTP preparation with owner evidence and replays after intake withdrawal", async () => {
    let enabled = true;
    const job = {
      id: jobId,
      status: "active",
      title: "Synthetic backend role",
      company: { name: "Synthetic employer" },
      description: "Synthetic full posting",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const native = createApplicationsRuntime({
      client: appDb,
      profile: realSections,
      catalog: { ...catalog, getActiveJob: async () => job as never },
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
      nativeCoverLetterPreparationEnabled: () => enabled,
    });
    const issuer = await createTestTokenIssuer();
    const app = await createGatewayApplication({
      store: realProfile,
      catalog: catalog as never,
      jobReports: {} as never,
      jobContributions: {} as never,
      moderation: {} as never,
      savedJobs: {} as never,
      matchAssessments: {} as never,
      entitlements: {} as never,
      documents: {} as never,
      applications: native,
      verifier: issuer.verifier,
      releaseSha: "test",
    });
    try {
      const token = await issuer.issue(`synthetic-native-${uuidv7()}`, {
        scope: "applications:read applications:write",
      });
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": key() };
      const created = await app.inject({
        method: "POST",
        url: "/v1/applications",
        headers,
        payload: { jobId },
      });
      expect(created.statusCode).toBe(201);
      const application = created.json<{ id: string; revision: number }>();
      const request = {
        method: "POST" as const,
        url: `/v1/applications/${application.id}/packets`,
        headers: { ...headers, "idempotency-key": key() },
        payload: {
          expectedRevision: application.revision,
          coverLetter: {
            disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
          },
        },
      };
      const prepared = await app.inject(request);
      expect(prepared.statusCode).toBe(202);
      expect(prepared.headers["cache-control"]).toBe("no-store");
      const operation = prepared.json<{ id: string }>();
      const [row] =
        await appDb`SELECT job_context_hash, confirmed_facts_hash FROM applications.packet_preparations WHERE id = ${operation.id}::uuid`;
      const expected = coverLetterContext({
        facts: [],
        now: new Date(),
        job: { title: job.title, company: job.company.name, description: job.description },
      });
      expect(row).toMatchObject({
        job_context_hash: expected.jobContextHash,
        confirmed_facts_hash: expected.confirmedFactsHash,
      });
      enabled = false;
      const replay = await app.inject(request);
      expect(replay.statusCode).toBe(202);
      expect(replay.json()).toEqual(prepared.json());
      const [count] =
        await appDb`SELECT count(*)::int AS total FROM applications.preparation_outbox WHERE preparation_id = ${operation.id}::uuid`;
      expect(count?.total).toBe(1);
    } finally {
      await app.close();
    }
  });

  it.each(["disabled", "withdrawn", "expired", "foreign"] as const)(
    "refuses native context (%s) without enqueueing",
    async (failure) => {
      const f = await fixture();
      let enabled = failure !== "disabled";
      const native = createApplicationsRuntime({
        client: appDb,
        profile: {
          listGroundingFacts: async (owner) => {
            const facts = await realSections.listGroundingFacts(owner);
            if (failure === "withdrawn") enabled = false;
            return facts;
          },
        },
        catalog: {
          ...catalog,
          getActiveJob: async () =>
            ({
              status: "active",
              title: "Synthetic",
              company: { name: "Synthetic" },
              description: "Synthetic",
              expiresAt: new Date(Date.now() + (failure === "expired" ? -1 : 60_000)),
            }) as never,
        },
        definitions: defaultFieldDefinitions(),
        restrictedPackets: packetProtection.options,
        nativeCoverLetterPreparationEnabled: () => enabled,
      });
      await expect(
        native.prepareCoverLetter(
          failure === "foreign" ? uuidv7() : f.owner,
          f.app.id,
          {
            expectedRevision: f.app.revision,
            coverLetter: {
              disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
            },
          },
          key(),
        ),
      ).rejects.toThrow();
      const [count] =
        await appDb`SELECT count(*)::int AS total FROM applications.packet_preparations WHERE application_id = ${f.app.id}::uuid`;
      expect(count?.total).toBe(0);
    },
  );

  async function refusedCandidateMetadata(f: Awaited<ReturnType<typeof fixture>>) {
    // Value reads stay refused; the candidate receives explicit metadata for safe recovery.
    const recovery = await f.api.get(f.owner, f.app.id);
    expect(compileComponentValidator("Application")(recovery)).toBe(true);
    expect(recovery.packetAvailability).toBe("withheld");
    expect(recovery).not.toHaveProperty("currentPacket");
    expect(recovery).not.toHaveProperty("approval");
    expect(recovery.currentAction).not.toBe("ready_to_submit");
    const store = new PostgresApplicationStore(appDb, () => state.at, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
      lockVaultReferences: vault.lockCurrentReferences.bind(vault),
    });
    const view = await store.getApplication(f.owner, f.app.id);
    expect(
      view.currentPacket?.fields.find((field) => field.fieldKey === fieldKey)?.value,
    ).toBeNull();
    return { ...view.application, ...view };
  }

  async function approve(f: Awaited<ReturnType<typeof fixture>>) {
    return f.api.approve(
      f.owner,
      f.app.id,
      {
        expectedRevision: f.app.revision,
        packetHash: f.app.currentPacket?.packetHash ?? "",
        acknowledgedFieldKeys: [fieldKey],
      },
      key(),
    );
  }
  async function start(f: Awaited<ReturnType<typeof fixture>>) {
    const approved = await approve(f);
    const started = await f.api.startSubmission(
      f.owner,
      f.app.id,
      {
        expectedRevision: approved.revision,
        adapterId: form.adapterId,
        adapterVersion: "synthetic.v1",
        observedFormHash: form.formHash,
      },
      key(),
    );
    return { approved, started };
  }

  it.each(["corrected", "deleted", "expired"] as const)(
    "reopens and reprepares a %s selected answer with fresh review through confirmed history",
    async (kind) => {
      const f = await fixture(kind === "expired" ? new Date(Date.now() + 60_000) : undefined);
      await approve(f);
      if (kind === "corrected")
        await vault.save({
          ...f.command,
          expectedVersion: 1,
          value: "true",
          idempotencyKey: key(),
        });
      if (kind === "deleted")
        await vault.remove({
          userId: f.owner,
          id: f.selection.id,
          expectedVersion: 1,
          traceId: key(),
        });
      if (kind === "expired") state.at = new Date(state.at.getTime() + 60_001);
      const withheld = await f.api.get(f.owner, f.app.id);
      expect(withheld).toMatchObject({
        status: "approved",
        packetAvailability: "withheld",
        currentAction: "re_review",
      });
      const reopenKey = key();
      const reopened = await f.api.reopen(f.owner, f.app.id, withheld.revision, reopenKey);
      expect(reopened).toMatchObject({ status: "review_required", packetAvailability: "withheld" });
      expect((await f.api.reopen(f.owner, f.app.id, withheld.revision, reopenKey)).revision).toBe(
        reopened.revision,
      );
      const fresh = await f.api.preparePacket(
        f.owner,
        f.app.id,
        { expectedRevision: reopened.revision, form, userEntries: [{ fieldKey, value: true }] },
        key(),
      );
      expect(fresh.packetAvailability).toBeUndefined();
      expect(fresh.status).toBe("review_required");
      expect(fresh.approval).toBeUndefined();
      expect(fresh.currentPacket?.packetHash).not.toBe(f.app.currentPacket?.packetHash);
      expect(
        fresh.currentPacket?.fields.find((field) => field.fieldKey === fieldKey),
      ).toMatchObject({ value: true, origin: "user_entered", requiresReview: true });
      expect(
        fresh.currentPacket?.fields.find((field) => field.fieldKey === fieldKey),
      ).not.toHaveProperty("vaultReference");
      const approved = await f.api.approve(
        f.owner,
        f.app.id,
        {
          expectedRevision: fresh.revision,
          packetHash: fresh.currentPacket?.packetHash ?? "",
          acknowledgedFieldKeys: [fieldKey],
        },
        key(),
      );
      const started = await f.api.startManualSubmission(
        f.owner,
        f.app.id,
        {
          expectedRevision: approved.revision,
          observedForm: { form, capturedAtEpochMs: state.at.getTime(), confirmed: true },
        },
        key(),
      );
      const applied = await f.api.reconcile(
        f.owner,
        f.app.id,
        started.attemptId ?? "",
        {
          kind: "user_attested_submitted",
          observedAt: state.at.toISOString(),
          fingerprintSha256: "e".repeat(64),
        },
        key(),
      );
      expect(applied.status).toBe("applied");
      expect(applied.attempts).toHaveLength(1);
      expect((await f.api.history(f.owner, f.app.id, {})).entries.at(-1)?.kind).toBe(
        "submission_confirmed",
      );
    },
  );
  it.each(["submitted", "not_submitted"] as const)(
    "reconciles an existing manual attempt after withdrawal: %s",
    async (outcome) => {
      const f = await fixture();
      const approved = await approve(f);
      const started = await f.api.startManualSubmission(
        f.owner,
        f.app.id,
        {
          expectedRevision: approved.revision,
          observedForm: { form, capturedAtEpochMs: state.at.getTime(), confirmed: true },
        },
        key(),
      );
      await vault.remove({
        userId: f.owner,
        id: f.selection.id,
        expectedVersion: 1,
        traceId: key(),
      });
      const read = await f.api.get(f.owner, f.app.id);
      expect(read).toMatchObject({
        status: "takeover",
        packetAvailability: "withheld",
        currentAction: "complete_manually",
      });
      const request =
        outcome === "submitted"
          ? {
              kind: "user_attested_submitted" as const,
              observedAt: state.at.toISOString(),
              fingerprintSha256: "e".repeat(64),
            }
          : {
              kind: "user_attested_not_submitted" as const,
              acknowledgesDuplicateRisk: true as const,
            };
      const receipt = key();
      const result = await f.api.reconcile(
        f.owner,
        f.app.id,
        started.attemptId ?? "",
        request,
        receipt,
      );
      expect(result.packetAvailability).toBe("withheld");
      expect(result.status).toBe(outcome === "submitted" ? "applied" : "approved");
      expect(
        (await f.api.reconcile(f.owner, f.app.id, started.attemptId ?? "", request, receipt))
          .revision,
      ).toBe(result.revision);
      const page = await f.api.search(f.owner, {});
      expect(page.items).toEqual([result]);
      expect((await f.api.history(f.owner, f.app.id, {})).entries.length).toBeGreaterThan(0);
      await expect(f.api.get(uuidv7(), f.app.id)).rejects.toThrow();
      expect((await f.api.search(uuidv7(), {})).items).toHaveLength(0);
    },
  );

  it("starts a freshly confirmed manual form once and records candidate-confirmed submission/history", async () => {
    const f = await fixture();
    const approved = await approve(f);
    const request = {
      expectedRevision: approved.revision,
      observedForm: { form, capturedAtEpochMs: state.at.getTime(), confirmed: true as const },
    };
    const receiptKey = key();
    const started = await f.api.startManualSubmission(f.owner, f.app.id, request, receiptKey);
    expect(started).toMatchObject({
      outcome: "started",
      application: {
        status: "takeover",
        attempts: [{ status: "taken_over", adapterId: "manual" }],
      },
    });
    expect(started.application.attempts[0]?.dispatchedAt).toBeUndefined();
    state.at = new Date(state.at.getTime() + 60_001);
    const replay = await f.api.startManualSubmission(f.owner, f.app.id, request, receiptKey);
    expect(replay.attemptId).toBe(started.attemptId);
    expect(replay.application.attempts).toHaveLength(1);
    const applied = await f.api.reconcile(
      f.owner,
      f.app.id,
      started.attemptId ?? "",
      {
        kind: "user_attested_submitted",
        observedAt: state.at.toISOString(),
        fingerprintSha256: "e".repeat(64),
      },
      key(),
    );
    expect(applied.status).toBe("applied");
    expect((await f.api.history(f.owner, f.app.id, {})).entries.at(-1)).toMatchObject({
      kind: "submission_confirmed",
      toStatus: "applied",
    });
  });
  it.each(["absent", "changed"] as const)(
    "retains committed form invalidation for %s observations",
    async (kind) => {
      const f = await fixture();
      const approved = await approve(f);
      const started = await f.api.startManualSubmission(
        f.owner,
        f.app.id,
        {
          expectedRevision: approved.revision,
          ...(kind === "changed"
            ? {
                observedForm: {
                  form: { ...form, formHash: "f".repeat(64) },
                  capturedAtEpochMs: state.at.getTime(),
                  confirmed: true as const,
                },
              }
            : {}),
        },
        key(),
      );
      expect(started).toMatchObject({
        outcome: "approval_invalidated",
        application: { status: "review_required", attempts: [] },
      });
      expect(started.invalidationReasons).toContain("form_changed");
    },
  );
  it.each(["expired", "future", "adapter", "variant", "unconfirmed"] as const)(
    "refuses %s manual proof without starting an attempt",
    async (kind) => {
      const f = await fixture();
      const approved = await approve(f);
      const observedForm = {
        form: {
          ...form,
          ...(kind === "adapter" ? { adapterId: "other" } : {}),
          ...(kind === "variant" ? { variantId: "other" } : {}),
        },
        capturedAtEpochMs:
          state.at.getTime() + (kind === "expired" ? -60_000 : kind === "future" ? 1 : 0),
        confirmed: (kind !== "unconfirmed") as true,
      };
      await expect(
        f.api.startManualSubmission(
          f.owner,
          f.app.id,
          { expectedRevision: approved.revision, observedForm },
          key(),
        ),
      ).rejects.toThrow();
      const view = await f.api.get(f.owner, f.app.id);
      expect(view.status).toBe("approved");
      expect(view.attempts).toHaveLength(0);
    },
  );
  it("checks observation expiry after waiting for the application transaction lock", async () => {
    const f = await fixture();
    const approved = await approve(f);
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = appDb.begin(async (tx) => {
      await tx`SELECT id FROM applications.applications WHERE id = ${f.app.id}::uuid FOR UPDATE`;
      locked();
      await unlock;
    });
    await held;
    const request = {
      expectedRevision: approved.revision,
      observedForm: { form, capturedAtEpochMs: state.at.getTime(), confirmed: true as const },
    };
    const result = f.api.startManualSubmission(f.owner, f.app.id, request, key()).then(
      () => true,
      () => false,
    );
    try {
      let waiting = false;
      for (let probe = 0; probe < 100; probe++) {
        const [row] = await appDb<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()) AS waiting`;
        if (row?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      state.at = new Date(state.at.getTime() + 60_000);
    } finally {
      release();
      await blocker;
    }
    expect(await result).toBe(false);
    expect((await f.api.get(f.owner, f.app.id)).attempts).toHaveLength(0);
  });
  it.each(["corrected", "deleted", "expired"] as const)(
    "does not let fresh form confirmation revive a %s saved answer",
    async (kind) => {
      const f = await fixture(kind === "expired" ? new Date(Date.now() + 60_000) : undefined);
      const approved = await approve(f);
      if (kind === "corrected")
        await vault.save({ ...f.command, expectedVersion: 1, idempotencyKey: key() });
      if (kind === "deleted")
        await vault.remove({
          userId: f.owner,
          id: f.selection.id,
          expectedVersion: 1,
          traceId: key(),
        });
      if (kind === "expired") state.at = new Date(state.at.getTime() + 60_001);
      const request = {
        expectedRevision: approved.revision,
        observedForm: { form, capturedAtEpochMs: state.at.getTime(), confirmed: true as const },
      };
      const refused = await f.api.startManualSubmission(f.owner, f.app.id, request, key());
      expect(refused).toMatchObject({
        outcome: "approval_invalidated",
        application: { status: "review_required", packetAvailability: "withheld", attempts: [] },
      });
      expect(refused.invalidationReasons).toContain("vault_answer_changed");
      expect(refused.attemptId).toBeUndefined();
      const view = await refusedCandidateMetadata(f);
      expect(view.status).toBe("review_required");
      expect(view.attempts).toHaveLength(0);
    },
  );

  it("prepares the exact selected value, returns contract-valid metadata and requires review before dispatch", async () => {
    const f = await fixture();
    const field = f.app.currentPacket?.fields.find((entry) => entry.fieldKey === fieldKey);
    expect(field).toMatchObject({
      value: false,
      origin: "answer_vault",
      requiresReview: true,
      vaultReference: { id: f.selection.id, version: 1, context: "us", validUntilEpochMs: null },
    });
    expect(compileComponentValidator("Application")(f.app)).toBe(true);
    await expect(
      f.api.approve(
        f.owner,
        f.app.id,
        {
          expectedRevision: f.app.revision,
          packetHash: f.app.currentPacket?.packetHash ?? "",
          acknowledgedFieldKeys: [],
        },
        key(),
      ),
    ).rejects.toBeInstanceOf(ApprovalRefusedError);
    const { started } = await start(f);
    await expect(
      f.api.dispatchAttempt(f.owner, f.app.id, started.attemptId ?? ""),
    ).resolves.toMatchObject({ status: "dispatched" });
  });

  it("keeps new reuse disabled by default and withholds reads when the switch is withdrawn", async () => {
    const f = await fixture();
    const before = decryptCalls;
    const off = runtime(false);
    await expect(
      off.preparePacket(
        f.owner,
        f.app.id,
        { ...f.request, expectedRevision: f.app.revision },
        key(),
      ),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
    await expect(
      off.approve(
        f.owner,
        f.app.id,
        {
          expectedRevision: f.app.revision,
          packetHash: f.app.currentPacket?.packetHash ?? "",
          acknowledgedFieldKeys: [fieldKey],
        },
        key(),
      ),
    ).rejects.toBeInstanceOf(ApplicationsUnavailableError);
    expect(decryptCalls).toBe(before);
  });

  it("refuses a same-value correction before approval without refreshing the original version", async () => {
    const f = await fixture();
    await vault.save({ ...f.command, expectedVersion: 1, idempotencyKey: key() });
    await expect(approve(f)).rejects.toMatchObject({ reasons: ["vault_answer_changed"] });
    const view = await refusedCandidateMetadata(f);
    expect(view.status).toBe("review_required");
    expect(view.currentPacket?.fields[0]?.vaultReference?.version).toBe(1);
    expect(view.approval).toBeNull();
  });

  it("commits truthful approval invalidation when the selected revision is deleted before start", async () => {
    const f = await fixture();
    const approved = await approve(f);
    await vault.remove({
      userId: f.owner,
      id: f.selection.id,
      expectedVersion: 1,
      traceId: "synthetic.delete",
    });
    await expect(
      f.api.startSubmission(
        f.owner,
        f.app.id,
        {
          expectedRevision: approved.revision,
          adapterId: form.adapterId,
          adapterVersion: "synthetic.v1",
          observedFormHash: form.formHash,
        },
        key(),
      ),
    ).resolves.toMatchObject({
      outcome: "approval_invalidated",
      invalidationReasons: ["vault_answer_changed"],
      application: { status: "review_required", packetAvailability: "withheld", attempts: [] },
    });
    expect((await refusedCandidateMetadata(f)).status).toBe("review_required");
    const [approval] = await appDb<
      Array<{ reason: string }>
    >`SELECT invalidation_reason AS reason FROM applications.approvals WHERE application_id = ${f.app.id}::uuid`;
    expect(approval?.reason).toBe("vault_answer_changed");
  });

  it.each(["corrected", "deleted", "expired"] as const)(
    "never dispatches a queued %s selected answer and persists one no-effect refusal",
    async (outcome) => {
      const expiresAt = outcome === "expired" ? new Date(Date.now() + 60_000) : undefined;
      const f = await fixture(expiresAt);
      const { started } = await start(f);
      if (outcome === "corrected")
        await vault.save({
          ...f.command,
          expectedVersion: 1,
          value: "true",
          idempotencyKey: key(),
        });
      if (outcome === "deleted")
        await vault.remove({
          userId: f.owner,
          id: f.selection.id,
          expectedVersion: 1,
          traceId: "synthetic.delete",
        });
      if (expiresAt) state.at = new Date(expiresAt.getTime());
      await expect(
        f.api.dispatchAttempt(f.owner, f.app.id, started.attemptId ?? ""),
      ).rejects.toMatchObject({ reasons: ["vault_answer_changed"] });
      const view = await refusedCandidateMetadata(f);
      expect(view.status).toBe("review_required");
      expect(view.attempts[0]).toMatchObject({ status: "failed_no_effect" });
      expect(view.attempts[0]).not.toHaveProperty("dispatchedAt");
      const history = await f.api.history(f.owner, f.app.id, {});
      expect(history.entries.filter((entry) => entry.kind === "attempt_dispatched")).toEqual([]);
      expect(
        history.entries.filter((entry) => entry.kind === "attempt_failed_no_effect"),
      ).toHaveLength(1);
      const [approval] = await appDb<
        Array<{ reason: string }>
      >`SELECT invalidation_reason AS reason FROM applications.approvals WHERE application_id = ${f.app.id}::uuid`;
      expect(approval?.reason).toBe("vault_answer_changed");
    },
  );

  it("does not use foreign selections and does not decrypt an unavailable selection", async () => {
    const f = await fixture();
    const other = await fixture();
    const before = decryptCalls;
    await expect(
      other.api.preparePacket(
        other.owner,
        other.app.id,
        { ...other.request, expectedRevision: other.app.revision, vaultSelections: [f.selection] },
        key(),
      ),
    ).rejects.toBeInstanceOf(StalePacketError);
    expect(decryptCalls).toBe(before);
  });

  it("preserves selected provenance through asynchronous cover-letter packet completion and portability", async () => {
    const f = await fixture();
    const operation = await f.api.prepareCoverLetter(
      f.owner,
      f.app.id,
      {
        ...f.request,
        expectedRevision: f.app.revision,
        coverLetter: {
          disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
        },
      },
      key(),
    );
    const [event] = await appDb<
      Array<{ id: string }>
    >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${operation.id}::uuid`;
    if (!event) throw new Error("MissingSyntheticPreparationEvent");
    const store = new PostgresApplicationStore(appDb, () => state.at, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
      lockVaultReferences: vault.lockCurrentReferences.bind(vault),
    });
    const current = await vault.readCurrentReference(f.owner, f.selection);
    if (!current) throw new Error("MissingSyntheticVaultReceipt");
    const liveContext = { ...context, vaultReferences: [current] };
    await store.claimPreparationGeneration(event.id, operation.id, liveContext);
    await store.completePreparation(event.id, operation.id, context, {
      contentSha256: "e".repeat(64),
      sourceFactIds: [uuidv7()],
      confidence: 0.9,
    });
    const view = await f.api.get(f.owner, f.app.id);
    expect(
      view.currentPacket?.fields.find((field) => field.fieldKey === fieldKey)?.vaultReference,
    ).toMatchObject({ id: f.selection.id, version: 1, context: "us" });
    const [exported] = await appDb<
      Array<{ data: { packets: Array<{ fields: unknown[] }> } }>
    >`SELECT applications.export_candidate_data(${f.owner}::uuid) AS data`;
    expect(JSON.stringify(exported?.data)).toContain('"vaultReference"');
    expect(JSON.stringify(exported?.data)).not.toContain("ciphertext");
  });

  it("exercises authenticated HTTP through actual Profile/vault/Applications persistence with simulated OIDC and KMS", async () => {
    state.at = new Date();
    const issuer = await createTestTokenIssuer();
    const api = runtime();
    const app = await createGatewayApplication({
      store: realProfile,
      catalog: catalog as never,
      jobReports: {} as never,
      jobContributions: {} as never,
      moderation: {} as never,
      savedJobs: {} as never,
      matchAssessments: {} as never,
      entitlements: {} as never,
      documents: {} as never,
      applications: api,
      verifier: issuer.verifier,
      releaseSha: "test",
    });
    try {
      const token = await issuer.issue(`synthetic-vault-${uuidv7()}`, {
        scope: "applications:read applications:write",
      });
      const headers = { authorization: `Bearer ${token}`, "idempotency-key": key() };
      const created = await app.inject({
        method: "POST",
        url: "/v1/applications",
        headers,
        payload: { jobId },
      });
      expect(created.statusCode).toBe(201);
      const application = created.json<{ id: string; revision: number }>();
      const [row] = await appDb<
        Array<{ owner: string }>
      >`SELECT owner_user_id AS owner FROM applications.applications WHERE id = ${application.id}::uuid`;
      if (!row) throw new Error("MissingSyntheticOwner");
      const saved = await vault.save({
        userId: row.owner,
        fieldKey,
        context: "us",
        expectedVersion: 0,
        valueType: "boolean",
        value: "false",
        sensitivity: "restricted",
        confirmedAt: state.at,
        sourceReference: "synthetic.http",
        idempotencyKey: key(),
        traceId: "synthetic.http",
      });
      const packet = await app.inject({
        method: "POST",
        url: `/v1/applications/${application.id}/packets`,
        headers: { ...headers, "idempotency-key": key() },
        payload: {
          expectedRevision: application.revision,
          form,
          vaultSelections: [
            {
              ...saved,
              fieldKey,
              context: "us",
              questionHash: "d".repeat(64),
              meaningConfirmed: true,
            },
          ],
        },
      });
      expect(packet.statusCode).toBe(201);
      expect(packet.headers["cache-control"]).toBe("no-store");
      expect(packet.json().currentPacket.fields[0]).toMatchObject({
        value: false,
        requiresReview: true,
        vaultReference: { id: saved.id, version: 1 },
      });
      await vault.remove({
        userId: row.owner,
        id: saved.id,
        expectedVersion: 1,
        traceId: "synthetic.http-delete",
      });
      const prepared = packet.json<{ revision: number; currentPacket: { packetHash: string } }>();
      const approval = await app.inject({
        method: "POST",
        url: `/v1/applications/${application.id}/approval`,
        headers: { ...headers, "idempotency-key": key() },
        payload: {
          expectedRevision: prepared.revision,
          packetHash: prepared.currentPacket.packetHash,
          acknowledgedFieldKeys: [fieldKey],
        },
      });
      expect(approval.statusCode).toBe(409);
      expect(approval.headers["cache-control"]).toBe("no-store");
      expect(approval.json()).toMatchObject({
        code: "application_packet_stale",
        title: "Saved answer changed",
      });
      expect(approval.body).not.toContain(saved.id);
    } finally {
      await app.close();
    }
  });

  it.each(["queued", "running"] as const)(
    "withholds asynchronous %s work after the original selected answer changes",
    async (phase) => {
      const f = await fixture();
      const operation = await f.api.prepareCoverLetter(
        f.owner,
        f.app.id,
        {
          ...f.request,
          expectedRevision: f.app.revision,
          coverLetter: {
            disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
          },
        },
        key(),
      );
      const [event] = await appDb<
        Array<{ id: string }>
      >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${operation.id}::uuid`;
      if (!event) throw new Error("MissingSyntheticEvent");
      const store = new PostgresApplicationStore(appDb, () => state.at, {
        definitions: defaultFieldDefinitions(),
        restrictedPackets: packetProtection.options,
        lockVaultReferences: vault.lockCurrentReferences.bind(vault),
      });
      const current = await vault.readCurrentReference(f.owner, f.selection);
      if (!current) throw new Error("MissingSyntheticReference");
      if (phase === "running")
        await store.claimPreparationGeneration(event.id, operation.id, {
          ...context,
          vaultReferences: [current],
        });
      await vault.save({ ...f.command, expectedVersion: 1, idempotencyKey: key() });
      let effects = 0;
      const activity = createPreparationActivity(
        store,
        {
          context: async () => context,
          recover: async () => {
            effects++;
            throw new Error("SyntheticRecoveryMustNotRun");
          },
          generate: async () => {
            effects++;
            throw new Error("SyntheticGenerationMustNotRun");
          },
        },
        vault,
      );
      await expect(activity(event.id, operation.id)).resolves.toMatchObject({
        outcome: "completed",
      });
      expect(effects).toBe(0);
      expect(await f.api.preparation(f.owner, f.app.id, operation.id)).toMatchObject({
        state: "failed",
        errorCode: "bindings_changed",
      });
      const refs = await store.getPreparationVaultReferences(event.id, operation.id);
      expect(refs).toHaveLength(1);
      expect(refs[0]?.id).toBe(f.selection.id);
      expect(refs[0]).not.toHaveProperty("value");
      expect(refs[0]).not.toHaveProperty("ciphertext");
    },
  );

  it("refuses final asynchronous packet creation after a selected-answer correction", async () => {
    const f = await fixture();
    const operation = await f.api.prepareCoverLetter(
      f.owner,
      f.app.id,
      {
        ...f.request,
        expectedRevision: f.app.revision,
        coverLetter: {
          disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true },
        },
      },
      key(),
    );
    const [event] = await appDb<
      Array<{ id: string }>
    >`SELECT id FROM applications.preparation_outbox WHERE preparation_id = ${operation.id}::uuid`;
    if (!event) throw new Error("MissingSyntheticEvent");
    const store = new PostgresApplicationStore(appDb, () => state.at, {
      definitions: defaultFieldDefinitions(),
      restrictedPackets: packetProtection.options,
      lockVaultReferences: vault.lockCurrentReferences.bind(vault),
    });
    const current = await vault.readCurrentReference(f.owner, f.selection);
    if (!current) throw new Error("MissingSyntheticReference");
    await store.claimPreparationGeneration(event.id, operation.id, {
      ...context,
      vaultReferences: [current],
    });
    await vault.remove({
      userId: f.owner,
      id: f.selection.id,
      expectedVersion: 1,
      traceId: "synthetic.delete",
    });
    await expect(
      store.completePreparation(
        event.id,
        operation.id,
        { ...context, vaultReferences: [] },
        { contentSha256: "e".repeat(64), sourceFactIds: [uuidv7()], confidence: 0.9 },
      ),
    ).resolves.toMatchObject({
      state: "failed",
      errorCode: "bindings_changed",
      resultPacketId: null,
    });
  });

  it.each([
    ["approve", "expiry"],
    ["dispatch", "expiry"],
    ["approve", "correction"],
    ["dispatch", "correction"],
    ["approve", "delete"],
    ["dispatch", "delete"],
    ["approve", "delete_by_field"],
    ["dispatch", "delete_by_field"],
  ] as const)(
    "rechecks source after an Applications lock wait at %s (%s)",
    async (operation, change) => {
      const deadline = new Date(Date.now() + 60_000);
      const f = await fixture(deadline);
      const started = operation === "dispatch" ? (await start(f)).started : undefined;
      let locked!: () => void;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const unlock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = appDb.begin(async (tx) => {
        await tx`SELECT id FROM applications.applications WHERE id = ${f.app.id}::uuid FOR UPDATE`;
        locked();
        await unlock;
      });
      await held;
      let received!: () => void;
      const observed = new Promise<void>((resolve) => {
        received = resolve;
      });
      const api = runtime(true, received);
      const pending =
        operation === "approve"
          ? api.approve(
              f.owner,
              f.app.id,
              {
                expectedRevision: f.app.revision,
                packetHash: f.app.currentPacket?.packetHash ?? "",
                acknowledgedFieldKeys: [fieldKey],
              },
              key(),
            )
          : api.dispatchAttempt(f.owner, f.app.id, started?.attemptId ?? "");
      // Install rejection handling before releasing the real SQL lock.
      const settled = pending.then(
        () => ({ accepted: true, reasons: [] as readonly string[] }),
        (error: unknown) => ({
          accepted: false,
          reasons: error instanceof StalePacketError ? error.reasons : [],
        }),
      );
      try {
        await observed;
        if (change === "expiry") state.at = new Date(deadline.getTime());
        else if (change === "correction")
          await vault.save({ ...f.command, expectedVersion: 1, idempotencyKey: key() });
        else if (change === "delete")
          await vault.remove({
            userId: f.owner,
            id: f.selection.id,
            expectedVersion: 1,
            traceId: key(),
          });
        else
          await vault.removeByField({
            userId: f.owner,
            fieldKey,
            context: f.selection.context,
            traceId: key(),
          });
      } finally {
        release();
        await blocker;
      }
      expect(await settled).toEqual({ accepted: false, reasons: ["vault_answer_changed"] });
      const view = await refusedCandidateMetadata(f);
      expect(view.status).toBe("review_required");
      expect(view.attempts.some((attempt) => attempt.dispatchedAt)).toBe(false);
    },
  );
  it("keeps value-free owner admission locks through rollback and blocks a writer", async () => {
    const f = await fixture();
    const before = decryptCalls;
    let acquired!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const unlock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = appDb
      .begin(async (tx) => {
        const query: VaultAdmissionQuery = async (parts, ...values) =>
          (tx as unknown as VaultAdmissionQuery)(parts, ...values);
        const refs = await vault.lockCurrentReferences(f.owner, [f.selection], query);
        expect(refs).toEqual([
          {
            id: f.selection.id,
            version: 1,
            fieldKey,
            context: f.selection.context,
            validUntilEpochMs: null,
          },
        ]);
        expect(decryptCalls).toBe(before);
        acquired();
        await unlock;
        throw new Error("SyntheticAdmissionRollback");
      })
      .then(
        () => false,
        (error: unknown) =>
          error instanceof Error && error.message === "SyntheticAdmissionRollback",
      );
    await held;
    let finished = false;
    const writer = vault
      .remove({ userId: f.owner, id: f.selection.id, expectedVersion: 1, traceId: key() })
      .then((result) => {
        finished = true;
        return result;
      });
    try {
      let waiting = false;
      for (let probe = 0; probe < 100; probe++) {
        const [row] = await appDb<Array<{ waiting: boolean }>>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'
        ) AS waiting`;
        if (row?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    expect(await admission).toBe(true);
    expect(await writer).toEqual({ version: 2 });
    expect(await vault.readCurrentReference(f.owner, f.selection)).toBeUndefined();
    expect(decryptCalls).toBe(before);
  });
  it("refuses selected-answer approval when the admission capability is unavailable", async () => {
    const f = await fixture();
    await expect(approve({ ...f, api: runtime(true, undefined, false) })).rejects.toBeInstanceOf(
      VaultBindingsUnavailableError,
    );
    const view = await f.api.get(f.owner, f.app.id);
    expect(view.status).toBe("review_required");
    expect(view.approval).toBeUndefined();
  });
});
