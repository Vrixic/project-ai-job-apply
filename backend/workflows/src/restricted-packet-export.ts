import type {
  FieldValue,
  RestrictedPacketExportReader,
  RestrictedPacketExportScope,
} from "@ai-job-apply/applications-service";

const rejected = () => Error("RestrictedPacketExportRejected");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function closed(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw rejected();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    !keys.every((key) => {
      const property = descriptors[key];
      return property?.enumerable && "value" in property;
    })
  )
    throw rejected();
}
function array(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw rejected();
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property?.enumerable || !("value" in property)) throw rejected();
  }
}
function scalar(value: unknown): value is FieldValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
/** Enrich a schema-validated metadata envelope only from the exact private inventory/reader.
 * The private inventory never enters the portable object; no storage bindings or keys are copied. */
export async function enrichRestrictedPacketExport(input: {
  applications: Record<string, unknown>;
  inventory: unknown;
  scope: RestrictedPacketExportScope;
  reader?: RestrictedPacketExportReader;
}): Promise<Record<string, unknown>> {
  try {
    if (input.inventory === undefined) {
      if (input.reader) throw rejected();
      return input.applications;
    }
    closed(input.scope, ["ownerUserId", "exportId", "operationId", "policyVersion"]);
    if (
      ![input.scope.ownerUserId, input.scope.exportId, input.scope.operationId].every(
        (value) => typeof value === "string" && uuid.test(value),
      ) ||
      typeof input.scope.policyVersion !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(input.scope.policyVersion)
    )
      throw rejected();
    closed(input.inventory, ["schemaVersion", "packets"]);
    if (input.inventory.schemaVersion !== 1) throw rejected();
    array(input.inventory.packets);
    for (const item of input.inventory.packets) {
      closed(item, ["applicationId", "packetId", "packetHash", "fieldKeys"]);
      if (
        ![item.applicationId, item.packetId, item.packetHash].every(
          (value) => typeof value === "string",
        )
      )
        throw rejected();
      array(item.fieldKeys);
      if (!item.fieldKeys.every((key) => typeof key === "string")) throw rejected();
    }
    const references = structuredClone(input.inventory.packets);
    const applications = structuredClone(input.applications);
    if (!Array.isArray(applications.packets)) throw rejected();
    const seen = new Set<string>();
    for (const item of references) {
      closed(item, ["applicationId", "packetId", "packetHash", "fieldKeys"]);
      if (
        typeof item.applicationId !== "string" ||
        !uuid.test(item.applicationId) ||
        typeof item.packetId !== "string" ||
        !uuid.test(item.packetId) ||
        seen.has(item.packetId) ||
        typeof item.packetHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(item.packetHash)
      )
        throw rejected();
      array(item.fieldKeys);
      if (
        !item.fieldKeys.length ||
        item.fieldKeys.length > 200 ||
        new Set(item.fieldKeys).size !== item.fieldKeys.length ||
        item.fieldKeys.some(
          (key) =>
            typeof key !== "string" ||
            !/^[a-z][a-z0-9_.]{0,119}$/u.test(key) ||
            key === "documents.resume" ||
            key === "documents.cover_letter",
        )
      )
        throw rejected();
      seen.add(item.packetId);
      const matches = (applications.packets as Array<Record<string, unknown>>).filter(
        (packet) => packet.id === item.packetId,
      );
      const packet = matches[0];
      if (
        matches.length !== 1 ||
        !packet ||
        packet.applicationId !== item.applicationId ||
        packet.packetHash !== item.packetHash ||
        !Array.isArray(packet.fields) ||
        !input.reader
      )
        throw rejected();
      const fields = packet.fields as Array<Record<string, unknown>>;
      for (const key of item.fieldKeys) {
        const matches = fields.filter((field) => field.fieldKey === key);
        if (
          matches.length !== 1 ||
          matches[0]?.value !== null ||
          matches[0]?.requiresReview !== true ||
          matches[0]?.disposition !== "review"
        )
          throw rejected();
      }
      let result:
        | Awaited<ReturnType<RestrictedPacketExportReader["readExportPacketValues"]>>
        | undefined;
      try {
        result = await input.reader.readExportPacketValues({
          ...input.scope,
          applicationId: item.applicationId,
          packetId: item.packetId,
          packetHash: item.packetHash,
        });
        closed(result, ["ownerUserId", "applicationId", "packetId", "packetHash", "values"]);
        if (
          result.ownerUserId !== input.scope.ownerUserId ||
          result.applicationId !== item.applicationId ||
          result.packetId !== item.packetId ||
          result.packetHash !== item.packetHash ||
          !(result.values instanceof Map) ||
          Object.getPrototypeOf(result.values) !== Map.prototype ||
          Reflect.ownKeys(result.values).length !== 0 ||
          result.values.size !== item.fieldKeys.length
        )
          throw rejected();
        for (const key of item.fieldKeys as string[]) {
          const value = result.values.get(key);
          if (!result.values.has(key) || !scalar(value)) throw rejected();
          const field = fields.find((field) => field.fieldKey === key);
          if (!field) throw rejected();
          field.value = value;
        }
      } finally {
        const property = result && Object.getOwnPropertyDescriptor(result, "values");
        if (property && "value" in property && property.value instanceof Map)
          Map.prototype.clear.call(property.value);
      }
    }
    return applications;
  } catch {
    throw rejected();
  }
}
