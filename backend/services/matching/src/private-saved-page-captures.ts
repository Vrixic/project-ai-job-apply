import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

export const privateCaptureProviders = ["greenhouse", "lever", "ashby"] as const;
export type PrivateCaptureProvider = (typeof privateCaptureProviders)[number];

export const privateCapturePageVariants = [
  "greenhouse-board-v1",
  "lever-posting-v1",
  "ashby-job-board-v1",
] as const;
export type PrivateCapturePageVariant = (typeof privateCapturePageVariants)[number];

export interface PrivateSavedPageCaptureInput {
  schemaVersion: 1;
  captureId: string;
  source: {
    provider: PrivateCaptureProvider;
    pageVariant: PrivateCapturePageVariant;
    sourceUrl: string;
    adapterVersion: "d2-job-page-v1";
  };
  snapshot: {
    title: string;
    company?: string;
    location?: string;
    description?: string;
    externalJobId?: string;
  };
  capturedAt: string;
}

export interface PrivateSavedPageCaptureResolution {
  resolutionId: string;
  canonicalJobId: string;
  verificationEvidenceId: string;
  resolvedAt: string;
}

export interface PrivateSavedPageCapture {
  id: string;
  ownerUserId: string;
  source: PrivateSavedPageCaptureInput["source"];
  snapshot: PrivateSavedPageCaptureInput["snapshot"];
  capturedAt: string;
  savedAt: string;
  resolution?: PrivateSavedPageCaptureResolution;
}

export interface CreatePrivateSavedPageCaptureCommand {
  ownerUserId: string;
  idempotencyKey: string;
  input: PrivateSavedPageCaptureInput;
}

export interface LinkPrivateSavedPageCaptureResolutionCommand {
  ownerUserId: string;
  captureId: string;
  canonicalJobId: string;
  verificationEvidenceId: string;
}

export interface PrivateSavedPageCaptureStore {
  create(
    command: CreatePrivateSavedPageCaptureCommand,
    occurredAt: Date,
  ): Promise<PrivateSavedPageCapture>;
  get(ownerUserId: string, captureId: string): Promise<PrivateSavedPageCapture | null>;
  delete(ownerUserId: string, captureId: string, occurredAt: Date): Promise<void>;
  linkVerifiedResolution(
    command: LinkPrivateSavedPageCaptureResolutionCommand,
    occurredAt: Date,
  ): Promise<PrivateSavedPageCapture | null>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface PrivateCaptureAccountStatus {
  isActive(ownerUserId: string): Promise<boolean>;
}

export interface PrivateCaptureResolutionVerifier {
  verify(input: {
    ownerUserId: string;
    captureId: string;
    source: PrivateSavedPageCaptureInput["source"];
    canonicalJobId: string;
    verificationEvidenceId: string;
  }): Promise<boolean>;
}

export interface PrivateSavedPageCaptures {
  create(command: CreatePrivateSavedPageCaptureCommand): Promise<PrivateSavedPageCapture>;
  get(ownerUserId: string, captureId: string): Promise<PrivateSavedPageCapture | null>;
  delete(ownerUserId: string, captureId: string): Promise<void>;
}

export class PrivateCaptureIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different private capture");
    this.name = "PrivateCaptureIdempotencyConflictError";
  }
}

export class PrivateCaptureReplayDeletedError extends Error {
  constructor() {
    super("The idempotent private capture was subsequently deleted");
    this.name = "PrivateCaptureReplayDeletedError";
  }
}

export class PrivateCaptureAlreadySavedError extends Error {
  constructor() {
    super("This source page is already privately saved for the owner");
    this.name = "PrivateCaptureAlreadySavedError";
  }
}

export class PrivateCaptureLimitError extends Error {
  constructor(maximum: number) {
    super(`A candidate can retain at most ${maximum} private page captures`);
    this.name = "PrivateCaptureLimitError";
  }
}

export class PrivateCaptureIdempotencyLimitError extends Error {
  constructor(maximum: number) {
    super(`A candidate can retain at most ${maximum} private-capture replay commands`);
    this.name = "PrivateCaptureIdempotencyLimitError";
  }
}

