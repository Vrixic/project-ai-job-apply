import type postgres from "postgres";

const canonicalJobIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const knownJobStatuses = new Set([
  "pending",
  "active",
  "suspect_stale",
  "expired",
  "withdrawn",
  "blocked",
]);

const absentPublicJobDetail = Object.freeze({ kind: "absent" as const });

export interface PublicJobDetailReader {
  getActiveJob(jobId: string, now: Date): Promise<PublicJobSourceRecord | null>;
}

export interface PublicJobSourceRecord {
  id: string;
  company: Readonly<{ name: string }>;
  title: string;
  locations: readonly string[];
  department?: string;
  description?: string;
  status: string;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  validThrough?: Date;
}

export interface PublicJobDetail {
  id: string;
  companyName: string;
  title: string;
  locations: readonly string[];
  department?: string;
  description: string;
  firstObservedAt: string;
  lastVerifiedAt: string;
  expiresAt: string;
  validThrough?: string;
}

export type PublicJobDetailResult =
  | typeof absentPublicJobDetail
  | Readonly<{
      kind: "available";
      requestedJobId: string;
      canonicalJobId: string;
      isAlias: boolean;
      job: Readonly<PublicJobDetail>;
    }>;

export class PublicJobDetailUnavailableError extends Error {
  constructor() {
    super("Public job detail is unavailable");
    this.name = "PublicJobDetailUnavailableError";
  }
}

function isCanonicalJobId(value: unknown): value is string {
  return typeof value === "string" && canonicalJobIdPattern.test(value);
}

function isWithinCodePointLimit(value: string, maximumLength: number): boolean {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximumLength) return false;
  }
  return true;
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    isWithinCodePointLimit(value, maximumLength)
  );
}

function isSafeDisplayText(value: unknown, maximumLength: number): value is string {
  return isBoundedText(value, maximumLength) && !hasUnsafeControlCharacter(value, false);
}

function hasUnsafeControlCharacter(value: string, allowPlainTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (
      (code < 0x20 && !(allowPlainTextWhitespace && [0x09, 0x0a, 0x0d].includes(code))) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x00ad ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff ||
      code === 0xe0001 ||
      (code >= 0xe0020 && code <= 0xe007f)
    ) {
      return true;
    }
  }
  return false;
}

function isValidDate(value: unknown): value is Date {
  return (
    value instanceof Date &&
    Number.isFinite(value.getTime()) &&
    canonicalInstantPattern.test(value.toISOString())
  );
}

type PublicJobProjection =
  | Readonly<{ kind: "available"; job: Readonly<PublicJobDetail> }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "malformed" }>;

function projectPublicJob(record: PublicJobSourceRecord, now: Date): PublicJobProjection {
  if (
    !isCanonicalJobId(record.id) ||
    !knownJobStatuses.has(record.status) ||
    !isSafeDisplayText(record.company?.name, 200) ||
    !isSafeDisplayText(record.title, 240) ||
    typeof record.description !== "string" ||
    !isWithinCodePointLimit(record.description, 200_000) ||
    hasUnsafeControlCharacter(record.description, true) ||
    !Array.isArray(record.locations) ||
    record.locations.length === 0 ||
    record.locations.length > 20 ||
    record.locations.some((location) => !isSafeDisplayText(location, 240)) ||
    (record.department !== undefined && !isSafeDisplayText(record.department, 200)) ||
    !isValidDate(record.firstObservedAt) ||
    !isValidDate(record.lastVerifiedAt) ||
    !isValidDate(record.expiresAt) ||
    (record.validThrough !== undefined && !isValidDate(record.validThrough))
  ) {
    return { kind: "malformed" };
  }

  const nowTime = now.getTime();
  const firstObservedTime = record.firstObservedAt.getTime();
  const lastVerifiedTime = record.lastVerifiedAt.getTime();
  const expiresTime = record.expiresAt.getTime();
  const validThroughTime = record.validThrough?.getTime();
  if (
    firstObservedTime > lastVerifiedTime ||
    lastVerifiedTime > nowTime ||
    expiresTime < lastVerifiedTime ||
    (validThroughTime !== undefined &&
      (validThroughTime < firstObservedTime || validThroughTime > expiresTime))
  ) {
    return { kind: "malformed" };
  }
  if (
    record.status !== "active" ||
    record.description.trim().length === 0 ||
    expiresTime <= nowTime ||
    (validThroughTime !== undefined && validThroughTime <= nowTime)
  ) {
    return { kind: "absent" };
  }

  const locations = Object.freeze([...record.locations]);
  return Object.freeze({
    kind: "available" as const,
    job: Object.freeze({
      id: record.id,
      companyName: record.company.name,
      title: record.title,
      locations,
      ...(record.department === undefined ? {} : { department: record.department }),
      description: record.description,
      firstObservedAt: record.firstObservedAt.toISOString(),
      lastVerifiedAt: record.lastVerifiedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      ...(record.validThrough === undefined
        ? {}
        : { validThrough: record.validThrough.toISOString() }),
    }),
  });
}

interface PublicJobDetailRow {
  id: string;
  companyName: string;
  title: string;
  locations: string[];
  department: string | null;
  description: string;
  status: string;
  firstObservedAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
  validThrough: Date | null;
}

export class PostgresPublicJobDetailReader implements PublicJobDetailReader {
  constructor(private readonly client: postgres.Sql) {}

  async getActiveJob(jobId: string, _now: Date): Promise<PublicJobSourceRecord | null> {
    const rows = await this.client<PublicJobDetailRow[]>`
      SELECT
        id,
        company_name AS "companyName",
        title,
        locations,
        department,
        description,
        status,
        first_observed_at AS "firstObservedAt",
        last_verified_at AS "lastVerifiedAt",
        expires_at AS "expiresAt",
        valid_through AS "validThrough"
      FROM jobs_public.read_public_job_detail(${jobId}::uuid)
    `;
    if (rows.length > 1) {
      throw new Error("Public job detail projection returned an ambiguous result");
    }
    const [row] = rows;
    if (!row) return null;
    return {
      id: row.id,
      company: { name: row.companyName },
      title: row.title,
      locations: row.locations,
      ...(row.department === null ? {} : { department: row.department }),
      description: row.description,
      status: row.status,
      firstObservedAt: row.firstObservedAt,
      lastVerifiedAt: row.lastVerifiedAt,
      expiresAt: row.expiresAt,
      ...(row.validThrough === null ? {} : { validThrough: row.validThrough }),
    };
  }
}

export class PublicJobDetailProjector {
  constructor(
    private readonly reader: PublicJobDetailReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async get(requestedJobId: string): Promise<PublicJobDetailResult> {
    if (!isCanonicalJobId(requestedJobId)) {
      return absentPublicJobDetail;
    }

    const now = this.clock();
    if (!isValidDate(now)) {
      throw new PublicJobDetailUnavailableError();
    }

    const activeAt = new Date(now);
    let record: PublicJobSourceRecord | null;
    try {
      record = await this.reader.getActiveJob(requestedJobId, new Date(activeAt));
    } catch {
      throw new PublicJobDetailUnavailableError();
    }
    if (record === null) {
      return absentPublicJobDetail;
    }

    const projection = projectPublicJob(record, activeAt);
    if (projection.kind === "absent") {
      return absentPublicJobDetail;
    }
    if (projection.kind === "malformed") {
      throw new PublicJobDetailUnavailableError();
    }

    return Object.freeze({
      kind: "available",
      requestedJobId,
      canonicalJobId: projection.job.id,
      isAlias: requestedJobId !== projection.job.id,
      job: projection.job,
    });
  }
}
