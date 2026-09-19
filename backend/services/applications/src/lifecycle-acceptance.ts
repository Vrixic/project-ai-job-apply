import type postgres from "postgres";

/**
 * Generated-synthetic fixture for the deployed Applications lifecycle acceptance. `prepare`
 * creates exactly two generated identities (an owner and a foreign candidate). `cleanup` removes
 * the owner's Applications data through the privacy-authorized deletion function, then the two
 * identities, and proves every owned count is zero. It never accepts SQL, a table name, or a
 * candidate value, and it refuses to run against a contaminated boundary.
 */

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const APPLICATIONS_ACCEPTANCE_CONFIRMATION = "generated-synthetic-applications-acceptance";
const POLICY_VERSION = "synthetic-applications-acceptance-v1";

export type ApplicationsAcceptanceAction = "prepare" | "cleanup";

export interface ApplicationsAcceptanceInput {
  action: ApplicationsAcceptanceAction;
  runId: string;
  issuer: string;
  ownerUserId: string;
  otherUserId: string;
  at?: Date;
}

export interface ApplicationsAcceptanceResult {
  schemaVersion: 1;
  action: ApplicationsAcceptanceAction;
  identityCount: number;
  userCount: number;
  applicationRowCount: number;
  applicationsDeleted: number;
}

export function applicationsAcceptanceSubject(role: "owner" | "other", runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("The Applications acceptance run ID is invalid");
  return `d3-applications-acceptance:${role}:${runId}`;
}

function canonicalTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("The Applications acceptance timestamp is invalid");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("The Applications acceptance timestamp is invalid");
  }
  return parsed;
}

function exactIssuer(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      value.length <= 512 &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.pathname === "/" &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

export function parseApplicationsAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): ApplicationsAcceptanceInput {
  if (environment.APPLICATIONS_ACCEPTANCE_CONFIRMATION !== APPLICATIONS_ACCEPTANCE_CONFIRMATION) {
    throw new Error("The generated-synthetic Applications acceptance confirmation is required");
  }
  const action = environment.APPLICATIONS_ACCEPTANCE_ACTION;
  const runId = environment.APPLICATIONS_ACCEPTANCE_RUN_ID ?? "";
  const issuer = environment.APPLICATIONS_ACCEPTANCE_ISSUER ?? "";
  const ownerUserId = environment.APPLICATIONS_ACCEPTANCE_OWNER_USER_ID ?? "";
  const otherUserId = environment.APPLICATIONS_ACCEPTANCE_OTHER_USER_ID ?? "";
  if (action !== "prepare" && action !== "cleanup") {
    throw new Error("The Applications acceptance action is invalid");
  }
  if (
    !RUN_ID_PATTERN.test(runId) ||
    !exactIssuer(issuer) ||
    !UUID_V7_PATTERN.test(ownerUserId) ||
    !UUID_V7_PATTERN.test(otherUserId) ||
    ownerUserId === otherUserId
  ) {
    throw new Error("The Applications acceptance identity boundary is invalid");
  }
  const at = canonicalTimestamp(environment.APPLICATIONS_ACCEPTANCE_AT);
  if ((action === "prepare") !== Boolean(at)) {
    throw new Error("Only Applications prepare accepts an exact timestamp");
  }
  return { action, runId, issuer, ownerUserId, otherUserId, ...(at ? { at } : {}) };
}

export function assertRecentApplicationsAcceptanceTime(at: Date, now = new Date()): void {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    Math.abs(now.getTime() - at.getTime()) > 15 * 60_000
  ) {
    throw new Error("The Applications acceptance timestamp is outside the bounded clock window");
  }
}

interface Counts {
  identityCount: number;
  userCount: number;
  ownerApplicationRows: number;
  otherApplicationRows: number;
  relatedCount: number;
}

async function ownedCounts(
  transaction: postgres.TransactionSql,
  input: ApplicationsAcceptanceInput,
): Promise<Counts> {
  const userIds = transaction.array([input.ownerUserId, input.otherUserId]);
  const subjects = transaction.array([
    applicationsAcceptanceSubject("owner", input.runId),
    applicationsAcceptanceSubject("other", input.runId),
  ]);
  const [row] = await transaction<Counts[]>`
    SELECT
      (SELECT count(*)::int FROM identity.external_identities
        WHERE issuer = ${input.issuer} AND subject = ANY(${subjects}::text[])) AS "identityCount",
      (SELECT count(*)::int FROM identity.users WHERE id = ANY(${userIds}::uuid[])) AS "userCount",
      ((SELECT count(*)::int FROM applications.applications WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.packets WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.approvals WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.attempts WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.history WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.command_receipts WHERE owner_user_id = ${input.ownerUserId}) +
       (SELECT count(*)::int FROM applications.outbox WHERE owner_user_id = ${input.ownerUserId})
      )::int AS "ownerApplicationRows",
      ((SELECT count(*)::int FROM applications.applications WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.packets WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.approvals WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.attempts WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.history WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.command_receipts WHERE owner_user_id = ${input.otherUserId}) +
       (SELECT count(*)::int FROM applications.outbox WHERE owner_user_id = ${input.otherUserId})
      )::int AS "otherApplicationRows",
      ((SELECT count(*)::int FROM profile.job_preferences WHERE user_id = ANY(${userIds}::uuid[])) +
       (SELECT count(*)::int FROM profile.profile_facts WHERE user_id = ANY(${userIds}::uuid[])) +
       (SELECT count(*)::int FROM platform.operations WHERE user_id = ANY(${userIds}::uuid[])) +
       (SELECT count(*)::int FROM platform.idempotency_keys WHERE user_id = ANY(${userIds}::uuid[])) +
       (SELECT count(*)::int FROM platform.audit_events WHERE user_id = ANY(${userIds}::uuid[])) +
       (SELECT count(*)::int FROM profile.account_deletion_requests WHERE user_id = ANY(${userIds}::uuid[]))
      )::int AS "relatedCount"
  `;
  if (!row) throw new Error("The Applications acceptance fixture could not be inspected");
  return row;
}