export class PrivateCaptureResolutionConflictError extends Error {
  constructor() {
    super("The private capture already has a different canonical resolution");
    this.name = "PrivateCaptureResolutionConflictError";
  }
}

export class PrivateCaptureResolutionNotVerifiedError extends Error {
  constructor() {
    super("Independent canonical-job verification is required");
    this.name = "PrivateCaptureResolutionNotVerifiedError";
  }
}

export class PrivateCaptureAccountInactiveError extends Error {
  constructor() {
    super("The private capture owner account is not active");
    this.name = "PrivateCaptureAccountInactiveError";
  }
}

export class PrivateCaptureUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Private saved-page capture is temporarily unavailable", { cause });
    this.name = "PrivateCaptureUnavailableError";
  }
}

export const MAX_PRIVATE_CAPTURES_PER_OWNER = 1_000;
export const MAX_PRIVATE_CAPTURE_COMMANDS_PER_OWNER = 2_000;
export const PRIVATE_CAPTURE_IDEMPOTENCY_RETENTION_HOURS = 24;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROVIDER_BOUNDARIES: Readonly<
  Record<
    PrivateCaptureProvider,
    { pageVariant: PrivateCapturePageVariant; hosts: readonly string[] }
  >
> = {
  greenhouse: {
    pageVariant: "greenhouse-board-v1",
    hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  },
  lever: {
    pageVariant: "lever-posting-v1",
    hosts: ["jobs.lever.co", "jobs.eu.lever.co"],
  },
  ashby: {
    pageVariant: "ashby-job-board-v1",
    hosts: ["jobs.ashbyhq.com"],
  },
};

function hasExactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
  );
}

function boundedText(value: unknown, maximum: number, required = false): boolean {
  if (value === undefined) return !required;
  const unsafe =
    typeof value === "string" &&
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        character === "<" ||
        character === ">" ||
        code <= 31 ||
        (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    });
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    value.normalize("NFC") === value &&
    !unsafe
  );
}

function exactTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function exactProviderUrl(source: PrivateSavedPageCaptureInput["source"]): boolean {
  try {
    const url = new URL(source.sourceUrl);
    const boundary = PROVIDER_BOUNDARIES[source.provider];
    const pathMatches =
      source.provider === "greenhouse"
        ? /^\/[A-Za-z0-9._~-]+\/jobs\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname)
        : /^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.search === "" &&
      source.sourceUrl.length <= 2_048 &&
      boundary.hosts.includes(url.hostname) &&
      source.pageVariant === boundary.pageVariant &&
      source.adapterVersion === "d2-job-page-v1" &&
      pathMatches &&
      url.toString() === source.sourceUrl
    );
  } catch {
    return false;
  }
}

function assertIdentity(value: string, label: string, versionSeven = false): void {
  if (!(versionSeven ? UUID_V7_PATTERN : UUID_PATTERN).test(value)) {
    throw new TypeError(`${label} must be a UUID${versionSeven ? "v7" : ""}`);
  }
}

function assertIdempotencyKey(value: string): void {
  if (typeof value !== "string" || value.length < 16 || value.length > 128) {
    throw new TypeError("The private-capture idempotency key is invalid");
  }
}

export function assertPrivateSavedPageCaptureInput(input: PrivateSavedPageCaptureInput): void {
  if (
    !input ||
    typeof input !== "object" ||
    !hasExactKeys(input, ["schemaVersion", "captureId", "source", "snapshot", "capturedAt"]) ||
    input.schemaVersion !== 1 ||
    !UUID_V7_PATTERN.test(input.captureId) ||
    !input.source ||
    typeof input.source !== "object" ||
    !hasExactKeys(input.source, ["provider", "pageVariant", "sourceUrl", "adapterVersion"]) ||
    !privateCaptureProviders.includes(input.source.provider) ||
    !privateCapturePageVariants.includes(input.source.pageVariant) ||
    !exactProviderUrl(input.source) ||
    !input.snapshot ||
    typeof input.snapshot !== "object" ||
    !hasExactKeys(
      input.snapshot,
      ["title"],
      ["company", "location", "description", "externalJobId"],
    ) ||
    !boundedText(input.snapshot.title, 240, true) ||
    !boundedText(input.snapshot.company, 240) ||
    !boundedText(input.snapshot.location, 500) ||
    !boundedText(input.snapshot.description, 12_000) ||
    !boundedText(input.snapshot.externalJobId, 200) ||
    !exactTimestamp(input.capturedAt)
  ) {
    throw new TypeError("The private saved-page capture is invalid");
  }
}

