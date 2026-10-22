import type {
  ApplicationApplyIntent,
  ApplicationNativeTransferAdmission,
  ApplicationNativeTransferBegin,
  ApplicationNativeTransferCommit,
  ApplicationNativeTransferReceipt,
  ApplicationTemporaryMaterial,
} from "@ai-job-apply/api-contracts";
import {
  validateApplicationApplyIntentReceipt,
  validateApplicationNativeTransferAdmission,
  validateApplicationNativeTransferCommit,
  validateApplicationNativeTransferReceipt,
} from "@ai-job-apply/api-contracts/browser-validators";
import { materialDeadline, sameMaterial } from "./application-material-lifetime";
import { sha256OfBytes } from "./applications-client";
import { readNativeMaterial } from "./native-material-client";

const unavailable = () => Error("NativeExtensionTransferUnavailable");
const EXTENSION_ID = /^[a-p]{32}$/u;

export function nativeExtensionId(): string | undefined {
  if (process.env.NEXT_PUBLIC_APPLICATION_EXTENSION_TRANSFER_ENABLED !== "true") return undefined;
  const value = process.env.NEXT_PUBLIC_APPLICATION_EXTENSION_ID ?? "";
  return EXTENSION_ID.test(value) ? value : undefined;
}

export function nativeExtensionMessenger(): NativeExtensionMessenger | undefined {
  if (typeof window === "undefined") return undefined;
  const runtime = (window as Window & { chrome?: { runtime?: NativeExtensionMessenger } }).chrome
    ?.runtime;
  return typeof runtime?.sendMessage === "function" ? runtime : undefined;
}

/** The website selects one installed extension explicitly; there is no discovery or token bridge. */
export interface NativeExtensionMessenger {
  sendMessage(extensionId: string, message: unknown, callback: (value: unknown) => void): void;
  lastError?: { message?: string };
}

function bounded(value: unknown, maximum: number): unknown {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maximum)
    throw unavailable();
  return JSON.parse(text);
}

function send(
  messenger: NativeExtensionMessenger,
  extensionId: string,
  value: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(unavailable());
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      messenger.sendMessage(extensionId, value, (response) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted || messenger.lastError) return reject(unavailable());
        try {
          resolve(bounded(response, 4096));
        } catch {
          reject(unavailable());
        }
      });
    } catch {
      signal.removeEventListener("abort", abort);
      reject(unavailable());
    }
  });
}

/**
 * Arms the extension when the candidate presses Apply. Identifiers only: no credential, file,
 * answer or URL. The extension reads the packet itself with its own session. Returns the deadline
 * until which it holds the identifiers, or nothing when no extension answered.
 */
