import type { FieldDefinition, FieldValue } from "./field-policy.js";

export interface VaultSelection {
  id: string;
  version: number;
  fieldKey: string;
  /** Exact candidate-confirmed answer context, never derived from the job's location. */
  context: string;
  /** Observed question structure; the containing packet separately binds the whole form. */
  questionHash: string;
  meaningConfirmed: true;
}

export interface VaultReference {
  id: string;
  version: number;
  context: string;
  questionHash: string;
  meaningConfirmed: true;
  validUntilEpochMs: number | null;
}

export interface VaultCurrentReference {
  id: string;
  version: number;
  fieldKey: string;
  context: string;
  validUntilEpochMs: number | null;
}

export type VaultAdmissionQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;

export type VaultReferenceLocker = (
  ownerUserId: string,
  references: readonly { id: string; version: number; fieldKey: string; context: string }[],
  query: VaultAdmissionQuery,
) => Promise<readonly VaultCurrentReference[]>;

export class VaultBindingsUnavailableError extends Error {
  constructor() {
    super("Saved-answer admission metadata is unavailable");
    this.name = "VaultBindingsUnavailableError";
  }
}

/** Profile read capability only; no direct cross-owner SQL, writes or general-list permission. */
export interface VaultReader {
  lockCurrentReferences?: VaultReferenceLocker;
  readSelectedValue(
    ownerUserId: string,
    reference: { id: string; version: number; fieldKey: string; context: string },
  ): Promise<(VaultCurrentReference & { valueType: string; value: string }) | undefined>;
  readCurrentReference(
    ownerUserId: string,
    reference: { id: string; version: number; fieldKey: string; context: string },
  ): Promise<VaultCurrentReference | undefined>;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export function validVaultReference(reference: VaultReference): boolean {
  return (
    typeof reference.id === "string" &&
    UUID.test(reference.id) &&
    Number.isSafeInteger(reference.version) &&
    reference.version >= 1 &&
    reference.version <= 2_147_483_647 &&
    typeof reference.context === "string" &&
    reference.context.length <= 120 &&
    (reference.context === "" || /\S/u.test(reference.context)) &&
    typeof reference.questionHash === "string" &&
    /^[a-f0-9]{64}$/u.test(reference.questionHash) &&
    reference.meaningConfirmed === true &&
    (reference.validUntilEpochMs === null ||
      (typeof reference.validUntilEpochMs === "number" &&
        Number.isFinite(reference.validUntilEpochMs)))
  );
}

/** Decode only the saved type's exact canonical representation. No trimming, defaulting or guessing. */
export function decodeVaultValue(
  definition: FieldDefinition,
  saved: { valueType: string; value: string },
): FieldValue | undefined {
  if (
    saved.valueType !== definition.valueType ||
    typeof saved.value !== "string" ||
    saved.value.length === 0 ||
    saved.value.length > 3900
  )
    return undefined;
  switch (definition.valueType) {
    case "string":
    case "text":
      return saved.value;
    case "enum":
      return !definition.allowedValues || definition.allowedValues.includes(saved.value)
        ? saved.value
        : undefined;
    case "boolean":
      return saved.value === "true" ? true : saved.value === "false" ? false : undefined;
    case "decimal": {
      const value = Number(saved.value);
      return Number.isFinite(value) && String(value) === saved.value ? value : undefined;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(saved.value)) return undefined;
      const at = new Date(`${saved.value}T00:00:00Z`);
      return Number.isFinite(at.getTime()) && at.toISOString().startsWith(saved.value)
        ? saved.value
        : undefined;
    }
    default:
      return undefined;
  }
}
