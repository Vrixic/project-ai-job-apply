import type { ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";

/** The original deadline is never renewed by reads, edits or approval. */
export function materialDeadline(material: ApplicationTemporaryMaterial): number {
  if (
    !Number.isSafeInteger(material.completedAtMs) ||
    !Number.isSafeInteger(material.expiresAtMs) ||
    material.completedAtMs < 0 ||
    material.expiresAtMs !== material.completedAtMs + 1_800_000
  )
    return 0;
  return material.expiresAtMs;
}

export function materialsExpired(
  materials: readonly ApplicationTemporaryMaterial[] | undefined,
  now = Date.now(),
): boolean {
  return (materials ?? []).some((material) => now >= materialDeadline(material));
}

export function sameMaterial(
  left: ApplicationTemporaryMaterial | undefined,
  right: ApplicationTemporaryMaterial | undefined,
): boolean {
  return (
    !!left &&
    !!right &&
    left.schemaVersion === right.schemaVersion &&
    left.kind === right.kind &&
    left.generationId === right.generationId &&
    left.version === right.version &&
    left.contentSha256 === right.contentSha256 &&
    left.completedAtMs === right.completedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}