export function privateSavedPageCaptureDigestInput(input: PrivateSavedPageCaptureInput): string {
  assertPrivateSavedPageCaptureInput(input);
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    captureId: input.captureId,
    source: {
      provider: input.source.provider,
      pageVariant: input.source.pageVariant,
      sourceUrl: input.source.sourceUrl,
      adapterVersion: input.source.adapterVersion,
    },
    snapshot: {
      title: input.snapshot.title,
      ...(input.snapshot.company === undefined ? {} : { company: input.snapshot.company }),
      ...(input.snapshot.location === undefined ? {} : { location: input.snapshot.location }),
      ...(input.snapshot.description === undefined
        ? {}
        : { description: input.snapshot.description }),
      ...(input.snapshot.externalJobId === undefined
        ? {}
        : { externalJobId: input.snapshot.externalJobId }),
    },
    capturedAt: input.capturedAt,
  });
}

function requestHash(input: PrivateSavedPageCaptureInput): string {
  return createHash("sha256").update(privateSavedPageCaptureDigestInput(input)).digest("hex");
}

export class PrivateSavedPageCapturesService implements PrivateSavedPageCaptures {
  constructor(
    private readonly store: PrivateSavedPageCaptureStore,
    private readonly accounts: PrivateCaptureAccountStatus = {
      async isActive() {
        return false;
      },
    },
    private readonly resolutionVerifier: PrivateCaptureResolutionVerifier = {
      async verify() {
        return false;
      },
    },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private timestamp(): Date {
    const value = this.clock();
    if (!Number.isFinite(value.getTime())) throw new Error("The private-capture clock is invalid");
    return new Date(value.getTime());
  }

  private async assertActive(ownerUserId: string): Promise<void> {
    assertIdentity(ownerUserId, "The owner identifier", true);
    let active = false;
    try {
      active = await this.accounts.isActive(ownerUserId);
    } catch (error) {
      throw new PrivateCaptureUnavailableError(error);
    }
    if (!active) throw new PrivateCaptureAccountInactiveError();
  }

  async create(command: CreatePrivateSavedPageCaptureCommand): Promise<PrivateSavedPageCapture> {
    assertIdempotencyKey(command.idempotencyKey);
    assertPrivateSavedPageCaptureInput(command.input);
    await this.assertActive(command.ownerUserId);
    const occurredAt = this.timestamp();
    if (Date.parse(command.input.capturedAt) > occurredAt.getTime() + 5 * 60 * 1_000) {
      throw new TypeError("The private capture timestamp is too far in the future");
    }
    try {
      return await this.store.create(command, occurredAt);
    } catch (error) {
      if (
        error instanceof PrivateCaptureIdempotencyConflictError ||
        error instanceof PrivateCaptureReplayDeletedError ||
        error instanceof PrivateCaptureAlreadySavedError ||
        error instanceof PrivateCaptureLimitError ||
        error instanceof PrivateCaptureIdempotencyLimitError
      ) {
        throw error;
      }
      throw new PrivateCaptureUnavailableError(error);
    }
  }

  async get(ownerUserId: string, captureId: string): Promise<PrivateSavedPageCapture | null> {
    assertIdentity(captureId, "The capture identifier", true);
    await this.assertActive(ownerUserId);
    try {
      return await this.store.get(ownerUserId, captureId);
    } catch (error) {
      throw new PrivateCaptureUnavailableError(error);
    }
  }

  async delete(ownerUserId: string, captureId: string): Promise<void> {
    assertIdentity(captureId, "The capture identifier", true);
    await this.assertActive(ownerUserId);
    try {
      await this.store.delete(ownerUserId, captureId, this.timestamp());
    } catch (error) {
      throw new PrivateCaptureUnavailableError(error);
    }
  }

  async linkVerifiedResolution(
    command: LinkPrivateSavedPageCaptureResolutionCommand,
  ): Promise<PrivateSavedPageCapture | null> {
    assertIdentity(command.captureId, "The capture identifier", true);
    assertIdentity(command.canonicalJobId, "The canonical job identifier");
    assertIdentity(command.verificationEvidenceId, "The verification evidence identifier");
    await this.assertActive(command.ownerUserId);
    let capture: PrivateSavedPageCapture | null;
    try {
      capture = await this.store.get(command.ownerUserId, command.captureId);
    } catch (error) {
      throw new PrivateCaptureUnavailableError(error);
    }
    if (!capture) return null;
    let verified = false;
    try {
      verified = await this.resolutionVerifier.verify({
        ownerUserId: command.ownerUserId,
        captureId: command.captureId,
        source: capture.source,
        canonicalJobId: command.canonicalJobId,
        verificationEvidenceId: command.verificationEvidenceId,
      });
    } catch (error) {
      throw new PrivateCaptureUnavailableError(error);
    }
    if (!verified) throw new PrivateCaptureResolutionNotVerifiedError();
    try {
      return await this.store.linkVerifiedResolution(command, this.timestamp());
    } catch (error) {
      if (error instanceof PrivateCaptureResolutionConflictError) throw error;
      throw new PrivateCaptureUnavailableError(error);
    }
  }
}

interface PrivateCaptureRow {
  id: string;
  ownerUserId: string;
  requestHash: string;
  provider: PrivateCaptureProvider;
  pageVariant: PrivateCapturePageVariant;
  sourceUrl: string;
  adapterVersion: "d2-job-page-v1";
  snapshotTitle: string;
  snapshotCompany: string | null;
  snapshotLocation: string | null;
  snapshotDescription: string | null;
  snapshotExternalJobId: string | null;
  capturedAt: Date;
  savedAt: Date;
  resolutionId: string | null;
  canonicalJobId: string | null;
  verificationEvidenceId: string | null;
  resolvedAt: Date | null;
}

interface PrivateCaptureCommandRow extends PrivateCaptureRow {
  commandRequestHash: string;
  commandCaptureId: string;
}

function captureFromRow(row: PrivateCaptureRow): PrivateSavedPageCapture {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    source: {
      provider: row.provider,
      pageVariant: row.pageVariant,
      sourceUrl: row.sourceUrl,
      adapterVersion: row.adapterVersion,
    },
    snapshot: {
      title: row.snapshotTitle,
      ...(row.snapshotCompany === null ? {} : { company: row.snapshotCompany }),
      ...(row.snapshotLocation === null ? {} : { location: row.snapshotLocation }),
      ...(row.snapshotDescription === null ? {} : { description: row.snapshotDescription }),
      ...(row.snapshotExternalJobId === null ? {} : { externalJobId: row.snapshotExternalJobId }),
    },
    capturedAt: new Date(row.capturedAt).toISOString(),
    savedAt: new Date(row.savedAt).toISOString(),
    ...(row.resolutionId && row.canonicalJobId && row.verificationEvidenceId && row.resolvedAt
      ? {
          resolution: {
            resolutionId: row.resolutionId,
            canonicalJobId: row.canonicalJobId,
            verificationEvidenceId: row.verificationEvidenceId,
            resolvedAt: new Date(row.resolvedAt).toISOString(),
          },
        }
      : {}),
  };
}

