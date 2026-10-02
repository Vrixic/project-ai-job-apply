import type { ProfileFact } from "@ai-job-apply/api-contracts";
import {
  type ApplicationCoverLetters,
  type ApplicationJobGate,
  type ApplicationRecord,
  type ApplicationsApi,
  ApplicationsService,
  ApplicationsUnavailableError,
  type ArtifactHashes,
  type CurrentBindings,
  FactBackedPacketSource,
  type FieldDefinition,
  jobRevisionHash,
  type LiveBindingsSource,
  type MetricSink,
  PostgresApplicationStore,
  type ResumeFileBody,
  type ResumePreviewBody,
  type ResumePreviewSource,
} from "@ai-job-apply/applications-service";
import {
  RESUME_TAILORING_REQUEST_KIND,
  type ResumeTailoringResult,
} from "@ai-job-apply/documents-service";
import type { GraphFact } from "@ai-job-apply/domain";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import { profileFactToGraphFact } from "@ai-job-apply/profile-service";
import type postgres from "postgres";
import type { ResumeTailoringClient } from "./resume-tailoring-client.js";

/** The owner APIs the Applications runtime reads through. It never touches another owner's tables. */
export interface ApplicationsRuntimeOptions {
  client: postgres.Sql;
  profile: { listProfileFacts(userId: string): Promise<{ facts: ProfileFact[] }> };
  /** The Documents runtime; without it packets carry no resume and the preview is unavailable. */
  tailoring?: ResumeTailoringClient;
  /** Owned Documents context/read port only; no live provider is composed inside the Gateway. */
  coverLetters?: ApplicationCoverLetters;
  /** Default false. Enable only with compatible migrations and the owned dispatch/recovery runtime. */
  coverLetterPreparationEnabled?: boolean;
  catalog: Pick<JobCatalogReader, "resolveActiveJobSummaries" | "getActiveJob">;
  definitions: ReadonlyMap<string, FieldDefinition>;
  clock?: () => Date;
  metrics?: MetricSink;
}

export function toGraphFact(fact: ProfileFact): GraphFact {
  return profileFactToGraphFact(fact);
}

/** Field definitions from `data/taxonomies/application-fields.v1.json`. */
export function loadFieldDefinitions(taxonomy: {
  fields: FieldDefinition[];
}): ReadonlyMap<string, FieldDefinition> {
  return new Map(taxonomy.fields.map((field) => [field.key, field]));
}

/**
 * Wires the Applications API from Profile, Documents, and Jobs owner APIs. The job revision hashes
 * only fields that matter to an application (identity, company, title, locations, department) and
 * deliberately not verification/expiry timestamps, so a routine re-verification does not invalidate
 * an approval while a changed posting does. An inactive job hashes to a distinct revision, so a job
 * that disappears invalidates approval instead of being submitted against.
 */
