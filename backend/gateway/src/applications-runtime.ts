import type { ProfileFact, ResumeDocumentCollection } from "@ai-job-apply/api-contracts";
import {
  type ApplicationJobGate,
  type ApplicationRecord,
  type ApplicationsApi,
  ApplicationsService,
  type ArtifactHashes,
  type CurrentBindings,
  FactBackedPacketSource,
  type FieldDefinition,
  jobRevisionHash,
  type LiveBindingsSource,
  type MetricSink,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import type { GraphFact } from "@ai-job-apply/domain";
import type { JobCatalogReader } from "@ai-job-apply/jobs-service";
import type postgres from "postgres";

/** The owner APIs the Applications runtime reads through. It never touches another owner's tables. */
export interface ApplicationsRuntimeOptions {
  client: postgres.Sql;
  profile: { listProfileFacts(userId: string): Promise<{ facts: ProfileFact[] }> };
  documents: { listResumeDocuments(userId: string): Promise<ResumeDocumentCollection> };
  catalog: Pick<JobCatalogReader, "resolveActiveJobSummaries">;
  definitions: ReadonlyMap<string, FieldDefinition>;
  clock?: () => Date;
  metrics?: MetricSink;
}

export function toGraphFact(fact: ProfileFact): GraphFact {
  return {
    id: fact.id,
    kind: fact.kind,
    key: fact.key,
    value: fact.value,
    verification: fact.verification,
    sensitivity: fact.sensitivity,
    source: { type: fact.source.type, reference: fact.source.reference },
    ...(fact.evidence ? { evidence: { supportingSpans: fact.evidence.supportingSpans } } : {}),
    ...(fact.availability ? { availability: fact.availability } : {}),
    ...(fact.effectiveFrom ? { effectiveFrom: fact.effectiveFrom } : {}),
    ...(fact.effectiveTo ? { effectiveTo: fact.effectiveTo } : {}),
    version: fact.version,
  } as GraphFact;
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

  async function artifacts(ownerUserId: string): Promise<ArtifactHashes> {
    const documents = await options.documents.listResumeDocuments(ownerUserId);
    const latest = documents.documents
      .filter((document) => document.status === "parsed")
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
    return latest ? { resume: latest.sha256 } : {};
  }

  const jobs: ApplicationJobGate = {
    async isActive(jobId, at) {
      const resolved = await options.catalog.resolveActiveJobSummaries([jobId], at);
      return resolved.items.some((candidate) => candidate.requestedJobId === jobId);
    },
  };

  const bindings: LiveBindingsSource = {
    async resolve({ ownerUserId, application, formHash }): Promise<CurrentBindings> {
      const resume = (await artifacts(ownerUserId)).resume;
      return {
        jobRevision: await jobRevision(application.canonicalJobId, clock()),
        formHash,
        ...(resume ? { resumeHash: resume } : {}),
      };
    },
  };

  const packets = new FactBackedPacketSource({
    facts: async (ownerUserId) =>
      (await options.profile.listProfileFacts(ownerUserId)).facts.map(toGraphFact),
    jobRevision: (application: ApplicationRecord) =>
      jobRevision(application.canonicalJobId, clock()),
    artifacts: (ownerUserId) => artifacts(ownerUserId),
    clock,
  });

  return new ApplicationsService({
    store: new PostgresApplicationStore(options.client, clock, {
      definitions: options.definitions,
    }),
    packets,
    bindings,
    jobs,
    ...(options.metrics ? { metrics: options.metrics } : {}),
    clock,
  });
}
