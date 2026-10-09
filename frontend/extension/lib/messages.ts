import { CAPTURE_FIELDS, type CaptureField } from "./job-capture";
import type { JobIntentKind } from "./pending-queue";

export type ExtensionMessage =
  | { action: "application_handoff_read"; reviewLink: string }
  | { action: "application_handoff_copy"; snapshotId: string; fieldKey: string; confirmed: true }
  | { action: "application_handoff_clear" }
  | {
      action:
        | "capture"
        | "clear_queue"
        | "clear_stopped"
        | "login"
        | "logout"
        | "pending"
        | "refresh"
        | "shared_jobs_refresh"
        | "retry"
        | "retry_stopped"
        | "status";
    }
  | { action: "enqueue"; approvedFields: readonly CaptureField[]; intent: JobIntentKind }
  | {
      action: "contribution_refresh" | "trust_refresh" | "withdraw" | "cancel_contribution";
      confirmed?: true;
      contributionId: string;
    }
  | { action: "appeal"; confirmed: true; contributionId: string; evidenceDigestSha256: string };

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function parseExtensionMessage(value: unknown): ExtensionMessage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string") return undefined;
  if (record.action === "application_handoff_read") {
    return Object.keys(record).length === 2 &&
      typeof record.reviewLink === "string" &&
      record.reviewLink.length <= 1024
      ? { action: "application_handoff_read", reviewLink: record.reviewLink }
      : undefined;
  }
  if (record.action === "application_handoff_copy") {
    return Object.keys(record).length === 4 &&
      typeof record.snapshotId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        record.snapshotId,
      ) &&
      typeof record.fieldKey === "string" &&
      /^[a-z][a-z0-9_.-]{1,159}$/u.test(record.fieldKey) &&
      record.confirmed === true
      ? {
          action: "application_handoff_copy",
          snapshotId: record.snapshotId,
          fieldKey: record.fieldKey,
          confirmed: true,
        }
      : undefined;
  }
  if (
    [
      "capture",
      "application_handoff_clear",
      "clear_queue",
      "clear_stopped",
      "login",
      "logout",
      "pending",
      "refresh",
      "shared_jobs_refresh",
      "retry",
      "retry_stopped",
      "status",
    ].includes(record.action)
  ) {
    return Object.keys(record).length === 1
      ? ({ action: record.action } as ExtensionMessage)
      : undefined;
  }
  if (
    ["contribution_refresh", "trust_refresh", "withdraw", "cancel_contribution"].includes(
      record.action,
    )
  ) {
    const mutation = record.action === "withdraw" || record.action === "cancel_contribution";
    const allowed = mutation
      ? ["action", "confirmed", "contributionId"]
      : ["action", "contributionId"];
    if (
      Object.keys(record).some((key) => !allowed.includes(key)) ||
      typeof record.contributionId !== "string" ||
      !UUID_V7.test(record.contributionId) ||
      (mutation && record.confirmed !== true)
    )
      return undefined;
    return {
      action: record.action,
      contributionId: record.contributionId,
      ...(mutation ? { confirmed: true as const } : {}),
    } as ExtensionMessage;
  }
  if (record.action === "appeal") {
    if (
      Object.keys(record).some(
        (key) => !["action", "confirmed", "contributionId", "evidenceDigestSha256"].includes(key),
      ) ||
      record.confirmed !== true ||
      typeof record.contributionId !== "string" ||
      !UUID_V7.test(record.contributionId) ||
      typeof record.evidenceDigestSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record.evidenceDigestSha256)
    )
      return undefined;
    return {
      action: "appeal",
      confirmed: true,
      contributionId: record.contributionId,
      evidenceDigestSha256: record.evidenceDigestSha256,
    };
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
