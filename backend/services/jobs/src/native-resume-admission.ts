import { createHash } from "node:crypto";
import type { ActiveJobRecord } from "./persistence/catalog.js";

export type NativeResumeJobQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;
export interface NativeResumeJobScope {
  canonicalJobId: string;
  jobRevision: string;
  jobContextSha256: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const unavailable = () => Error("NativeResumeJobAdmissionUnavailable");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Existing Gateway job-revision.v1 canonical ordering and Documents' exact resume context.
 * No model context, provider consent, truncation, generated content or authority issuance. */
export function nativeResumeJobBindings(
  job: Pick<
    ActiveJobRecord,
    "id" | "company" | "title" | "locations" | "department" | "description"
  >,
): { jobRevision: string; jobContextSha256: string } {
  return {
    jobRevision: digest({
      job: {
        active: true,
        company: { id: job.company.id, name: job.company.name },
        department: job.department ?? null,
        id: job.id,
        locations: job.locations,
        title: job.title,
      },
      schema: "job-revision.v1",
    }),
    jobContextSha256: digest({ title: job.title, description: job.description }),
  };
}

/** Same short owner transaction as reservation/completion. Never hold across owner/network I/O.
 * The existing statement revision triggers fence committed job/company/alias changes. Sources
 * have no revision trigger: lock all current exact-member sources separately, including withdrawn
 * ones. Source insertions only add evidence; deletion/withdrawal/reassignment of held evidence
 * cannot commit. The shared revision row briefly delays catalog writes, not catalog reads.
 * Locks do not stop wall-clock expiry; callers must recheck admission for every later operation. */
export async function lockNativeResumeJobAdmission(
  input: NativeResumeJobScope,
  query: NativeResumeJobQuery,
  enabled: () => boolean = () => false,
): Promise<void> {
  try {
    const keys = ["canonicalJobId", "jobRevision", "jobContextSha256"];
    if (
      !enabled() ||
      !input ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== keys.length ||
      !keys.every((key) => {
        const d = Object.getOwnPropertyDescriptor(input, key);
        return d?.enumerable === true && "value" in d;
      })
    )
      throw unavailable();
    const fixed = Object.freeze({ ...input });
    if (
      typeof fixed.canonicalJobId !== "string" ||
      !uuid.test(fixed.canonicalJobId) ||
      ![fixed.jobRevision, fixed.jobContextSha256].every(
        (v) => typeof v === "string" && hash.test(v),
      )
    )
      throw unavailable();
    const [state] = await query<Array<{ revision: string }>>`
      SELECT revision::text AS revision FROM jobs.catalog_search_state
      WHERE singleton=true FOR SHARE`;
    if (!enabled() || !state || !/^[1-9][0-9]*$/u.test(state.revision)) throw unavailable();
    const sources = await query<Array<{ withdrawn: boolean }>>`
      WITH RECURSIVE members(id) AS (
        SELECT ${fixed.canonicalJobId}::uuid
        UNION
        SELECT CASE WHEN d.canonical_job_id=d.job_id THEN d.candidate_job_id ELSE d.job_id END
        FROM jobs.duplicate_candidates d JOIN members m ON d.canonical_job_id=m.id
        WHERE d.resolution='exact'
      )
      SELECT s.withdrawn_at IS NOT NULL AS withdrawn FROM jobs.job_sources s
      WHERE s.job_id IN (SELECT id FROM members) ORDER BY s.id FOR SHARE OF s`;
    if (!enabled() || !sources.some((source) => source.withdrawn === false)) throw unavailable();
    const [job] = await query<
      Array<{
        id: string;
        companyId: string;
        companyName: string;
        title: string;
        description: string;
        locations: string[];
        department: string | null;
      }>
    >`
      SELECT j.id,c.id AS "companyId",c.display_name AS "companyName",j.title,
        j.description,j.locations,j.department FROM jobs.canonical_jobs j
      JOIN jobs.companies c ON c.id=j.company_id
      WHERE j.id=${fixed.canonicalJobId} AND j.status='active'
        AND j.expires_at>clock_timestamp() AND j.description IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM jobs.duplicate_candidates d
          WHERE d.resolution='exact' AND d.canonical_job_id<>j.id
            AND (d.job_id=j.id OR d.candidate_job_id=j.id))`;
    if (!enabled() || !job) throw unavailable();
    const current = nativeResumeJobBindings({
      id: job.id,
      title: job.title,
      description: job.description,
      locations: job.locations,
      company: { id: job.companyId, name: job.companyName },
      ...(job.department ? { department: job.department } : {}),
    });
    if (
      current.jobRevision !== fixed.jobRevision ||
      current.jobContextSha256 !== fixed.jobContextSha256 ||
      !enabled()
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
}
