import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/domain";

/** Packet metadata only. Original resumes without a temporary derived material keep their own
 * policy. Generated content, renderer output and provider capabilities never enter this owner. */
export function validPacketTemporaryMaterials(
  value: unknown,
  packet: {
    userId: string;
    applicationId: string;
    artifactHashes: { resume?: string; coverLetter?: string };
  },
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 2) return false;
  const kinds = new Set<string>();
  return value.every((reference) => {
    if (
      !validateTemporaryMaterialReference(reference) ||
      kinds.has(reference.kind) ||
      reference.ownerUserId !== packet.userId ||
      reference.applicationId !== packet.applicationId ||
      reference.contentSha256 !==
        (reference.kind === "cover_letter"
          ? packet.artifactHashes.coverLetter
          : packet.artifactHashes.resume)
    )
      return false;
    kinds.add(reference.kind);
    return true;
  });
}

export function temporaryMaterialReasons(
  expected: readonly TemporaryMaterialReference[] | undefined,
  current: readonly TemporaryMaterialReference[] | undefined,
  now: Date,
): Array<"temporary_material_expired" | "temporary_material_changed"> {
  const reasons: Array<"temporary_material_expired" | "temporary_material_changed"> = [];
  for (const reference of expected ?? []) {
    if (
      !validateTemporaryMaterialReference(reference) ||
      !Number.isFinite(now.getTime()) ||
      now.getTime() >= reference.expiresAtMs ||
      now.getTime() < reference.completedAtMs
    ) {
      if (!reasons.includes("temporary_material_expired"))
        reasons.push("temporary_material_expired");
      continue;
    }
    const matches = (Array.isArray(current) ? current : []).filter(
      (candidate) =>
        validateTemporaryMaterialReference(candidate) && candidate.kind === reference.kind,
    );
    if (
      matches.length !== 1 ||
      !matches[0] ||
      !validateTemporaryMaterialReference(matches[0]) ||
      !sameTemporaryMaterialReference(reference, matches[0])
    ) {
      if (!reasons.includes("temporary_material_changed"))
        reasons.push("temporary_material_changed");
    }
  }
  return reasons;
}

/** Ordinary packet edits cannot strip a generated material's deadline or relabel a replacement
 * as an original upload. Explicit new generation must arrive through the owning producer port. */
export function carryTemporaryMaterialBindings(
  previous: readonly TemporaryMaterialReference[] | undefined,
  proposed: readonly TemporaryMaterialReference[] | undefined,
  hashes: { resume?: string; coverLetter?: string },
): TemporaryMaterialReference[] {
  const output = (proposed ?? []).map((reference) => ({ ...reference }));
  for (const original of previous ?? []) {
    const hash = original.kind === "cover_letter" ? hashes.coverLetter : hashes.resume;
    if (!hash) continue;
    const replacement = output.find((reference) => reference.kind === original.kind);
    if (!replacement) {
      if (hash !== original.contentSha256)
        throw Error("TemporaryMaterialReplacementBindingRequired");
      output.push({ ...original });
      continue;
    }
    if (
      replacement.generationId === original.generationId &&
      (replacement.completedAtMs !== original.completedAtMs ||
        replacement.expiresAtMs !== original.expiresAtMs ||
        replacement.version < original.version ||
        (replacement.version === original.version &&
          replacement.contentSha256 !== original.contentSha256))
    )
      throw Error("TemporaryMaterialOriginalBindingImmutable");
  }
  return output;
}