export async function executeApplicationsAcceptance(
  client: postgres.Sql,
  input: ApplicationsAcceptanceInput,
): Promise<ApplicationsAcceptanceResult> {
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${`applications:lifecycle-acceptance:${input.runId}`}))
    `;
    const before = await ownedCounts(transaction, input);
    if (input.action === "prepare") {
      if (!input.at || Object.values(before).some((value) => value !== 0)) {
        throw new Error("The Applications acceptance fixture already exists or is contaminated");
      }
      const at = input.at;
      await transaction`
        INSERT INTO identity.users (id, created_at)
        VALUES (${input.ownerUserId}, ${at}), (${input.otherUserId}, ${at})
      `;
      await transaction`
        INSERT INTO identity.external_identities (
          issuer, subject, user_id, email, created_at, last_seen_at
        ) VALUES
          (${input.issuer}, ${applicationsAcceptanceSubject("owner", input.runId)},
           ${input.ownerUserId}, NULL, ${at}, ${at}),
          (${input.issuer}, ${applicationsAcceptanceSubject("other", input.runId)},
           ${input.otherUserId}, NULL, ${at}, ${at})
      `;
      const prepared = await ownedCounts(transaction, input);
      if (
        prepared.identityCount !== 2 ||
        prepared.userCount !== 2 ||
        prepared.ownerApplicationRows !== 0 ||
        prepared.otherApplicationRows !== 0 ||
        prepared.relatedCount !== 0
      ) {
        throw new Error("The Applications acceptance fixture was not prepared exactly");
      }
      return {
        schemaVersion: 1,
        action: "prepare",
        identityCount: 2,
        userCount: 2,
        applicationRowCount: 0,
        applicationsDeleted: 0,
      };
    }

    // The foreign candidate never owns Applications data, and nothing else may reference either
    // identity: cleanup removes exactly what the lifecycle created and nothing more.
    if (
      before.identityCount !== 2 ||
      before.userCount !== 2 ||
      before.otherApplicationRows !== 0 ||
      before.relatedCount !== 0
    ) {
      throw new Error("The Applications acceptance cleanup boundary is contaminated");
    }

    const requestId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const confirmedAt = new Date(Date.now() - 1_000);
    const backupExpiresAt = new Date(confirmedAt.getTime() + 35 * 24 * 60 * 60 * 1_000);
    await transaction`
      INSERT INTO platform.operations (id, user_id, kind, state)
      VALUES (${operationId}, ${input.ownerUserId}, 'account_deletion', 'queued')
    `;
    await transaction`
      INSERT INTO profile.account_deletion_requests (
        id, user_id, operation_id, policy_version, state, version,
        requested_at, updated_at, confirmed_at, backup_expires_at
      ) VALUES (
        ${requestId}, ${input.ownerUserId}, ${operationId}, ${POLICY_VERSION},
        'quarantined', 2, ${confirmedAt}, ${confirmedAt}, ${confirmedAt}, ${backupExpiresAt}
      )
    `;
    await transaction`
      INSERT INTO privacy.account_deletion_ledger (
        request_id, subject_digest, policy_version, policy_sha256, state,
        owner_inventory, subprocessor_inventory, confirmed_at, backup_expires_at, updated_at
      ) VALUES (
        ${requestId}, ${"1".repeat(64)}, ${POLICY_VERSION}, ${"2".repeat(64)},
        'quarantined', ${transaction.json({ applications: "pending" })}, ${transaction.json({})},
        ${confirmedAt}, ${backupExpiresAt}, ${confirmedAt}
      )
    `;
    const [deletion] = await transaction<{ result: { applicationsDeleted: number } }[]>`
      SELECT applications.delete_candidate_data(${input.ownerUserId}::uuid, ${requestId}::uuid) AS result
    `;
    await transaction`DELETE FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}`;
    await transaction`DELETE FROM profile.account_deletion_requests WHERE id = ${requestId}`;
    await transaction`DELETE FROM platform.operations WHERE id = ${operationId}`;
    const deletedIdentities = await transaction`
      DELETE FROM identity.external_identities
      WHERE issuer = ${input.issuer}
        AND subject = ANY(${transaction.array([
          applicationsAcceptanceSubject("owner", input.runId),
          applicationsAcceptanceSubject("other", input.runId),
        ])}::text[])
    `;
    const deletedUsers = await transaction`
      DELETE FROM identity.users
      WHERE id = ANY(${transaction.array([input.ownerUserId, input.otherUserId])}::uuid[])
    `;
    if (deletedIdentities.count !== 2 || deletedUsers.count !== 2) {
      throw new Error("The Applications acceptance cleanup was not exact");
    }
    const after = await ownedCounts(transaction, input);
    const [ledgerLeft] = await transaction<{ total: number }[]>`
      SELECT count(*)::int AS total FROM privacy.account_deletion_ledger WHERE request_id = ${requestId}
    `;
    if (Object.values(after).some((value) => value !== 0) || ledgerLeft?.total !== 0) {
      throw new Error("The Applications acceptance cleanup left owned rows");
    }
    return {
      schemaVersion: 1,
      action: "cleanup",
      identityCount: 0,
      userCount: 0,
      applicationRowCount: 0,
      applicationsDeleted: Number(deletion?.result.applicationsDeleted ?? 0),
    };
  });
}
