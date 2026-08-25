import type postgres from "postgres";

const canonicalJobIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const publicJobSitemapPageSize = 100;
const publicJobSitemapQueryLimit = publicJobSitemapPageSize + 1;

export interface PublicJobSitemapCursor {
  lastModifiedAt: string;
  jobId: string;
}

export interface PublicJobSitemapSourceRow {
  jobId: string;
  lastModifiedAt: Date;
}

export interface PublicJobSitemapReader {
  listActiveJobs(
    cursor: Readonly<PublicJobSitemapCursor> | undefined,
    limit: number,
  ): Promise<readonly PublicJobSitemapSourceRow[]>;
}

export interface PublicJobSitemapItem {
  jobId: string;
  lastModifiedAt: string;
}

export interface PublicJobSitemapProjectionPage {
  kind: "page";
  items: readonly Readonly<PublicJobSitemapItem>[];
  hasMore: boolean;
}

export class PublicJobSitemapUnavailableError extends Error {
  constructor() {
    super("Public job sitemap is unavailable");
    this.name = "PublicJobSitemapUnavailableError";
  }
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || !canonicalInstantPattern.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validCursor(value: Readonly<PublicJobSitemapCursor> | undefined) {
  return (
    value === undefined ||
    (canonicalJobIdPattern.test(value.jobId) && canonicalInstant(value.lastModifiedAt))
  );
}

function compareItems(left: PublicJobSitemapItem, right: PublicJobSitemapItem) {
  const freshness = right.lastModifiedAt.localeCompare(left.lastModifiedAt);
  return freshness === 0 ? left.jobId.localeCompare(right.jobId) : freshness;
}

export class PostgresPublicJobSitemapReader implements PublicJobSitemapReader {
  constructor(private readonly client: postgres.Sql) {}

  async listActiveJobs(
    cursor: Readonly<PublicJobSitemapCursor> | undefined,
    limit: number,
  ): Promise<readonly PublicJobSitemapSourceRow[]> {
    return this.client<PublicJobSitemapSourceRow[]>`
      SELECT
        job_id AS "jobId",
        last_modified_at AS "lastModifiedAt"
      FROM jobs_public.read_public_job_sitemap(
        ${cursor?.lastModifiedAt ?? null}::timestamptz,
        ${cursor?.jobId ?? null}::uuid,
        ${limit}::integer
      )
    `;
  }
}

export class PublicJobSitemapProjector {
  constructor(
    private readonly reader: PublicJobSitemapReader,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(
    cursor?: Readonly<PublicJobSitemapCursor>,
  ): Promise<Readonly<PublicJobSitemapProjectionPage>> {
    if (!validCursor(cursor)) throw new PublicJobSitemapUnavailableError();
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new PublicJobSitemapUnavailableError();
    }
    if (cursor && Date.parse(cursor.lastModifiedAt) > now.getTime()) {
      throw new PublicJobSitemapUnavailableError();
    }

    let rows: readonly PublicJobSitemapSourceRow[];
    try {
      rows = await this.reader.listActiveJobs(
        cursor === undefined ? undefined : Object.freeze({ ...cursor }),
        publicJobSitemapQueryLimit,
      );
    } catch {
      throw new PublicJobSitemapUnavailableError();
    }
    if (!Array.isArray(rows) || rows.length > publicJobSitemapQueryLimit) {
      throw new PublicJobSitemapUnavailableError();
    }

    const seen = new Set<string>();
    const items = rows.map((row) => {
      if (
        !row ||
        typeof row !== "object" ||
        !canonicalJobIdPattern.test(row.jobId) ||
        !(row.lastModifiedAt instanceof Date) ||
        !Number.isFinite(row.lastModifiedAt.getTime())
      ) {
        throw new PublicJobSitemapUnavailableError();
      }
      const lastModifiedAt = row.lastModifiedAt.toISOString();
      if (
        !canonicalInstant(lastModifiedAt) ||
        row.lastModifiedAt.getTime() > now.getTime() ||
        seen.has(row.jobId)
      ) {
        throw new PublicJobSitemapUnavailableError();
      }
      seen.add(row.jobId);
      return Object.freeze({ jobId: row.jobId, lastModifiedAt });
    });
    for (let index = 1; index < items.length; index += 1) {
      if (
        compareItems(
          items[index - 1] as PublicJobSitemapItem,
          items[index] as PublicJobSitemapItem,
        ) >= 0
      ) {
        throw new PublicJobSitemapUnavailableError();
      }
    }
    if (cursor && items[0] && compareItems(cursor, items[0]) >= 0) {
      throw new PublicJobSitemapUnavailableError();
    }

    const pageItems = items.slice(0, publicJobSitemapPageSize);
    return Object.freeze({
      kind: "page",
      items: Object.freeze(pageItems),
      hasMore: items.length > publicJobSitemapPageSize,
    });
  }
}
