import { createHash } from "node:crypto";
import {
  eventTypes,
  type OutboxNudgeV1,
  outboxNudgeIntegrityInput,
  validateEventData,
} from "@ai-job-apply/event-contracts";
import type { ContributionProcessingEventPublisher } from "./contribution-processing-event-delivery.js";
import type {
  ContributionConsentBinding,
  CurrentContributionConsentPort,
} from "./contribution-processing.js";

interface ProfileConsentRecord {
  client: "extension";
  documentVersion: string;
  expiresAt?: string;
  grantedAt: string;
  id: string;
  ownerUserId: string;
  policyVersion: string;
  previewPayloadSha256: string;
  purpose: "ugc_contribution";
  recordedAt: string;
  schemaVersion: 1;
  state: "granted" | "revoked" | "superseded";
}

type ProfileConsentVerification =
  | { consent: ProfileConsentRecord; valid: true }
  | {
      reason:
        | "expired"
        | "invalid_request"
        | "mismatch"
        | "not_current"
        | "not_found"
        | "unavailable";
      valid: false;
    };

export interface ProfileUgcContributionConsentVerifierPort {
  verify(input: {
    consentId: string;
    documentVersion: string;
    ownerUserId: string;
    policyVersion: string;
    previewPayloadSha256: string;
    verifiedAt: string;
  }): Promise<ProfileConsentVerification>;
}

function exactInstant(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Processing-time adapter over Profile's authoritative current-consent verifier. */
export class ProfileCurrentContributionConsentAdapter implements CurrentContributionConsentPort {
  constructor(private readonly profile: ProfileUgcContributionConsentVerifierPort) {}

  async verifyCurrent(
    binding: Readonly<ContributionConsentBinding>,
  ): Promise<{ status: "current" | "invalid" | "unavailable" }> {
    let result: ProfileConsentVerification;
    try {
      result = await this.profile.verify({
        consentId: binding.consentId,
        documentVersion: binding.consentVersion,
        ownerUserId: binding.ownerUserId,
        policyVersion: binding.policyVersion,
        previewPayloadSha256: binding.previewDigestSha256,
        verifiedAt: binding.checkedAt,
      });
    } catch {
      return { status: "unavailable" };
    }
    if (!result || typeof result !== "object" || typeof result.valid !== "boolean") {
      return { status: "unavailable" };
    }
    if (!result.valid) {
      return result.reason === "unavailable" ? { status: "unavailable" } : { status: "invalid" };
    }
    const consent = result.consent;
    if (
      consent.schemaVersion !== 1 ||
      consent.state !== "granted" ||
      consent.purpose !== "ugc_contribution" ||
      consent.client !== "extension" ||
      consent.id !== binding.consentId ||
      consent.ownerUserId !== binding.ownerUserId ||
      consent.documentVersion !== binding.consentVersion ||
      consent.policyVersion !== binding.policyVersion ||
      consent.previewPayloadSha256 !== binding.previewDigestSha256 ||
      consent.grantedAt !== binding.approvedAt ||
      !exactInstant(consent.recordedAt) ||
      (consent.expiresAt !== undefined && !exactInstant(consent.expiresAt))
    ) {
      return { status: "unavailable" };
    }
    return { status: "current" };
  }
}

export interface IdentifierOnlyOutboxNudgeTransport {
  publish(nudge: OutboxNudgeV1): Promise<void>;
}

/**
 * Adapts processing delivery to the existing identifier-only outbox-nudge transport contract.
 * The authoritative event remains in Jobs; no event data or contributor identity enters SQS.
 */
export class IdentifierOnlyContributionProcessingEventPublisher
  implements ContributionProcessingEventPublisher
{
  constructor(private readonly transport: IdentifierOnlyOutboxNudgeTransport) {}

  async publish(
    input: Parameters<ContributionProcessingEventPublisher["publish"]>[0],
  ): Promise<void> {
    if (
      input.idempotencyKey !== input.event.id ||
      ![eventTypes.jobNormalized, eventTypes.jobVerified].includes(input.event.type) ||
      !validateEventData(input.event.type, input.event.data)
    ) {
      throw new Error("The contribution processing event is not transport-safe");
    }
    const fields = {
      schemaVersion: 1 as const,
      eventId: input.event.id,
      eventType: input.event.type,
    };
    const nudge: OutboxNudgeV1 = Object.freeze({
      ...fields,
      integrity: Object.freeze({
        algorithm: "sha256" as const,
        digest: createHash("sha256").update(outboxNudgeIntegrityInput(fields)).digest("hex"),
      }),
    });
    await this.transport.publish(nudge);
  }
}
