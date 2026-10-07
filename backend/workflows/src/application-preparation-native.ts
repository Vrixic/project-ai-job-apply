import { coverLetterContext } from "@ai-job-apply/ai-sdk";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import type {
  CoverLetterPreparationPort,
  PreparationRecord,
} from "@ai-job-apply/applications-service";
import {
  type PostgresCoverLetterStore,
  type PostgresCoverLetterWorkStore,
  type PostgresNativeMaterialReadyStore,
  prepareOriginalCoverLetterRequest,
  validateNativeMaterialReady,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import type { createNativeLaunchControlClient } from "@ai-job-apply/documents-service/native-launch-control";
import type { PostgresNativeMaterialRegistry } from "@ai-job-apply/documents-service/native-material-registry";
import { createOwnedCoverLetterEvidenceSource } from "./application-preparation-evidence.js";

type Owners = Pick<
  Parameters<typeof createOwnedCoverLetterEvidenceSource>[0],
  "applications" | "profile" | "catalog"
>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;

/** Applications claim winner -> original Documents reservation/grant -> private native launch.
 * Recovery has only an owner receipt read: no slot writes, launch retry or model capability.
 * Ports require distinct candidate-lease and owner pools. Default off until reviewed runtime
 * composition, sender IAM and native routing/provider/accountable gates are satisfied. */
export function createNativeCoverLetterPreparationPort(options: {
  owners: Owners;
  candidateLease: Pick<PostgresCoverLetterStore, "withGenerationLease">;
  documents: Pick<PostgresCoverLetterStore, "reserveGeneration">;
  work: Pick<PostgresCoverLetterWorkStore, "issue">;
  ready: Pick<PostgresNativeMaterialReadyStore, "read">;
  admission: Pick<PostgresNativeMaterialRegistry, "readPreviousEpoch">;
  launcher: Pick<ReturnType<typeof createNativeLaunchControlClient>, "launch">;
  enabled?: () => boolean;
  launchEnabled?: () => boolean;
  clock?: () => Date;
}): CoverLetterPreparationPort {
  const enabled = options.enabled ?? (() => false);
  const launchEnabled = options.launchEnabled ?? enabled;
  const clock = options.clock ?? (() => new Date());
  const source = createOwnedCoverLetterEvidenceSource({
    ...options.owners,
    candidateLease: options.candidateLease,
    enabled,
    clock,
  });
  function identity(record: PreparationRecord) {
    const fixed = structuredClone({
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
      !enabled() ||
      record.state !== "running" ||
      !record.generationClaimedAt ||
      !Number.isFinite(record.generationClaimedAt.getTime()) ||
      ![fixed.id, fixed.ownerUserId, fixed.applicationId].every((value) => uuid.test(value)) ||
      ![fixed.jobContextHash, fixed.confirmedFactsHash].every((value) => hash.test(value)) ||
      fixed.noticeVersion !== COVER_LETTER_DISCLOSURE_VERSION ||
      !Number.isFinite(fixed.approvedAt.getTime()) ||
      fixed.expiresAt.getTime() !== fixed.approvedAt.getTime() + 900_000
    )
      throw Error();
    return fixed;
  }
  async function recover(record: PreparationRecord) {
    const fixed = identity(record);
    const receipt = await options.ready.read(fixed);
    const now = clock().getTime();
    if (!enabled() || !receipt) return null;
    if (
      !validateNativeMaterialReady(receipt) ||
      !Number.isFinite(now) ||
      receipt.material.ownerUserId !== fixed.ownerUserId ||
      receipt.material.applicationId !== fixed.applicationId ||
      receipt.material.generationId !== fixed.id ||
      now < receipt.material.completedAtMs ||
      now >= receipt.material.expiresAtMs
    )
      throw Error();
    return structuredClone({
      temporaryMaterial: receipt.material,
      contentSha256: receipt.material.contentSha256,
      sourceFactIds: receipt.sourceFactIds,
      confidence: receipt.confidence,
    });
  }
  return Object.freeze({
    async context(record) {
      try {
        if (!enabled()) throw Error();
        const evidence = await source.load(record.ownerUserId, record.applicationId);
        if (!enabled()) throw Error();
        return coverLetterContext({ ...evidence, now: clock() });
      } catch {
        throw Error("CoverLetterPreparationUnavailable");
      }
    },
    async recover(record) {
      try {
        return await recover(record);
      } catch {
        throw Error("CoverLetterPreparationUnavailable");
      }
    },
    async generate(record) {
      let prepared: ReturnType<typeof prepareOriginalCoverLetterRequest> = null;
      try {
        const fixed = identity(record);
        const recovered = await recover(record);
        if (recovered) return { kind: "ready", letter: recovered };
        if (!launchEnabled()) return { kind: "in_progress" };
        const fresh = () => {
          const now = clock().getTime();
          return (
            enabled() &&
            launchEnabled() &&
            Number.isFinite(now) &&
            now >= fixed.approvedAt.getTime() &&
            now < fixed.expiresAt.getTime()
          );
        };
        if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" };
        const evidence = await source.load(fixed.ownerUserId, fixed.applicationId);
        if (!fresh()) return { kind: "in_progress" };
        prepared = prepareOriginalCoverLetterRequest(fixed, { ...evidence, now: clock() });
        if (!prepared) return { kind: "failed", errorCode: "bindings_changed" };
        const requestSha256 = prepared.requestSha256;
        prepared.request.system = "";
        prepared.request.user = "";
        const previousEpochId = await options.admission.readPreviousEpoch(
          fixed.ownerUserId,
          fixed.applicationId,
        );
        if (!fresh()) return { kind: "in_progress" };
        const reserved = await options.documents.reserveGeneration({
          id: fixed.id,
          ownerUserId: fixed.ownerUserId,
          applicationId: fixed.applicationId,
          jobRevision: fixed.jobContextHash,
          confirmedFactsHash: fixed.confirmedFactsHash,
        });
        // Reservation is the second durable one-winner boundary. A crash between reservation
        // and dispatch leaves incomplete original work; it never authorizes replay to launch.
        if (reserved.kind !== "claimed" || !fresh()) return { kind: "in_progress" };
        const issued = await options.work.issue({
          ownerUserId: fixed.ownerUserId,
          documentId: fixed.id,
          purpose: "provider_dispatch",
          requestSha256,
          consentExpiresAt: fixed.expiresAt,
        });
        if (issued.kind !== "issued" || !fresh()) return { kind: "in_progress" };
        const grant = issued.authorization;
        if (
          grant.documentId !== fixed.id ||
          grant.ownerUserId !== fixed.ownerUserId ||
          !uuid.test(grant.id) ||
          grant.purpose !== "provider_dispatch" ||
          grant.requestSha256 !== requestSha256 ||
          grant.state !== "issued" ||
          grant.consentExpiresAt.getTime() !== fixed.expiresAt.getTime() ||
          clock().getTime() >= grant.expiresAt.getTime()
        )
          return { kind: "in_progress" };
        await options.launcher.launch({
          schemaVersion: 1,
          action: "launch",
          ownerUserId: fixed.ownerUserId,
          applicationId: fixed.applicationId,
          original: {
            id: grant.id,
            documentId: grant.documentId,
            purpose: "provider_dispatch",
            requestSha256,
          },
          previousEpochId,
        });
        // A launch ACK is not readiness. Read only the original owning receipt.
        const letter = await recover(record);
        return letter ? { kind: "ready", letter } : { kind: "in_progress" };
      } catch {
        return { kind: "in_progress" };
      } finally {
        if (prepared) {
          prepared.request.system = "";
          prepared.request.user = "";
        }
      }
    },
  } satisfies CoverLetterPreparationPort);
}
