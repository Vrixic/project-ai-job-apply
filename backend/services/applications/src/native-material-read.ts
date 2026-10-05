import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/domain/temporary-material";
import type { ApplicationStorePort } from "./service.js";

/** Private owning scalar read, after authenticated subject-to-owner resolution. Not a public
 * route or a content read. No SQL locks span rendering; the native transport repeats this read
 * and compares the original packet before sending. Remote authentication is not supplied here. */
export async function authorizeNativeMaterialRead(input: {
  store: Pick<ApplicationStorePort, "getApplication">;
  ownerUserId: string;
  reference: Readonly<TemporaryMaterialReference>;
  signal: AbortSignal;
  clock?: () => Date;
}) {
  if (
    !validateTemporaryMaterialReference(input.reference) ||
    input.reference.kind !== "cover_letter" ||
    input.reference.ownerUserId !== input.ownerUserId ||
    input.signal.aborted
  )
    return null;
  const reference = { ...input.reference };
  const clock = input.clock ?? (() => new Date());
  if (clock().getTime() >= reference.expiresAtMs) return null;
  const view = await input.store.getApplication(input.ownerUserId, reference.applicationId);
  const packet = view.currentPacket;
  if (
    input.signal.aborted ||
    clock().getTime() >= reference.expiresAtMs ||
    view.application.ownerUserId !== reference.ownerUserId ||
    view.application.id !== reference.applicationId ||
    view.application.status === "applied" ||
    view.application.status === "cancelled" ||
    !packet ||
    packet.userId !== reference.ownerUserId ||
    packet.applicationId !== reference.applicationId ||
    view.application.currentPacketId !== packet.id ||
    packet.artifactHashes.coverLetter !== reference.contentSha256 ||
    !packet.temporaryMaterials?.some((candidate) =>
      sameTemporaryMaterialReference(reference, candidate),
    )
  )
    return null;
  return {
    schemaVersion: 1 as const,
    packetId: packet.id,
    packetHash: packet.packetHash,
    reference,
  };
}
