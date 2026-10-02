import type { PostgresApplicationStore } from "@ai-job-apply/applications-service";
import type {
  CoverLetterEvidenceSource,
  PostgresCoverLetterStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import { type ProfileStore, profileFactToGraphFact } from "@ai-job-apply/profile-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Private owner composition only. No provider, raw resume, object write or cross-owner SQL.
 * The lease connection must be separate from owner reads, or their shared pool must have >=2
 * connections: never nest owner reads behind a lease held on a single-connection shared pool.
 * This factory is uncomposed/default-off until the reviewed runtime and privacy gates pass.
 */
export function createOwnedCoverLetterEvidenceSource(options: {
  applications: Pick<PostgresApplicationStore, "getApplication">;
  profile: Pick<ProfileStore, "listProfileFacts">;
  catalog: Pick<JobCatalogReader, "getActiveJob">;
  candidateLease: Pick<PostgresCoverLetterStore, "withGenerationLease">;
  enabled?: () => boolean;
  clock?: () => Date;
}): CoverLetterEvidenceSource {
  const enabled = options.enabled ?? (() => false);
  const clock = options.clock ?? (() => new Date());
  return {
    async load(ownerUserId, applicationId) {
      try {
        if (!enabled() || !UUID.test(ownerUserId) || !UUID.test(applicationId)) throw new Error();
        return await options.candidateLease.withGenerationLease(ownerUserId, async () => {
          if (!enabled()) throw new Error();
          const { application } = await options.applications.getApplication(
            ownerUserId,
            applicationId,
          );
          if (
            application.id !== applicationId ||
            application.ownerUserId !== ownerUserId ||
            !UUID.test(application.canonicalJobId)
          )
            throw new Error();
          if (!enabled()) throw new Error();
          const at = new Date(clock().getTime());
          if (!Number.isFinite(at.getTime())) throw new Error();
          const job = await options.catalog.getActiveJob(application.canonicalJobId, at);
          if (
            job?.status !== "active" ||
            job.expiresAt.getTime() <= at.getTime() ||
            !Number.isFinite(job.expiresAt.getTime()) ||
            typeof job.title !== "string" ||
            typeof job.company.name !== "string" ||
            typeof job.description !== "string"
          )
            throw new Error();
          const jobFacts = {
            title: job.title,
            company: job.company.name,
            description: job.description,
          };
          const expiresAt = job.expiresAt.getTime();
          if (!enabled()) throw new Error();
          const { facts } = await options.profile.listProfileFacts(ownerUserId);
          const result = {
            facts: facts
              .filter((fact) => fact.sensitivity !== "restricted")
              .map(profileFactToGraphFact),
            // Keep the complete posting for context hashing; prompt bounding belongs to AI SDK.
            job: jobFacts,
          };
          const finishedAt = clock().getTime();
          if (
            !enabled() ||
            !Number.isFinite(finishedAt) ||
            finishedAt < at.getTime() ||
            finishedAt >= expiresAt
          )
            throw new Error();
          return result;
        });
      } catch {
        // Never reflect owner diagnostics, facts, source references or posting text.
        throw new Error("CoverLetterEvidenceUnavailable");
      }
    },
  };
}