const SELECT_PRIVATE_CAPTURE = `
  SELECT c.id, c.owner_user_id AS "ownerUserId", c.request_hash AS "requestHash",
    c.provider, c.page_variant AS "pageVariant", c.source_url AS "sourceUrl",
    c.adapter_version AS "adapterVersion", c.snapshot_title AS "snapshotTitle",
    c.snapshot_company AS "snapshotCompany", c.snapshot_location AS "snapshotLocation",
    c.snapshot_description AS "snapshotDescription",
    c.snapshot_external_job_id AS "snapshotExternalJobId",
    c.captured_at AS "capturedAt", c.saved_at AS "savedAt",
    r.resolution_id AS "resolutionId", r.canonical_job_id AS "canonicalJobId",
    r.verification_evidence_id AS "verificationEvidenceId", r.resolved_at AS "resolvedAt"
  FROM matching.private_saved_page_captures c
  LEFT JOIN matching.private_saved_page_capture_resolutions r ON r.capture_id = c.id
`;

export class PostgresPrivateSavedPageCaptureStore implements PrivateSavedPageCaptureStore {
  private readonly maximumCaptures: number;
  private readonly maximumCommands: number;

  constructor(
    private readonly client: postgres.Sql,
    limits: { maximumCaptures?: number; maximumCommands?: number } = {},
  ) {
    this.maximumCaptures = limits.maximumCaptures ?? MAX_PRIVATE_CAPTURES_PER_OWNER;
    this.maximumCommands = limits.maximumCommands ?? MAX_PRIVATE_CAPTURE_COMMANDS_PER_OWNER;
    if (
      !Number.isInteger(this.maximumCaptures) ||
      this.maximumCaptures < 1 ||
      this.maximumCaptures > MAX_PRIVATE_CAPTURES_PER_OWNER ||
      !Number.isInteger(this.maximumCommands) ||
      this.maximumCommands < 1 ||
      this.maximumCommands > MAX_PRIVATE_CAPTURE_COMMANDS_PER_OWNER
    ) {
      throw new TypeError("Private capture persistence limits are invalid");
    }
  }

