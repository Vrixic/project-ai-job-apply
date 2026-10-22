import type postgres from "postgres";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONFIRMATION = "generated-synthetic-private-feature-acceptance";

export type PrivateFeatureProfileAcceptanceAction = "prepare" | "cleanup";

export interface PrivateFeatureProfileAcceptanceInput {
  action: PrivateFeatureProfileAcceptanceAction;
  runId: string;
  issuer: string;
  ownerUserId: string;
  otherUserId: string;
  preferenceSetId: string;
  at?: Date;
}

export interface PrivateFeatureProfileAcceptanceResult {
  schemaVersion: 1;
  action: PrivateFeatureProfileAcceptanceAction;
  identityCount: number;
  preferenceCount: number;
  userCount: number;
}

export function privateFeatureAcceptanceSubject(role: "owner" | "other", runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("The private-feature run ID is invalid");
  return `d1-private-feature-acceptance:${role}:${runId}`;
}

function canonicalTimestamp(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("The private-feature timestamp is invalid");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("The private-feature timestamp is invalid");
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

export function parsePrivateFeatureProfileAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): PrivateFeatureProfileAcceptanceInput {
  if (environment.PRIVATE_FEATURE_ACCEPTANCE_CONFIRMATION !== CONFIRMATION) {
    throw new Error("The generated-synthetic private-feature confirmation is required");
  }
  const action = environment.PRIVATE_FEATURE_ACCEPTANCE_ACTION;
  const runId = environment.PRIVATE_FEATURE_ACCEPTANCE_RUN_ID ?? "";
  const issuer = environment.PRIVATE_FEATURE_ACCEPTANCE_ISSUER ?? "";
  const ownerUserId = environment.PRIVATE_FEATURE_ACCEPTANCE_OWNER_USER_ID ?? "";
  const otherUserId = environment.PRIVATE_FEATURE_ACCEPTANCE_OTHER_USER_ID ?? "";
  const preferenceSetId = environment.PRIVATE_FEATURE_ACCEPTANCE_PREFERENCE_SET_ID ?? "";
  if (action !== "prepare" && action !== "cleanup") {
    throw new Error("The private-feature Profile action is invalid");
  }
  if (
    !RUN_ID_PATTERN.test(runId) ||
    !exactIssuer(issuer) ||
    !UUID_V7_PATTERN.test(ownerUserId) ||
    !UUID_V7_PATTERN.test(otherUserId) ||
    ownerUserId === otherUserId ||
    !UUID_V7_PATTERN.test(preferenceSetId)
  ) {
    throw new Error("The private-feature Profile identity boundary is invalid");
  }
  const at = canonicalTimestamp(environment.PRIVATE_FEATURE_ACCEPTANCE_AT);
  if ((action === "prepare") !== Boolean(at)) {
    throw new Error("Only Profile prepare accepts an exact timestamp");
  }
  return {
    action,
    runId,
    issuer,
    ownerUserId,
    otherUserId,
    preferenceSetId,
    ...(at ? { at } : {}),
  };
}

export function assertRecentPrivateFeatureAcceptanceTime(at: Date, now = new Date()): void {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    Math.abs(now.getTime() - at.getTime()) > 15 * 60_000
  ) {
    throw new Error("The private-feature timestamp is outside the bounded clock window");
  }
}

