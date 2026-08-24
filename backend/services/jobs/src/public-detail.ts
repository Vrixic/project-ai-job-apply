import type postgres from "postgres";
import type {
  JobEmploymentType,
  JobStructuredLocation,
  JobWorkMode,
} from "./domain/canonical-job.js";

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
  workMode?: JobWorkMode;
  employmentType?: JobEmploymentType;
  datePosted?: Date;
  applicationUrl?: string;
  structuredLocations?: readonly JobStructuredLocation[];
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
  workMode?: JobWorkMode;
  employmentType?: JobEmploymentType;
  datePosted?: string;
  applicationUrl?: string;
  structuredLocations?: readonly JobStructuredLocation[];
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

function isSafeApplicationUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.toString() === value
    );
  } catch {
    return false;
  }
}

function isStructuredLocations(value: unknown): value is readonly JobStructuredLocation[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 20 &&
    value.every((location) => {
      if (!location || typeof location !== "object" || Array.isArray(location)) return false;
      const locationRecord = location as Record<string, unknown>;
      if (Object.keys(locationRecord).length !== 1) return false;
      const address = locationRecord.address;
      if (!address || typeof address !== "object" || Array.isArray(address)) return false;
      const addressRecord = address as Record<string, unknown>;
      if (
        Object.keys(addressRecord).some(
          (key) => !["addressCountry", "addressLocality", "addressRegion"].includes(key),
        ) ||
        !isSafeDisplayText(addressRecord.addressCountry, 100) ||
        (addressRecord.addressLocality !== undefined &&
          !isSafeDisplayText(addressRecord.addressLocality, 200)) ||
        (addressRecord.addressRegion !== undefined &&
          !isSafeDisplayText(addressRecord.addressRegion, 200))
      ) {
        return false;
      }
      return true;
    })
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
    (record.validThrough !== undefined && !isValidDate(record.validThrough)) ||
    (record.datePosted !== undefined && !isValidDate(record.datePosted)) ||
    (record.applicationUrl !== undefined && !isSafeApplicationUrl(record.applicationUrl)) ||
    (record.structuredLocations !== undefined &&
      !isStructuredLocations(record.structuredLocations)) ||
    (record.workMode !== undefined &&
      !["remote", "hybrid", "on_site", "unknown"].includes(record.workMode)) ||
    (record.employmentType !== undefined &&
      !["full_time", "part_time", "contract", "internship", "unknown"].includes(
        record.employmentType,
      ))
  ) {
    return { kind: "malformed" };
  }

  const nowTime = now.getTime();
  const firstObservedTime = record.firstObservedAt.getTime();
  const lastVerifiedTime = record.lastVerifiedAt.getTime();
  const expiresTime = record.expiresAt.getTime();
  const validThroughTime = record.validThrough?.getTime();
  const datePostedTime = record.datePosted?.getTime();
  if (
    firstObservedTime > lastVerifiedTime ||
    lastVerifiedTime > nowTime ||
    expiresTime < lastVerifiedTime ||
    (validThroughTime !== undefined &&
      (validThroughTime < firstObservedTime || validThroughTime > expiresTime)) ||
    (datePostedTime !== undefined && datePostedTime > firstObservedTime)
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
  const structuredLocations = record.structuredLocations?.map((location) =>
    Object.freeze({ address: Object.freeze({ ...location.address }) }),
  );
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
      ...(record.workMode === undefined ? {} : { workMode: record.workMode }),
      ...(record.employmentType === undefined ? {} : { employmentType: record.employmentType }),
      ...(record.datePosted === undefined ? {} : { datePosted: record.datePosted.toISOString() }),
      ...(record.applicationUrl === undefined ? {} : { applicationUrl: record.applicationUrl }),
      ...(structuredLocations === undefined
        ? {}
        : { structuredLocations: Object.freeze(structuredLocations) }),
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
  workMode: JobWorkMode | null;
  employmentType: JobEmploymentType | null;
  datePosted: Date | null;
  applicationUrl: string | null;
  structuredLocations: JobStructuredLocation[] | null;
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
        valid_through AS "validThrough",
        work_mode AS "workMode",
        employment_type AS "employmentType",
        date_posted AS "datePosted",
        application_url AS "applicationUrl",
        structured_locations AS "structuredLocations"
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
      ...(row.workMode === null ? {} : { workMode: row.workMode }),
      ...(row.employmentType === null ? {} : { employmentType: row.employmentType }),
      ...(row.datePosted === null ? {} : { datePosted: row.datePosted }),
      ...(row.applicationUrl === null ? {} : { applicationUrl: row.applicationUrl }),
      ...(row.structuredLocations === null ? {} : { structuredLocations: row.structuredLocations }),
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