export function createApplicationsRuntime(options: ApplicationsRuntimeOptions): ApplicationsApi {
  const clock = options.clock ?? (() => new Date());
  const store = new PostgresApplicationStore(options.client, clock, {
    definitions: options.definitions,
  });

  async function jobRevision(jobId: string, at: Date): Promise<string> {
    const resolved = await options.catalog.resolveActiveJobSummaries([jobId], at);
    const item = resolved.items.find((candidate) => candidate.requestedJobId === jobId);
    if (!item) return jobRevisionHash({ id: jobId, active: false });
    const { job } = item;
    return jobRevisionHash({
      id: job.id,
      active: true,
      company: { id: job.company.id, name: job.company.name },
      title: job.title,
      locations: job.locations,
      department: job.department ?? null,
    });
  }

  /**
   * Asks the Documents runtime to tailor the owner's own resume to the job (ADR-031). A transport
   * failure is a 503, never a silent "no resume", so an approval is never invalidated or created
   * against a resume that was merely unreachable.
   */
  async function tailoringFor(
    ownerUserId: string,
    jobId: string,
    mode: "hash" | "preview",
  ): Promise<ResumeTailoringResult | undefined> {
    if (!options.tailoring) return undefined;
    const job = await options.catalog.getActiveJob(jobId, clock());
    if (!job) return undefined;
    try {
      return await options.tailoring.tailor({
        kind: RESUME_TAILORING_REQUEST_KIND,
        mode,
        ownerUserId,
        job: { title: job.title.slice(0, 300), description: job.description.slice(0, 60_000) },
      });
    } catch {
      throw new ApplicationsUnavailableError();
    }
  }

  async function artifacts(ownerUserId: string, jobId: string): Promise<ArtifactHashes> {
    const result = await tailoringFor(ownerUserId, jobId, "hash");
    return result?.status === "ready" ? { resume: result.contentSha256 } : {};
  }

  const resumes: ResumePreviewSource = {
    async file({ ownerUserId, jobId, format }): Promise<ResumeFileBody | undefined> {
      if (!options.tailoring) return undefined;
      const job = await options.catalog.getActiveJob(jobId, clock());
      if (!job) return undefined;
      let result: ResumeTailoringResult;
      try {
        result = await options.tailoring.tailor({
          kind: RESUME_TAILORING_REQUEST_KIND,
          mode: "artifact",
          ownerUserId,
          format,
          job: { title: job.title.slice(0, 300), description: job.description.slice(0, 60_000) },
        });
      } catch {
        throw new ApplicationsUnavailableError();
      }
      if (result.status !== "ready" || !result.artifact) return undefined;
      return {
        format: result.artifact.format,
        mediaType: result.artifact.mediaType,
        sha256: result.artifact.sha256,
        sizeBytes: result.artifact.sizeBytes,
        contentSha256: result.contentSha256,
        contentBase64: result.artifact.contentBase64,
        baseFileName: result.baseDocument.fileName,
      };
    },
    async preview({ ownerUserId, jobId }): Promise<ResumePreviewBody> {
      const result = await tailoringFor(ownerUserId, jobId, "preview");
      if (!result) return { status: "unavailable", unavailableReason: "service_unavailable" };
      if (result.status === "no_resume") return { status: "no_resume" };
      if (result.status === "unavailable") {
        return {
          status: "unavailable",
          unavailableReason:
            result.reason === "invalid_request" ? "service_unavailable" : result.reason,
        };
      }
      return {
        status: "ready",
        baseDocument: { id: result.baseDocument.id, fileName: result.baseDocument.fileName },
        tailoringVersion: result.tailoringVersion,
        contentSha256: result.contentSha256,
        matchedTerms: result.matchedTerms ?? [],
        sections: (result.sections ?? []).map((section) => ({
          kind: section.kind,
          ...(section.heading ? { heading: section.heading } : {}),
          entries: section.entries.map((entry) => ({
            lines: entry.lines,
            bullets: entry.bullets.map((bullet) => ({
              text: bullet.text,
              change: bullet.change,
              ...(bullet.matchedTerms ? { matchedTerms: bullet.matchedTerms } : {}),
            })),
          })),
        })),
      };
    },
  };

  const jobs: ApplicationJobGate = {
    async isActive(jobId, at) {
      const resolved = await options.catalog.resolveActiveJobSummaries([jobId], at);
      return resolved.items.some((candidate) => candidate.requestedJobId === jobId);
    },
  };

  const bindings: LiveBindingsSource = {
    async resolve({ ownerUserId, application, formHash }): Promise<CurrentBindings> {
      const view = await store.getApplication(ownerUserId, application.id);
      const packetLetterHash = view.currentPacket?.artifactHashes.coverLetter;
      let coverLetterHash: string | undefined;
      if (packetLetterHash) {
        if (!options.coverLetters) throw new ApplicationsUnavailableError();
        try {
          coverLetterHash = await options.coverLetters.binding(
            ownerUserId,
            application.id,
            packetLetterHash,
          );
        } catch {
          // An unreachable Documents/evidence owner is not proof the artifact changed.
          throw new ApplicationsUnavailableError();
        }
      }
      const resume = (await artifacts(ownerUserId, application.canonicalJobId)).resume;
      return {
        jobRevision: await jobRevision(application.canonicalJobId, clock()),
        formHash,
        ...(resume ? { resumeHash: resume } : {}),
        ...(coverLetterHash ? { coverLetterHash } : {}),
      };
    },
  };

  const packets = new FactBackedPacketSource({
    facts: async (ownerUserId) =>
      (await options.profile.listProfileFacts(ownerUserId)).facts.map(toGraphFact),
    jobRevision: (application: ApplicationRecord) =>
      jobRevision(application.canonicalJobId, clock()),
    artifacts: (ownerUserId, application) => artifacts(ownerUserId, application.canonicalJobId),
    clock,
  });

  return new ApplicationsService({
    store,
    ...(options.coverLetterPreparationEnabled === true ? { preparations: store } : {}),
    packets,
    bindings,
    jobs,
    resumes,
    ...(options.coverLetters ? { coverLetters: options.coverLetters } : {}),
    ...(options.metrics ? { metrics: options.metrics } : {}),
    clock,
  });
}
