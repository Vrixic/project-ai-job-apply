import type { ApplicationExecutionCommand, ApplicationPacket } from "@ai-job-apply/api-contracts";

type CommandField = ApplicationExecutionCommand["fields"][number];

/**
 * The fields an execution command may carry: only immutable, approved, non-restricted values, each
 * flagged when it still needs the candidate. A full name is composed from the approved first and
 * last name for pages that ask for one "Name" field (ADR-053); it adds no new candidate fact.
 */
export function commandFieldsFromPacket(packet: Pick<ApplicationPacket, "fields">): CommandField[] {
  const fields: CommandField[] = packet.fields
    .filter(
      (field) =>
        field.origin !== "answer_vault" &&
        !field.reasons.includes("restricted_answer") &&
        !/^(?:authorization|demographic|disclosure|attestation|signature|challenge|captcha|mfa|documents?)\./u.test(
          field.fieldKey,
        ),
    )
    .map((field) => ({
      fieldKey: field.fieldKey,
      value: field.value,
      needsUserAction:
        field.disposition === "user_action" ||
        field.reasons.includes("direct_user_action") ||
        field.origin === "generated",
    }));
  const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const first = byKey.get("identity.legal_name.first");
  const last = byKey.get("identity.legal_name.last");
  if (
    first &&
    last &&
    !first.needsUserAction &&
    !last.needsUserAction &&
    typeof first.value === "string" &&
    typeof last.value === "string" &&
    first.value.trim() &&
    last.value.trim() &&
    !byKey.has("identity.legal_name.full")
  )
    fields.push({
      fieldKey: "identity.legal_name.full",
      value: `${first.value.trim()} ${last.value.trim()}`,
      needsUserAction: false,
    });
  // A preferred first name nobody saved is the first name itself: no new candidate fact.
  if (
    first &&
    !first.needsUserAction &&
    typeof first.value === "string" &&
    first.value.trim() &&
    !byKey.has("identity.preferred_name")
  )
    fields.push({
      fieldKey: "identity.preferred_name",
      value: first.value.trim(),
      needsUserAction: false,
    });
  return fields;
}
