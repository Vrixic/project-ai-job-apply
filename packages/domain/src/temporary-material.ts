/** Shared scalar generation binding. No content, service, renderer, provider or SQL runtime. */
export const GENERATED_MATERIAL_LIFETIME_MS = 1_800_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

/** Private metadata only. Completion time comes from the original generation actor, never a user. */
export interface TemporaryMaterialReference {
  schemaVersion: 1;
  kind: "cover_letter" | "tailored_resume";
  generationId: string;
  ownerUserId: string;
  applicationId: string;
  version: number;
  contentSha256: string;
  completedAtMs: number;
  expiresAtMs: number;
}

const referenceKeys = [
  "schemaVersion",
  "kind",
  "generationId",
  "ownerUserId",
  "applicationId",
  "version",
  "contentSha256",
  "completedAtMs",
  "expiresAtMs",
] as const;

export function validateTemporaryMaterialReference(
  value: unknown,
): value is TemporaryMaterialReference {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== referenceKeys.length ||
    keys.some((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !referenceKeys.includes(key as (typeof referenceKeys)[number]) ||
        !property?.enumerable ||
        !Object.hasOwn(property, "value")
      );
    })
  )
    return false;
  const ref = value as TemporaryMaterialReference;
  return (
    ref.schemaVersion === 1 &&
    (ref.kind === "cover_letter" || ref.kind === "tailored_resume") &&
    [ref.generationId, ref.ownerUserId, ref.applicationId].every(
      (id) => typeof id === "string" && UUID.test(id),
    ) &&
    Number.isSafeInteger(ref.version) &&
    ref.version > 0 &&
    typeof ref.contentSha256 === "string" &&
    HASH.test(ref.contentSha256) &&
    Number.isSafeInteger(ref.completedAtMs) &&
    ref.completedAtMs >= 0 &&
    Number.isSafeInteger(ref.expiresAtMs) &&
    ref.expiresAtMs <= 8_640_000_000_000_000 &&
    ref.expiresAtMs === ref.completedAtMs + GENERATED_MATERIAL_LIFETIME_MS
  );
}

export function sameTemporaryMaterialReference(
  left: TemporaryMaterialReference,
  right: TemporaryMaterialReference,
): boolean {
  return referenceKeys.every((key) => left[key] === right[key]);
}
