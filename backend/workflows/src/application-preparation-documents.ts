import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import type {
  CoverLetterPreparationPort,
  PreparationRecord,
} from "@ai-job-apply/applications-service";
import type { CoverLetterProviderObjects } from "@ai-job-apply/documents-service/cover-letter-provider";
import {
  CoverLetterDraftRecoveryService,
  type CoverLetterPreparationIdentity,
  CoverLetterPreparationService,
  CoverLetterProviderInitializer,
  type CoverLetterProviderInvoker,
  CoverLetterProviderRecovery,
  type PostgresCoverLetterStore,
  type PostgresCoverLetterWorkStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createOwnedCoverLetterEvidenceSource } from "./application-preparation-evidence.js";

type Owners = Pick<
  Parameters<typeof createOwnedCoverLetterEvidenceSource>[0],
  "applications" | "profile" | "catalog"
>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

/** Applications-owned accepted records only, never candidate input or an Invoke result. */
function identity(record: PreparationRecord): CoverLetterPreparationIdentity {
  const result = structuredClone({
    id: record.id,
    ownerUserId: record.ownerUserId,
    applicationId: record.applicationId,
    jobContextHash: record.jobContextHash,
    confirmedFactsHash: record.confirmedFactsHash,
    noticeVersion: record.noticeVersion,
    approvedAt: record.approvedAt,
    expiresAt: record.expiresAt,
  });
  if (
    ![result.id, result.ownerUserId, result.applicationId].every((value) => UUID.test(value)) ||
    ![result.jobContextHash, result.confirmedFactsHash].every((value) => HASH.test(value))
  )
    throw Error();
  return result;
}

/** Source-only private Applications→Documents composition. The provider port is isolated Invoke,
 * never a model or credential in the database activity. Retry recovery has no initializer/Invoke
 * capability. Supplied owner clients and the candidate lease must use distinct supported pools;
 * never hold a single-connection lease pool while querying through that same pool.
 * Runtime/retention/IAM/accountable acceptance and activation remain separate release gates.
 */
export function createIsolatedCoverLetterPreparationPort(options: {
  owners: Owners;
  documents: Pick<
    PostgresCoverLetterStore,
    "generationMetadata" | "reserveGeneration" | "complete" | "recover"
  >;
  candidateLease: Pick<PostgresCoverLetterStore, "withGenerationLease">;
  work: Pick<
    PostgresCoverLetterWorkStore,
    "issue" | "claim" | "recordSettled" | "issueProviderDispatch"
  >;
  objects: Pick<CoverLetterProviderObjects, "find" | "read" | "putIfAbsent">;
  provider: Pick<CoverLetterProviderInvoker, "invoke">;
  enabled?: () => boolean;
  clock?: () => Date;
}): CoverLetterPreparationPort {
  const enabled = options.enabled ?? (() => false);
  const clock = options.clock ?? (() => new Date());
  // Explicit facades keep the lease distinct from persistence and recovery read-only with
  // respect to provider slots. No transition/create-on-replay capability reaches recovery.
  const documents = {
    generationMetadata: options.documents.generationMetadata.bind(options.documents),
    reserveGeneration: options.documents.reserveGeneration.bind(options.documents),
    complete: options.documents.complete.bind(options.documents),
    recover: options.documents.recover.bind(options.documents),
    withGenerationLease: options.candidateLease.withGenerationLease.bind(options.candidateLease),
  };
  const source = createOwnedCoverLetterEvidenceSource({
    applications: Object.freeze({
      getApplication: options.owners.applications.getApplication.bind(options.owners.applications),
    }),
    profile: Object.freeze({
      listGroundingFacts: options.owners.profile.listGroundingFacts.bind(options.owners.profile),
    }),
    catalog: Object.freeze({
      getActiveJob: options.owners.catalog.getActiveJob.bind(options.owners.catalog),
    }),
    candidateLease: Object.freeze({ withGenerationLease: documents.withGenerationLease }),
    enabled,
    clock,
  });
  const readObjects = Object.freeze({
    find: options.objects.find.bind(options.objects),
    read: options.objects.read.bind(options.objects),
  });
  const recovery = new CoverLetterDraftRecoveryService(
    Object.freeze({
      generationMetadata: documents.generationMetadata,
      complete: documents.complete,
      recover: documents.recover,
      withGenerationLease: documents.withGenerationLease,
    }),
    source,
    new CoverLetterProviderRecovery(readObjects),
    clock,
    enabled,
  );
  const slotsWork = Object.freeze({
    issue: async (input: Parameters<PostgresCoverLetterWorkStore["issue"]>[0]) => {
      if (input.purpose !== "private_slots") throw new Error("CoverLetterPreparationUnavailable");
      return options.work.issue(structuredClone(input));
    },
    claim: async (reference: Parameters<PostgresCoverLetterWorkStore["claim"]>[0]) => {
      if (reference.purpose !== "private_slots")
        throw new Error("CoverLetterPreparationUnavailable");
      return options.work.claim(structuredClone(reference));
    },
    recordSettled: async (
      reference: Parameters<PostgresCoverLetterWorkStore["recordSettled"]>[0],
    ) => {
      if (reference.purpose !== "private_slots")
        throw new Error("CoverLetterPreparationUnavailable");
      return options.work.recordSettled(structuredClone(reference));
    },
  });
  const initializer = new CoverLetterProviderInitializer(
    Object.freeze({
      reserveGeneration: documents.reserveGeneration,
      withGenerationLease: documents.withGenerationLease,
    }),
    source,
    Object.freeze({
      ...readObjects,
      putIfAbsent: options.objects.putIfAbsent.bind(options.objects),
    }),
    enabled,
    clock,
    60_000,
    slotsWork,
  );
  const preparation = new CoverLetterPreparationService(
    Object.freeze({ generationMetadata: documents.generationMetadata }),
    initializer,
    Object.freeze({ issueProviderDispatch: options.work.issueProviderDispatch.bind(options.work) }),
    Object.freeze({ invoke: options.provider.invoke.bind(options.provider) }),
    recovery,
    enabled,
    clock,
  );
  const claimed = (record: PreparationRecord) =>
    record.state === "running" &&
    record.generationClaimedAt instanceof Date &&
    Number.isFinite(record.generationClaimedAt.getTime());
  const unavailable = () => new Error("CoverLetterPreparationUnavailable");
  return Object.freeze({
    async context(record) {
      try {
        if (!enabled()) throw Error();
        const original = identity(record);
        const evidence = await source.load(original.ownerUserId, original.applicationId);
        if (!enabled()) throw Error();
        return coverLetterContext({ ...evidence, now: clock() });
      } catch {
        throw unavailable();
      }
    },
    async generate(record) {
      try {
        if (!enabled() || !claimed(record))
          return { kind: "failed", errorCode: "generation_unavailable" };
        const result = await preparation.generate(identity(record));
        return enabled() ? structuredClone(result) : { kind: "in_progress" };
      } catch {
        return { kind: "in_progress" };
      }
    },
    async recover(record) {
      try {
        if (!enabled() || !claimed(record)) return null;
        // Does not refresh disclosure or call preparation.generate. Original result recovery
        // may finish after consent expires, under independent candidate/final-writer checks.
        const result = await recovery.recover(identity(record));
        return enabled() && result.kind === "ready" ? structuredClone(result.letter) : null;
      } catch {
        throw unavailable();
      }
    },
  } satisfies CoverLetterPreparationPort);
}