export async function sendApplyIntent(options: {
  extensionId: string;
  messenger: NativeExtensionMessenger;
  intent: Omit<ApplicationApplyIntent, "schema">;
  signal: AbortSignal;
}): Promise<{ expiresAtMs: number } | undefined> {
  if (!EXTENSION_ID.test(options.extensionId)) return undefined;
  try {
    const answer = await send(
      options.messenger,
      options.extensionId,
      { schema: "application-apply-intent.v1", ...options.intent },
      options.signal,
    );
    return validateApplicationApplyIntentReceipt(answer)
      ? { expiresAtMs: answer.expiresAtMs }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Explicit candidate action only. Transfer acknowledgement is never ATS submission evidence. */
export async function transferApprovedNativeMaterials(options: {
  extensionId: string;
  messenger: NativeExtensionMessenger;
  binding: {
    applicationId: string;
    packetId: string;
    packetHash: string;
    approvalId: string;
    revision: number;
    approvalExpiresAtMs: number;
    materials: readonly ApplicationTemporaryMaterial[];
  };
  /** The name the attached resume carries on the employer's page, instead of the generator's. */
  resumeFileName?: string;
  /** The mounted workspace's current account/packet/approval must still match. */
  isCurrent(): boolean;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Promise<ApplicationNativeTransferReceipt> {
  const binding = structuredClone(options.binding);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const now = Date.now();
  const deadline = Math.min(
    now + 60_000,
    binding.approvalExpiresAtMs,
    ...binding.materials.map(materialDeadline),
  );
  const files: ApplicationNativeTransferCommit["files"] = [];
  let transport: ApplicationNativeTransferCommit | undefined;
  const buffers: Uint8Array[] = [];
  const wipe = () => {
    for (const bytes of buffers) bytes.fill(0);
    for (const file of files) file.contentBase64 = "";
    for (const file of transport?.files ?? []) file.contentBase64 = "";
  };
  controller.signal.addEventListener("abort", wipe, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadline - now));
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const current = () => !controller.signal.aborted && options.isCurrent() && Date.now() < deadline;
  let receipt: ApplicationNativeTransferReceipt | undefined;
  let admission: ApplicationNativeTransferAdmission | undefined;
  try {
    if (
      !EXTENSION_ID.test(options.extensionId) ||
      !Number.isFinite(deadline) ||
      !current() ||
      binding.materials.length < 1 ||
      binding.materials.length > 2 ||
      new Set(binding.materials.map((material) => material.kind)).size !==
        binding.materials.length ||
      binding.materials.some((material) => material.completedAtMs > now)
    )
      throw unavailable();
    const begin: ApplicationNativeTransferBegin = {
      schema: "application-native-transfer-begin.v1",
      applicationId: binding.applicationId,
      packetId: binding.packetId,
      packetHash: binding.packetHash,
      format: "pdf",
    };
    const answer = await send(options.messenger, options.extensionId, begin, controller.signal);
    if (!current() || !validateApplicationNativeTransferAdmission(answer)) throw unavailable();
    admission = answer;
    if (
      admission.applicationId !== binding.applicationId ||
      admission.packetId !== binding.packetId ||
      admission.packetHash !== binding.packetHash ||
      admission.approvalId !== binding.approvalId ||
      admission.revision !== binding.revision ||
      admission.format !== "pdf" ||
      admission.expiresAtMs <= Date.now() ||
      admission.expiresAtMs > deadline ||
      admission.materials.length !== binding.materials.length ||
      admission.materials.some(
        (material, index) => !sameMaterial(material, binding.materials[index]),
      )
    )
      throw unavailable();
    // An earlier extension nonce deadline can only shorten this website operation.
    clearTimeout(timer);
    const admissionTimer = setTimeout(abort, Math.max(0, admission.expiresAtMs - Date.now()));
    try {
      for (const material of admission.materials) {
        if (!current() || Date.now() >= admission.expiresAtMs) throw unavailable();
        const value = await readNativeMaterial(
          {
            applicationId: binding.applicationId,
            packetId: binding.packetId,
            packetHash: binding.packetHash,
            material,
          },
          "pdf",
          {
            signal: controller.signal,
            ...(options.fetch ? { fetch: options.fetch } : {}),
          },
        );
        if (!("contentBase64" in value) || !value.temporaryMaterial || value.format !== "pdf")
          throw unavailable();
        const file: ApplicationNativeTransferCommit["files"][number] = {
          ...value,
          format: "pdf",
          mediaType: "application/pdf",
          temporaryMaterial: value.temporaryMaterial,
          ...(material.kind === "tailored_resume" && options.resumeFileName
            ? { fileName: options.resumeFileName }
            : {}),
        };
        value.contentBase64 = "";
        files.push(file);
        const bytes = Uint8Array.from(atob(file.contentBase64), (character) =>
          character.charCodeAt(0),
        );
        buffers.push(bytes);
        if (
          !current() ||
          Date.now() >= admission.expiresAtMs ||
          bytes.byteLength !== file.sizeBytes ||
          new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" ||
          (await sha256OfBytes(bytes)) !== file.sha256 ||
          !current()
        )
          throw unavailable();
        bytes.fill(0);
      }
      const commit: ApplicationNativeTransferCommit = {
        schema: "application-native-transfer-commit.v1",
        admission,
        files,
      };
      if (
        !current() ||
        Date.now() >= admission.expiresAtMs ||
        !validateApplicationNativeTransferCommit(commit)
      )
        throw unavailable();
      transport = bounded(commit, 850_000) as ApplicationNativeTransferCommit;
      const response = await send(
        options.messenger,
        options.extensionId,
        transport,
        controller.signal,
      );
      if (!validateApplicationNativeTransferReceipt(response)) throw unavailable();
      receipt = response;
      const expectedExpiry = Math.min(
        binding.approvalExpiresAtMs,
        ...binding.materials.map(materialDeadline),
      );
      if (
        !current() ||
        Date.now() >= admission.expiresAtMs ||
        receipt.nonce !== admission.nonce ||
        receipt.applicationId !== binding.applicationId ||
        receipt.packetId !== binding.packetId ||
        receipt.packetHash !== binding.packetHash ||
        receipt.expiresAtMs !== expectedExpiry
      )
        throw unavailable();
      return receipt;
    } finally {
      clearTimeout(admissionTimer);
    }
  } catch {
    if (receipt) discardTransferredNativeMaterials(options.messenger, options.extensionId, receipt);
    if (admission) {
      try {
        options.messenger.sendMessage(
          options.extensionId,
          { schema: "application-native-transfer-cancel.v1", admission },
          () => void options.messenger.lastError,
        );
      } catch {
        // A missing receiver still owns its original expiry and navigation cleanup.
      }
    }
    throw unavailable();
  } finally {
    controller.abort();
    wipe();
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
  }
}

/** Best-effort withdrawal; the extension independently enforces navigation and original expiry. */
export function discardTransferredNativeMaterials(
  messenger: NativeExtensionMessenger,
  extensionId: string,
  receipt: ApplicationNativeTransferReceipt,
) {
  if (!EXTENSION_ID.test(extensionId) || !validateApplicationNativeTransferReceipt(receipt)) return;
  try {
    messenger.sendMessage(
      extensionId,
      { schema: "application-native-transfer-discard.v1", receipt },
      () => void messenger.lastError,
    );
  } catch {
    // No retry or provider effect. The receiving extension owns its independent disposal timer.
  }
}

/**
 * Retries the one-use admission until the candidate has opened the extension on the employer page
 * and it has selected this application, or the window closes. Each attempt is a complete, fresh
 * transfer; nothing is retained between attempts and no attempt widens any original deadline.
 */
export async function transferWhenSelected(
  options: Parameters<typeof transferApprovedNativeMaterials>[0] & {
    giveUpAtMs: number;
    retryEveryMs?: number;
  },
): Promise<ApplicationNativeTransferReceipt> {
  const { giveUpAtMs, retryEveryMs = 2_000, ...transfer } = options;
  for (;;) {
    try {
      return await transferApprovedNativeMaterials(transfer);
    } catch (error) {
      if (transfer.signal.aborted || Date.now() + retryEveryMs >= giveUpAtMs) throw error;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, retryEveryMs);
        transfer.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (transfer.signal.aborted) throw unavailable();
    }
  }
}
