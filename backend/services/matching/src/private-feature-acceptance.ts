import type postgres from "postgres";

const CONFIRMATION = "generated-synthetic-private-feature-acceptance";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type PrivateFeatureMatchingAcceptanceAction = "prepare" | "cleanup";

export interface PrivateFeatureMatchingAcceptanceInput {
  action: PrivateFeatureMatchingAcceptanceAction;
  runId: string;
  ownerUserId: string;
  savedJobId: string;
  requestedJobId: string;
  resolvedCanonicalJobIdAtSave: string;
  companyId: string;
  companyName: string;
  verifiedDomain?: string;
  title: string;
  locations: string[];
  department?: string;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  savedAt: Date;
}

export interface PrivateFeatureMatchingAcceptanceResult {
  schemaVersion: 1;
  action: PrivateFeatureMatchingAcceptanceAction;
  savedJobCount: number;
  listStateCount: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The private-feature Matching payload is invalid");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("The private-feature Matching payload is invalid");
  }
}

function boundedString(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    throw new Error("The private-feature Matching payload is invalid");
  }
  return value;
}

function exactInstant(value: unknown): Date {
  if (typeof value !== "string" || !INSTANT_PATTERN.test(value)) {
    throw new Error("The private-feature Matching payload timestamp is invalid");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("The private-feature Matching payload timestamp is invalid");
  }
  return parsed;
}

function parsePayload(value: string): Omit<PrivateFeatureMatchingAcceptanceInput, "action"> {
  let parsed: Record<string, unknown>;
  try {
    parsed = record(JSON.parse(value));
  } catch {
    throw new Error("The private-feature Matching payload is invalid");
  }
  exactKeys(
    parsed,
    [
      "runId",
      "ownerUserId",
      "savedJobId",
      "requestedJobId",
      "resolvedCanonicalJobIdAtSave",
      "companyId",
      "companyName",
      "title",
      "locations",
      "firstObservedAt",
      "lastVerifiedAt",
      "expiresAt",
      "savedAt",
    ],
    ["verifiedDomain", "department"],
  );
  const runId = boundedString(parsed.runId, 36);
  const ownerUserId = boundedString(parsed.ownerUserId, 36);
  const savedJobId = boundedString(parsed.savedJobId, 36);
  const requestedJobId = boundedString(parsed.requestedJobId, 36);
  const resolvedCanonicalJobIdAtSave = boundedString(parsed.resolvedCanonicalJobIdAtSave, 36);
  const companyId = boundedString(parsed.companyId, 36);
  const companyName = boundedString(parsed.companyName, 200);
  const title = boundedString(parsed.title, 240);
  if (
    !RUN_ID_PATTERN.test(runId) ||
    !UUID_V7_PATTERN.test(ownerUserId) ||
    !UUID_V7_PATTERN.test(savedJobId) ||
    !UUID_PATTERN.test(requestedJobId) ||
    !UUID_PATTERN.test(resolvedCanonicalJobIdAtSave) ||
    !UUID_PATTERN.test(companyId) ||
    !Array.isArray(parsed.locations) ||
    parsed.locations.length < 1 ||
    parsed.locations.length > 20
  ) {
    throw new Error("The private-feature Matching identity boundary is invalid");
  }
  const locations = parsed.locations.map((location) => boundedString(location, 240));
  if (new Set(locations).size !== locations.length) {
    throw new Error("The private-feature Matching payload is invalid");
  }
  const verifiedDomain =
    parsed.verifiedDomain === undefined ? undefined : boundedString(parsed.verifiedDomain, 253);
  if (verifiedDomain && !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(verifiedDomain)) {
    throw new Error("The private-feature Matching payload is invalid");
  }
  const department =
    parsed.department === undefined ? undefined : boundedString(parsed.department, 200);
  const firstObservedAt = exactInstant(parsed.firstObservedAt);
  const lastVerifiedAt = exactInstant(parsed.lastVerifiedAt);
  const expiresAt = exactInstant(parsed.expiresAt);
  const savedAt = exactInstant(parsed.savedAt);
  if (firstObservedAt > lastVerifiedAt || lastVerifiedAt >= expiresAt) {
    throw new Error("The private-feature Matching snapshot chronology is invalid");
  }
  return {
    runId,
    ownerUserId,
    savedJobId,
    requestedJobId,
    resolvedCanonicalJobIdAtSave,
    companyId,
    companyName,
    ...(verifiedDomain ? { verifiedDomain } : {}),
    title,
    locations,
    ...(department ? { department } : {}),
    firstObservedAt,
    lastVerifiedAt,
    expiresAt,
    savedAt,
  };
}

export function parsePrivateFeatureMatchingAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): PrivateFeatureMatchingAcceptanceInput {
  if (environment.PRIVATE_FEATURE_ACCEPTANCE_CONFIRMATION !== CONFIRMATION) {
    throw new Error("The generated-synthetic private-feature confirmation is required");
  }
  const action = environment.PRIVATE_FEATURE_ACCEPTANCE_ACTION;
  if (action !== "prepare" && action !== "cleanup") {
    throw new Error("The private-feature Matching action is invalid");
  }
  const payload = environment.PRIVATE_FEATURE_ACCEPTANCE_PAYLOAD;
  if (!payload) throw new Error("The private-feature Matching payload is required");
  return { action, ...parsePayload(payload) };
}

export function assertRecentPrivateFeatureMatchingTime(at: Date, now = new Date()): void {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    Math.abs(now.getTime() - at.getTime()) > 15 * 60_000
  ) {
    throw new Error("The private-feature Matching timestamp is outside the bounded clock window");
  }
}

interface BoundaryCounts {
  listStateCount: number;
  savedJobCount: number;
  idempotencyCount: number;
  auditCount: number;
}

async function boundaryCounts(
  transaction: postgres.TransactionSql,
  input: PrivateFeatureMatchingAcceptanceInput,
): Promise<BoundaryCounts> {
  const [counts] = await transaction<BoundaryCounts[]>`
    SELECT
      (SELECT count(*)::int FROM matching.saved_job_list_state
        WHERE owner_user_id = ${input.ownerUserId}) AS "listStateCount",
      (SELECT count(*)::int FROM matching.saved_jobs
        WHERE owner_user_id = ${input.ownerUserId} OR id = ${input.savedJobId}) AS "savedJobCount",
      (SELECT count(*)::int FROM matching.idempotency_keys
        WHERE owner_user_id = ${input.ownerUserId} OR saved_job_id = ${input.savedJobId})
        AS "idempotencyCount",
      (SELECT count(*)::int FROM matching.audit_events
        WHERE owner_user_id = ${input.ownerUserId} OR saved_job_id = ${input.savedJobId})
        AS "auditCount"
  `;
  if (!counts) throw new Error("The private-feature Matching fixture could not be inspected");
  return counts;
}

interface FixtureRow {
  id: string;
  ownerUserId: string;
  requestedJobId: string;
  resolvedCanonicalJobIdAtSave: string;
  companyId: string;
  companyName: string;
  verifiedDomain: string | null;
  title: string;
  locations: string[];
  department: string | null;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  savedAt: Date;
  updatedAt: Date;
  revision: string;
}

async function exactFixture(
  transaction: postgres.TransactionSql,
  input: PrivateFeatureMatchingAcceptanceInput,
): Promise<boolean> {
  const [row] = await transaction<FixtureRow[]>`
    SELECT saved.id, saved.owner_user_id AS "ownerUserId",
      saved.requested_job_id AS "requestedJobId",
      saved.resolved_canonical_job_id_at_save AS "resolvedCanonicalJobIdAtSave",
      saved.snapshot_company_id AS "companyId", saved.snapshot_company_name AS "companyName",
      saved.snapshot_verified_domain AS "verifiedDomain", saved.snapshot_title AS title,
      saved.snapshot_locations AS locations, saved.snapshot_department AS department,
      saved.snapshot_first_observed_at AS "firstObservedAt",
      saved.snapshot_last_verified_at AS "lastVerifiedAt",
      saved.snapshot_expires_at AS "expiresAt", saved.saved_at AS "savedAt",
      saved.updated_at AS "updatedAt", state.revision::text AS revision
    FROM matching.saved_jobs AS saved
    INNER JOIN matching.saved_job_list_state AS state
      ON state.owner_user_id = saved.owner_user_id
    WHERE saved.owner_user_id = ${input.ownerUserId} AND saved.id = ${input.savedJobId}
  `;
  const sameTime = (actual: Date, expected: Date): boolean =>
    Number.isFinite(actual?.getTime()) && actual.getTime() === expected.getTime();
  return Boolean(
    row &&
      row.ownerUserId === input.ownerUserId &&
      row.requestedJobId === input.requestedJobId &&
      row.resolvedCanonicalJobIdAtSave === input.resolvedCanonicalJobIdAtSave &&
      row.companyId === input.companyId &&
      row.companyName === input.companyName &&
      row.verifiedDomain === (input.verifiedDomain ?? null) &&
      row.title === input.title &&
      JSON.stringify(row.locations) === JSON.stringify(input.locations) &&
      row.department === (input.department ?? null) &&
      sameTime(row.firstObservedAt, input.firstObservedAt) &&
      sameTime(row.lastVerifiedAt, input.lastVerifiedAt) &&
      sameTime(row.expiresAt, input.expiresAt) &&
      sameTime(row.savedAt, input.savedAt) &&
      sameTime(row.updatedAt, input.savedAt) &&
      row.revision === "2",
  );
}