async function ownedCounts(
  transaction: postgres.TransactionSql,
  input: PrivateFeatureProfileAcceptanceInput,
): Promise<{
  identityCount: number;
  preferenceCount: number;
  userCount: number;
  relatedCount: number;
}> {
  const userIds = [input.ownerUserId, input.otherUserId];
  const subjects = [
    privateFeatureAcceptanceSubject("owner", input.runId),
    privateFeatureAcceptanceSubject("other", input.runId),
  ];
  const [row] = await transaction<
    { identityCount: number; preferenceCount: number; userCount: number; relatedCount: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM identity.external_identities
        WHERE issuer = ${input.issuer}
          AND subject = ANY(${transaction.array(subjects)}::text[])) AS "identityCount",
      (SELECT count(*)::int FROM profile.job_preferences
        WHERE user_id = ANY(${transaction.array(userIds)}::uuid[])) AS "preferenceCount",
      (SELECT count(*)::int FROM identity.users
        WHERE id = ANY(${transaction.array(userIds)}::uuid[])) AS "userCount",
      ((SELECT count(*)::int FROM platform.operations
          WHERE user_id = ANY(${transaction.array(userIds)}::uuid[])) +
       (SELECT count(*)::int FROM platform.idempotency_keys
          WHERE user_id = ANY(${transaction.array(userIds)}::uuid[])) +
       (SELECT count(*)::int FROM platform.audit_events
          WHERE user_id = ANY(${transaction.array(userIds)}::uuid[])))::int AS "relatedCount"
  `;
  if (!row) throw new Error("The private-feature Profile fixture could not be inspected");
  return row;
}

export async function executePrivateFeatureProfileAcceptance(
  client: postgres.Sql,
  input: PrivateFeatureProfileAcceptanceInput,
): Promise<PrivateFeatureProfileAcceptanceResult> {
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${`profile:private-feature-acceptance:${input.runId}`}))
    `;
    const before = await ownedCounts(transaction, input);
    if (input.action === "prepare") {
      if (!input.at || Object.values(before).some((value) => value !== 0)) {
        throw new Error("The private-feature Profile fixture already exists or is contaminated");
      }
      const fixtureAt = input.at;
      const subjects = [
        privateFeatureAcceptanceSubject("owner", input.runId),
        privateFeatureAcceptanceSubject("other", input.runId),
      ] as const;
      await transaction`
        INSERT INTO identity.users (id, created_at)
        VALUES (${input.ownerUserId}, ${fixtureAt}), (${input.otherUserId}, ${fixtureAt})
      `;
      await transaction`
        INSERT INTO identity.external_identities (
          issuer, subject, user_id, email, created_at, last_seen_at
        ) VALUES
          (${input.issuer}, ${subjects[0]}, ${input.ownerUserId}, NULL, ${fixtureAt}, ${fixtureAt}),
          (${input.issuer}, ${subjects[1]}, ${input.otherUserId}, NULL, ${fixtureAt}, ${fixtureAt})
      `;
      const preferences = {
        targetRoles: ["Synthetic Search Fixture Alpha"],
        locations: ["Synthetic Remote"],
        workModes: ["remote"],
        employmentTypes: ["full_time"],
      };
      await transaction`
        INSERT INTO profile.job_preferences (
          id, user_id, version, preferences, created_at, updated_at
        ) VALUES (
          ${input.preferenceSetId}, ${input.ownerUserId}, 1,
          ${JSON.stringify(preferences)}::jsonb, ${fixtureAt}, ${fixtureAt}
        )
      `;
      const prepared = await ownedCounts(transaction, input);
      if (
        prepared.identityCount !== 2 ||
        prepared.preferenceCount !== 1 ||
        prepared.userCount !== 2 ||
        prepared.relatedCount !== 0
      ) {
        throw new Error("The private-feature Profile fixture was not prepared exactly");
      }
      return {
        schemaVersion: 1,
        action: "prepare",
        identityCount: 2,
        preferenceCount: 1,
        userCount: 2,
      };
    }
    if (
      before.identityCount !== 2 ||
      before.preferenceCount !== 1 ||
      before.userCount !== 2 ||
      before.relatedCount !== 0
    ) {
      throw new Error("The private-feature Profile cleanup boundary is contaminated");
    }
    const deletedPreferences = await transaction`
      DELETE FROM profile.job_preferences
      WHERE id = ${input.preferenceSetId} AND user_id = ${input.ownerUserId}
    `;
    const subjects = [
      privateFeatureAcceptanceSubject("owner", input.runId),
      privateFeatureAcceptanceSubject("other", input.runId),
    ];
    const deletedIdentities = await transaction`
      DELETE FROM identity.external_identities
      WHERE issuer = ${input.issuer}
        AND subject = ANY(${transaction.array(subjects)}::text[])
    `;
    const deletedUsers = await transaction`
      DELETE FROM identity.users
      WHERE id = ANY(${transaction.array([input.ownerUserId, input.otherUserId])}::uuid[])
    `;
    if (
      deletedPreferences.count !== 1 ||
      deletedIdentities.count !== 2 ||
      deletedUsers.count !== 2
    ) {
      throw new Error("The private-feature Profile cleanup was not exact");
    }
    const after = await ownedCounts(transaction, input);
    if (Object.values(after).some((value) => value !== 0)) {
      throw new Error("The private-feature Profile cleanup left owned rows");
    }
    return {
      schemaVersion: 1,
      action: "cleanup",
      identityCount: 0,
      preferenceCount: 0,
      userCount: 0,
    };
  });
}
