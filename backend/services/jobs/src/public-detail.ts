import type { ActiveJobRecord } from "./persistence/catalog.js";

const canonicalJobIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  getActiveJob(jobId: string, now: Date): Promise<ActiveJobRecord | null>;
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

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

type PublicJobProjection =
  | Readonly<{ kind: "available"; job: Readonly<PublicJobDetail> }>
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "malformed" }>;

function projectPublicJob(record: ActiveJobRecord, now: Date): PublicJobProjection {
  if (
    !isCanonicalJobId(record.id) ||
    !knownJobStatuses.has(record.status) ||
    !isBoundedText(record.company?.name, 200) ||
    !isBoundedText(record.title, 240) ||
    typeof record.description !== "string" ||
    record.description.length > 200_000 ||
    !Array.isArray(record.locations) ||
    record.locations.length === 0 ||
    record.locations.length > 20 ||
    record.locations.some((location) => !isBoundedText(location, 240)) ||
    (record.department !== undefined && !isBoundedText(record.department, 200)) ||
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
    let record: ActiveJobRecord | null;
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
