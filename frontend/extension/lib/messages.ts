import { CAPTURE_FIELDS, type CaptureField } from "./job-capture";
import type { JobIntentKind } from "./pending-queue";

export type ExtensionMessage =
  | { action: "capture" | "login" | "logout" | "pending" | "refresh" | "retry" | "status" }
  | { action: "enqueue"; approvedFields: readonly CaptureField[]; intent: JobIntentKind };

export function parseExtensionMessage(value: unknown): ExtensionMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string") return undefined;
  if (
    ["capture", "login", "logout", "pending", "refresh", "retry", "status"].includes(record.action)
  ) {
    return Object.keys(record).length === 1
      ? ({ action: record.action } as ExtensionMessage)
      : undefined;
  }
  if (
    record.action !== "enqueue" ||
    (record.intent !== "private_save" && record.intent !== "contribute") ||
    !Array.isArray(record.approvedFields) ||
    record.approvedFields.some(
      (field) => typeof field !== "string" || !CAPTURE_FIELDS.includes(field as CaptureField),
    ) ||
    Object.keys(record).some((key) => !["action", "approvedFields", "intent"].includes(key))
  ) {
    return undefined;
  }
  return {
    action: "enqueue",
    approvedFields: [...new Set(record.approvedFields as CaptureField[])],
    intent: record.intent,
  };
}
