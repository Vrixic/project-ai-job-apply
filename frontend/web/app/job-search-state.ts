import type {
  CanonicalJobSummary,
  JobSearchPage,
  JobSearchRequest,
} from "@ai-job-apply/api-contracts";

export interface JobSearchFields {
  query: string;
  title: string;
  company: string;
  location: string;
  verifiedWithinDays: string;
  sort: "relevance" | "freshness";
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildJobSearchRequest(fields: JobSearchFields, cursor?: string): JobSearchRequest {
  const query = optionalText(fields.query);
  const title = optionalText(fields.title);
  const company = optionalText(fields.company);
  const location = optionalText(fields.location);
  const verifiedWithinDays = optionalText(fields.verifiedWithinDays);
  const filters = {
    ...(title ? { title } : {}),
    ...(company ? { company } : {}),
    ...(location ? { location } : {}),
    ...(verifiedWithinDays ? { verifiedWithinDays: Number(verifiedWithinDays) } : {}),
  };

  return {
    ...(query ? { query } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    sort: fields.sort,
    pageSize: 10,
    ...(cursor ? { cursor } : {}),
  };
}

export function appendJobSearchPage(
  current: readonly CanonicalJobSummary[],
  page: JobSearchPage,
): CanonicalJobSummary[] {
  const known = new Set(current.map((job) => job.id));
  return [...current, ...page.items.filter((job) => !known.has(job.id))];
}

export function jobSearchFailureAction(
  status: number,
  code: string | undefined,
  continuation: boolean,
): "error" | "restart" {
  return status === 409 && code === "job_search_catalog_changed" && continuation
    ? "restart"
    : "error";
}
