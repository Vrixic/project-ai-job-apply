import type {
  ApplicationPacketPreparation,
  PrepareApplicationPacketRequest,
} from "@ai-job-apply/api-contracts";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";

export type PreparationFailureCode = NonNullable<ApplicationPacketPreparation["errorCode"]>;
export interface PreparationRecord {
  id: string;
  ownerUserId: string;
  applicationId: string;
  basePacketId: string;
  expectedRevision: number;
  jobContextHash: string;
  confirmedFactsHash: string;
  noticeVersion: "bedrock-cover-letter.v1";
  approvedAt: Date;
  expiresAt: Date;
  generationClaimedAt: Date | null;
  state: "queued" | "running" | "succeeded" | "failed";
  resultPacketId: string | null;
  errorCode: PreparationFailureCode | null;
  createdAt: Date;
  updatedAt: Date;
}

import type { VaultCurrentReference } from "./vault.js";

export interface PreparationContext {
  temporaryMaterials?: readonly TemporaryMaterialReference[];
  vaultReferences?: readonly VaultCurrentReference[];
  jobContextHash: string;
  confirmedFactsHash: string;
}

export type PreparationRequest = PrepareApplicationPacketRequest & {
  coverLetter: NonNullable<PrepareApplicationPacketRequest["coverLetter"]>;
};

export class PreparationNotFoundError extends Error {
  constructor() {
    super("Packet preparation was not found");
    this.name = "PreparationNotFoundError";
  }
}

/** One dispatch claim only. Recovery may reload an immutable draft, never call the model again. */
export type GenerationClaim =
  | { kind: "claimed"; preparation: PreparationRecord }
  | { kind: "already_claimed"; preparation: PreparationRecord }
  | { kind: "terminal"; preparation: PreparationRecord };