export async function executePrivateFeatureMatchingAcceptance(
  client: postgres.Sql,
  input: PrivateFeatureMatchingAcceptanceInput,
): Promise<PrivateFeatureMatchingAcceptanceResult> {
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${`matching:private-feature-acceptance:${input.runId}`}))
    `;
    const before = await boundaryCounts(transaction, input);
    if (input.action === "prepare") {
      if (Object.values(before).some((value) => value !== 0)) {
        throw new Error("The private-feature Matching fixture already exists or is contaminated");
      }
      await transaction`
        INSERT INTO matching.saved_job_list_state (owner_user_id, revision)
        VALUES (${input.ownerUserId}, 2)
      `;
      await transaction`
        INSERT INTO matching.saved_jobs (
          id, owner_user_id, requested_job_id, resolved_canonical_job_id_at_save,
          snapshot_company_id, snapshot_company_name, snapshot_verified_domain,
          snapshot_title, snapshot_locations, snapshot_department,
          snapshot_first_observed_at, snapshot_last_verified_at, snapshot_expires_at,
          saved_at, updated_at
        ) VALUES (
          ${input.savedJobId}, ${input.ownerUserId}, ${input.requestedJobId},
          ${input.resolvedCanonicalJobIdAtSave}, ${input.companyId}, ${input.companyName},
          ${input.verifiedDomain ?? null}, ${input.title},
          ${transaction.array(input.locations)}, ${input.department ?? null},
          ${input.firstObservedAt}, ${input.lastVerifiedAt}, ${input.expiresAt},
          ${input.savedAt}, ${input.savedAt}
        )
      `;
      const after = await boundaryCounts(transaction, input);
      if (
        after.listStateCount !== 1 ||
        after.savedJobCount !== 1 ||
        after.idempotencyCount !== 0 ||
        after.auditCount !== 0 ||
        !(await exactFixture(transaction, input))
      ) {
        throw new Error("The private-feature Matching fixture was not prepared exactly");
      }
      return { schemaVersion: 1, action: "prepare", savedJobCount: 1, listStateCount: 1 };
    }
    if (
      before.listStateCount !== 1 ||
      before.savedJobCount !== 1 ||
      before.idempotencyCount !== 0 ||
      before.auditCount !== 0 ||
      !(await exactFixture(transaction, input))
    ) {
      throw new Error("The private-feature Matching cleanup boundary is contaminated");
    }
    const deletedSavedJob = await transaction`
      DELETE FROM matching.saved_jobs
      WHERE owner_user_id = ${input.ownerUserId} AND id = ${input.savedJobId}
    `;
    const deletedListState = await transaction`
      DELETE FROM matching.saved_job_list_state
      WHERE owner_user_id = ${input.ownerUserId} AND revision = 2
    `;
    const after = await boundaryCounts(transaction, input);
    if (
      deletedSavedJob.count !== 1 ||
      deletedListState.count !== 1 ||
      Object.values(after).some((value) => value !== 0)
    ) {
      throw new Error("The private-feature Matching cleanup was not exact");
    }
    return { schemaVersion: 1, action: "cleanup", savedJobCount: 0, listStateCount: 0 };
  });
}