  async create(
    command: CreatePrivateSavedPageCaptureCommand,
    occurredAt: Date,
  ): Promise<PrivateSavedPageCapture> {
    assertIdentity(command.ownerUserId, "The owner identifier", true);
    assertIdempotencyKey(command.idempotencyKey);
    assertPrivateSavedPageCaptureInput(command.input);
    if (!Number.isFinite(occurredAt.getTime())) throw new TypeError("The capture clock is invalid");
    const digest = requestHash(command.input);
    const timestamp = occurredAt.toISOString();
    const expiresAt = new Date(
      occurredAt.getTime() + PRIVATE_CAPTURE_IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1_000,
    ).toISOString();
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`matching:private-capture:${command.ownerUserId}`}))`;
      const commandRows = await transaction.unsafe<PrivateCaptureCommandRow[]>(
        `SELECT k.request_hash AS "commandRequestHash", k.capture_id AS "commandCaptureId",
          captured.*
        FROM matching.private_saved_page_capture_commands k
        LEFT JOIN LATERAL (
          ${SELECT_PRIVATE_CAPTURE}
          WHERE c.owner_user_id = k.owner_user_id AND c.id = k.capture_id
        ) captured ON true
        WHERE k.owner_user_id = $1::uuid AND k.idempotency_key = $2::text
          AND k.idempotency_expires_at > $3::timestamptz`,
        [command.ownerUserId, command.idempotencyKey, timestamp],
      );
      const replay = commandRows[0];
      if (replay) {
        if (replay.commandRequestHash !== digest)
          throw new PrivateCaptureIdempotencyConflictError();
        if (!replay.id) throw new PrivateCaptureReplayDeletedError();
        return captureFromRow(replay);
      }
      await transaction`
        DELETE FROM matching.private_saved_page_capture_commands
        WHERE owner_user_id = ${command.ownerUserId}::uuid
          AND idempotency_expires_at <= ${timestamp}::timestamptz
      `;
      const [commandUsage] = await transaction<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM matching.private_saved_page_capture_commands
        WHERE owner_user_id = ${command.ownerUserId}::uuid
      `;
      if (Number(commandUsage?.count ?? 0) >= this.maximumCommands) {
        throw new PrivateCaptureIdempotencyLimitError(this.maximumCommands);
      }
      const existingByIdentity = await transaction.unsafe<PrivateCaptureRow[]>(
        `${SELECT_PRIVATE_CAPTURE}
         WHERE c.owner_user_id = $1::uuid AND c.id = $2::uuid`,
        [command.ownerUserId, command.input.captureId],
      );
      let created = existingByIdentity[0];
      if (created && created.requestHash !== digest) {
        throw new PrivateCaptureIdempotencyConflictError();
      }
      if (!created) {
        const existingSource = await transaction<{ id: string }[]>`
          SELECT id FROM matching.private_saved_page_captures
          WHERE owner_user_id = ${command.ownerUserId}::uuid
            AND provider = ${command.input.source.provider}
            AND page_variant = ${command.input.source.pageVariant}
            AND source_url = ${command.input.source.sourceUrl}
        `;
        if (existingSource[0]) throw new PrivateCaptureAlreadySavedError();
        const [captureUsage] = await transaction<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM matching.private_saved_page_captures
          WHERE owner_user_id = ${command.ownerUserId}::uuid
        `;
        if (Number(captureUsage?.count ?? 0) >= this.maximumCaptures) {
          throw new PrivateCaptureLimitError(this.maximumCaptures);
        }
        const inserted = await transaction<PrivateCaptureRow[]>`
          INSERT INTO matching.private_saved_page_captures (
            id, owner_user_id, request_hash, provider, page_variant, source_url,
            adapter_version, snapshot_title, snapshot_company, snapshot_location,
            snapshot_description, snapshot_external_job_id, captured_at, saved_at
          ) VALUES (
            ${command.input.captureId}, ${command.ownerUserId}, ${digest},
            ${command.input.source.provider}, ${command.input.source.pageVariant},
            ${command.input.source.sourceUrl}, ${command.input.source.adapterVersion},
            ${command.input.snapshot.title}, ${command.input.snapshot.company ?? null},
            ${command.input.snapshot.location ?? null},
            ${command.input.snapshot.description ?? null},
            ${command.input.snapshot.externalJobId ?? null},
            ${command.input.capturedAt}::timestamptz, ${timestamp}::timestamptz
          )
          RETURNING id, owner_user_id AS "ownerUserId", request_hash AS "requestHash",
            provider, page_variant AS "pageVariant", source_url AS "sourceUrl",
            adapter_version AS "adapterVersion", snapshot_title AS "snapshotTitle",
            snapshot_company AS "snapshotCompany", snapshot_location AS "snapshotLocation",
            snapshot_description AS "snapshotDescription",
            snapshot_external_job_id AS "snapshotExternalJobId",
            captured_at AS "capturedAt", saved_at AS "savedAt",
            NULL::uuid AS "resolutionId", NULL::uuid AS "canonicalJobId",
            NULL::uuid AS "verificationEvidenceId", NULL::timestamptz AS "resolvedAt"
        `;
        created = inserted[0];
        if (!created) throw new Error("Private capture insert returned no row");
        await transaction`
          INSERT INTO matching.private_saved_page_capture_audit_events (
            id, owner_user_id, capture_id, action, occurred_at
          ) VALUES (
            ${uuidv7()}, ${command.ownerUserId}, ${command.input.captureId}, 'created',
            ${timestamp}::timestamptz
          )
        `;
      }
      await transaction`
        INSERT INTO matching.private_saved_page_capture_commands (
          owner_user_id, idempotency_key, request_hash, capture_id,
          created_at, idempotency_expires_at
        ) VALUES (
          ${command.ownerUserId}, ${command.idempotencyKey}, ${digest},
          ${command.input.captureId}, ${timestamp}::timestamptz, ${expiresAt}::timestamptz
        )
      `;
      return captureFromRow(created);
    });
  }

  async get(ownerUserId: string, captureId: string): Promise<PrivateSavedPageCapture | null> {
    assertIdentity(ownerUserId, "The owner identifier", true);
    assertIdentity(captureId, "The capture identifier", true);
    const rows = await this.client.unsafe<PrivateCaptureRow[]>(
      `${SELECT_PRIVATE_CAPTURE}
       WHERE c.owner_user_id = $1::uuid AND c.id = $2::uuid`,
      [ownerUserId, captureId],
    );
    return rows[0] ? captureFromRow(rows[0]) : null;
  }

  async delete(ownerUserId: string, captureId: string, occurredAt: Date): Promise<void> {
    assertIdentity(ownerUserId, "The owner identifier", true);
    assertIdentity(captureId, "The capture identifier", true);
    if (!Number.isFinite(occurredAt.getTime())) throw new TypeError("The capture clock is invalid");
    await this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`matching:private-capture:${ownerUserId}`}))`;
      const deleted = await transaction<{ id: string }[]>`
        DELETE FROM matching.private_saved_page_captures
        WHERE owner_user_id = ${ownerUserId}::uuid AND id = ${captureId}::uuid
        RETURNING id
      `;
      if (deleted[0]) {
        await transaction`
          INSERT INTO matching.private_saved_page_capture_audit_events (
            id, owner_user_id, capture_id, action, occurred_at
          ) VALUES (
            ${uuidv7()}, ${ownerUserId}, ${captureId}, 'deleted',
            ${occurredAt.toISOString()}::timestamptz
          )
        `;
      }
    });
  }

  async linkVerifiedResolution(
    command: LinkPrivateSavedPageCaptureResolutionCommand,
    occurredAt: Date,
  ): Promise<PrivateSavedPageCapture | null> {
    assertIdentity(command.ownerUserId, "The owner identifier", true);
    assertIdentity(command.captureId, "The capture identifier", true);
    assertIdentity(command.canonicalJobId, "The canonical job identifier");
    assertIdentity(command.verificationEvidenceId, "The verification evidence identifier");
    if (!Number.isFinite(occurredAt.getTime())) throw new TypeError("The capture clock is invalid");
    return this.client.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`matching:private-capture:${command.ownerUserId}`}))`;
      const currentRows = await transaction.unsafe<PrivateCaptureRow[]>(
        `${SELECT_PRIVATE_CAPTURE}
         WHERE c.owner_user_id = $1::uuid AND c.id = $2::uuid`,
        [command.ownerUserId, command.captureId],
      );
      const current = currentRows[0];
      if (!current) return null;
      if (current.resolutionId) {
        if (
          current.canonicalJobId !== command.canonicalJobId ||
          current.verificationEvidenceId !== command.verificationEvidenceId
        ) {
          throw new PrivateCaptureResolutionConflictError();
        }
        return captureFromRow(current);
      }
      const resolutionId = uuidv7();
      const resolvedAt = occurredAt.toISOString();
      await transaction`
        INSERT INTO matching.private_saved_page_capture_resolutions (
          capture_id, owner_user_id, resolution_id, canonical_job_id,
          verification_evidence_id, resolved_at
        ) VALUES (
          ${command.captureId}, ${command.ownerUserId}, ${resolutionId},
          ${command.canonicalJobId}, ${command.verificationEvidenceId},
          ${resolvedAt}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO matching.private_saved_page_capture_audit_events (
          id, owner_user_id, capture_id, action, canonical_job_id,
          verification_evidence_id, occurred_at
        ) VALUES (
          ${uuidv7()}, ${command.ownerUserId}, ${command.captureId}, 'resolved',
          ${command.canonicalJobId}, ${command.verificationEvidenceId},
          ${resolvedAt}::timestamptz
        )
      `;
      return captureFromRow({
        ...current,
        resolutionId,
        canonicalJobId: command.canonicalJobId,
        verificationEvidenceId: command.verificationEvidenceId,
        resolvedAt: new Date(resolvedAt),
      });
    });
  }

  async ping(): Promise<void> {
    const [result] = await this.client<{ present: boolean }[]>`
      SELECT to_regclass('matching.private_saved_page_captures') IS NOT NULL AS present
    `;
    if (!result?.present) throw new Error("Private saved-page capture schema is unavailable");
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
