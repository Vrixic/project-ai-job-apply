import { createHash } from "node:crypto";
import type { Application, CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
export const APP = "00000000-0000-7000-8000-000000000001";
export const JOB = "00000000-0000-7000-8000-000000000002";
export const WEB = "https://candidate.example";
export const EMPLOYER = "https://employer.example/jobs/synthetic";
export const LINK = `${WEB}/jobs?application=${APP}&job=${JOB}`;
export function handoffFixture(now = Date.now()) {
  const at = new Date(now - 60_000).toISOString();
  const job: CanonicalJobDetail = {
    id: JOB,
    company: { id: "00000000-0000-7000-8000-000000000004", name: "Synthetic Company" },
    title: "Synthetic Engineer",
    locations: ["Synthetic location"],
    description: "Generated test description",
    status: "active",
    firstObservedAt: at,
    lastVerifiedAt: at,
    expiresAt: new Date(now + 86_400_000).toISOString(),
    sources: [
      {
        provider: "other",
        provenance: "explicit_ugc",
        canonicalUrl: EMPLOYER,
        firstObservedAt: at,
        lastVerifiedAt: at,
      },
    ],
  };
  const application: Application = {
    id: APP,
    canonicalJobId: JOB,
    status: "approved",
    revision: 4,
    currentAction: "ready_to_submit",
    attempts: [],
    createdAt: at,
    updatedAt: at,
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: "a".repeat(64),
      jobRevision: createHash("sha256").update(activeJobRevisionDigestInput(job)).digest("hex"),
      createdAt: at,
      artifactHashes: { resume: "b".repeat(64) },
      temporaryMaterials: [
        {
          schemaVersion: 1,
          kind: "tailored_resume",
          generationId: "00000000-0000-7000-8000-000000000005",
          version: 1,
          contentSha256: "b".repeat(64),
          completedAtMs: now - 1_500_000,
          expiresAtMs: now + 300_000,
        },
      ],
      fields: [
        {
          fieldKey: "contact.email",
          value: "synthetic@example.test",
          origin: "confirmed_fact",
          sourceFactIds: [],
          confidence: 1,
          disposition: "review",
          reasons: ["explicit_each_time"],
          requiresReview: true,
        },
        {
          fieldKey: "authorization.us_authorized",
          value: false,
          origin: "user_entered",
          sourceFactIds: [],
          confidence: 1,
          disposition: "review",
          reasons: ["restricted_answer"],
          requiresReview: true,
        },
        {
          fieldKey: "attestation.truthful",
          value: true,
          origin: "user_entered",
          sourceFactIds: [],
          confidence: 1,
          disposition: "user_action",
          reasons: ["direct_user_action"],
          requiresReview: true,
        },
      ],
    },
    approval: {
      id: "00000000-0000-7000-8000-000000000006",
      packetHash: "a".repeat(64),
      acknowledgedFieldKeys: [
        "contact.email",
        "authorization.us_authorized",
        "attestation.truthful",
      ],
      approvedAt: at,
      expiresAt: new Date(now + 3_600_000).toISOString(),
    },
  };
  const proof = {
    schemaVersion: 1,
    packetId: application.currentPacket?.id,
    packetHash: application.currentPacket?.packetHash,
    temporaryMaterial: application.currentPacket?.temporaryMaterials?.[0],
  };
  return { job, application, proof };
}
