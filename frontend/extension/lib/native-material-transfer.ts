import type {
  ApplicationNativeTransferAdmission,
  ApplicationNativeTransferReceipt,
  ApplicationTemporaryMaterial,
} from "@ai-job-apply/api-contracts";
import {
  validateApplicationCoverLetterFile,
  validateApplicationNativeTransferAdmission,
  validateApplicationNativeTransferBegin,
  validateApplicationNativeTransferCancel,
  validateApplicationNativeTransferCommit,
  validateApplicationNativeTransferDiscard,
  validateApplicationResumeFile,
} from "@ai-job-apply/api-contracts/browser-validators";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { parseHandoffLink } from "./application-handoff";
import { providerForUrl } from "./providers";
import { sameNativeTransferBinding as same } from "./native-transfer-binding";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeMaterialTransferUnavailable");

/** Largest original file attached automatically; mirrors the contract's uploaded-resume limit. */
export const UPLOADED_RESUME_MAXIMUM_BYTES = 2 * 1024 * 1024;
/** How long an uploaded original may stay in this worker's memory after it is pulled. */
const UPLOADED_RESUME_LEASE_MS = 10 * 60_000;

export interface NativeTransferSelection {
  applicationId: string;
  packetId: string;
  packetHash: string;
  approvalId: string;
  revision: number;
  approvalExpiresAtMs: number;
  materials: ApplicationTemporaryMaterial[];
  /** Bound when the packet carries the candidate's own uploaded resume instead of a generated one. */
  uploadedResume?: { documentId: string; sha256: string };
  reviewLink: string;
  jobId: string;
  ownerFence: string;
  tabId: number;
  documentId: string;
  employerUrl: string;
  variantId: string;
}

export interface TransferredNativeFile {
  kind: "tailored_resume" | "cover_letter" | "uploaded_resume";
  /** Generated kinds only; the candidate's own original has no generation. */
  generationId?: string;
  /** Generated files are PDF only; an uploaded original keeps its format. */
  format: "pdf" | "docx";
  mediaType: string;
  sha256: string;
  bytes: Uint8Array;
}

function boundedMessage(value: unknown, maxBytes: number): unknown {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maxBytes)
    throw unavailable();
  return JSON.parse(text);
}

/** One memory-only selection/nonce/file inventory. No browser storage or native credential. */
export function createNativeMaterialTransfer(options: {
  webOrigin: string;
  registry: AdapterRegistry;
  /** Owning composition must recheck account, packet, material, job and destination document. */
  revalidate(selection: Readonly<NativeTransferSelection>, signal: AbortSignal): Promise<void>;
}) {
  const origin = new URL(options.webOrigin);
  if (origin.protocol !== "https:" || origin.origin !== options.webOrigin) throw unavailable();
  let current:
    | {
        selection: NativeTransferSelection;
        phase: "selected" | "admitting" | "admitted" | "committing" | "ready" | "consumed";
        controller: AbortController;
        admission?: ApplicationNativeTransferAdmission;
        receipt?: ApplicationNativeTransferReceipt;
        sender?: { tabId: number; documentId: string };
        files: TransferredNativeFile[];
        deadline: number;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  function clear() {
    const prior = current;
    current = undefined;
    if (!prior) return;
    clearTimeout(prior.timer);
    prior.controller.abort();
    for (const file of prior.files) file.bytes.fill(0);
    prior.files.length = 0;
  }
  function active(state: NonNullable<typeof current>) {
    return (
      current === state &&
      !state.controller.signal.aborted &&
      Date.now() < state.deadline &&
      (() => {
        const provider = providerForUrl(state.selection.employerUrl);
        return (
          provider !== undefined &&
          options.registry.status(provider.adapterId, state.selection.variantId, new Date())
            .mode === "autofill"
        );
      })()
    );
  }
  function senderMatches(state: NonNullable<typeof current>, sender: chrome.runtime.MessageSender) {
    const link = sender.url ? parseHandoffLink(sender.url, options.webOrigin) : undefined;
    return (
      !sender.id &&
      !sender.nativeApplication &&
      sender.origin === options.webOrigin &&
      sender.frameId === 0 &&
      sender.documentLifecycle === "active" &&
      Number.isSafeInteger(sender.tab?.id) &&
      (sender.tab?.id ?? -1) >= 0 &&
      !sender.tab?.incognito &&
      typeof sender.documentId === "string" &&
      UUID.test(sender.documentId) &&
      link?.href === state.selection.reviewLink &&
      link?.applicationId === state.selection.applicationId &&
      link?.jobId === state.selection.jobId &&
      (!state.sender ||
        (state.sender.tabId === sender.tab?.id && state.sender.documentId === sender.documentId))
    );
  }
  async function fresh(state: NonNullable<typeof current>) {
    if (!active(state)) throw unavailable();
    let cancel: (() => void) | undefined;
    const stopped = new Promise<never>((_, reject) => {
      cancel = () => reject(unavailable());
    });
    const abort = () => cancel?.();
    state.controller.signal.addEventListener("abort", abort, { once: true });
    if (state.controller.signal.aborted) abort();
    try {
      await Promise.race([
        options.revalidate(structuredClone(state.selection), state.controller.signal),
        stopped,
      ]);
      if (!active(state)) throw unavailable();
    } finally {
      state.controller.signal.removeEventListener("abort", abort);
    }
  }
  function reschedule(state: NonNullable<typeof current>, deadline: number) {
    clearTimeout(state.timer);
    state.deadline = deadline;
    state.timer = setTimeout(
      () => {
        if (current === state) clear();
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  return {
    /** Called only by a trusted extension selection action, never from external messages. */
    select(value: NativeTransferSelection) {
      clear();
      const selection = structuredClone(value);
      const now = Date.now();
      const deadline = Math.min(
        now + 60_000,
        selection.approvalExpiresAtMs,
        ...selection.materials.map((material) => material.expiresAtMs),
      );
      const uploadedOnly = selection.materials.length === 0;
      if (
        uploadedOnly
          ? !selection.uploadedResume ||
            !UUID.test(selection.uploadedResume.documentId) ||
            !/^[a-f0-9]{64}$/u.test(selection.uploadedResume.sha256)
          : selection.uploadedResume !== undefined
      )
        throw unavailable();
      const probe = {
        schema: "application-native-transfer-admission.v1",
        nonce: "a".repeat(64),
        expiresAtMs: deadline,
        applicationId: selection.applicationId,
        packetId: selection.packetId,
        packetHash: selection.packetHash,
        approvalId: selection.approvalId,
        revision: selection.revision,
        format: "pdf",
        materials: selection.materials,
      };
      if (
        (!uploadedOnly && !validateApplicationNativeTransferAdmission(probe)) ||
        !Number.isFinite(deadline) ||
        now >= deadline ||
        !UUID.test(selection.documentId) ||
        !Number.isSafeInteger(selection.tabId) ||
        selection.tabId < 0 ||
        !providerForUrl(selection.employerUrl) ||
        !selection.ownerFence ||
        selection.ownerFence.length > 256 ||
        parseHandoffLink(selection.reviewLink, options.webOrigin)?.jobId !== selection.jobId ||
        parseHandoffLink(selection.reviewLink, options.webOrigin)?.applicationId !==
          selection.applicationId ||
        new Set(selection.materials.map((material) => material.kind)).size !==
          selection.materials.length ||
        new Set(selection.materials.map((material) => material.generationId)).size !==
          selection.materials.length ||
        selection.materials.some(
          (material) =>
            material.completedAtMs > now ||
            material.expiresAtMs !== material.completedAtMs + 1_800_000,
        )
      )
        throw unavailable();
      const controller = new AbortController();
      const state = {
        selection,
        phase: "selected" as const,
        controller,
        files: [],
        deadline,
        timer: setTimeout(
          () => {
            if (current === state) clear();
          },
          Math.max(0, deadline - now),
        ),
      };
      current = state;
    },
    async begin(input: unknown, sender: chrome.runtime.MessageSender) {
      const value = boundedMessage(input, 4096);
      const state = current;
      if (
        state?.phase !== "selected" ||
        state.selection.materials.length === 0 ||
        !active(state) ||
        !senderMatches(state, sender) ||
        !validateApplicationNativeTransferBegin(value) ||
        value.applicationId !== state.selection.applicationId ||
        value.packetId !== state.selection.packetId ||
        value.packetHash !== state.selection.packetHash
      )
        throw unavailable();
      state.phase = "admitting";
      state.sender = { tabId: sender.tab?.id ?? -1, documentId: sender.documentId ?? "" };
      try {
        await fresh(state);
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const nonce = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        bytes.fill(0);
        const selection = state.selection;
        const admission: ApplicationNativeTransferAdmission = {
          schema: "application-native-transfer-admission.v1",
          nonce,
          expiresAtMs: state.deadline,
          applicationId: selection.applicationId,
          packetId: selection.packetId,
          packetHash: selection.packetHash,
          approvalId: selection.approvalId,
          revision: selection.revision,
          format: value.format,
          materials: structuredClone(selection.materials),
        };
        state.admission = admission;
        state.phase = "admitted";
        return structuredClone(admission);
      } catch {
        if (current === state) clear();
        throw unavailable();
      }
    },
    async commit(input: unknown, sender: chrome.runtime.MessageSender) {
      const value = boundedMessage(input, 850_000);
      const state = current;
      if (
        state?.phase !== "admitted" ||
        !active(state) ||
        !senderMatches(state, sender) ||
        !validateApplicationNativeTransferCommit(value) ||
        !same(value.admission, state.admission)
      )
        throw unavailable();
      // Synchronously spend the nonce before any asynchronous owner check or byte hashing.
      state.phase = "committing";
      const files: TransferredNativeFile[] = [];
      state.files = files;
      try {
        await fresh(state);
        if (value.files.length !== state.selection.materials.length) throw unavailable();
        let totalBytes = 0;
        for (const file of value.files) {
          const material = file.temporaryMaterial;
          const expected = state.selection.materials.find(
            (candidate) => candidate.kind === material.kind,
          );
          if (
            !expected ||
            !same(material, expected) ||
            files.some((prior) => prior.kind === material.kind) ||
            file.format !== value.admission.format ||
            file.contentSha256 !== material.contentSha256 ||
            !(material.kind === "tailored_resume"
              ? validateApplicationResumeFile(file)
              : validateApplicationCoverLetterFile(file)) ||
            file.mediaType !==
              (file.format === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
          )
            throw unavailable();
          const bytes = Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
          );
          file.contentBase64 = "";
          const owned: TransferredNativeFile = {
            kind: material.kind,
            generationId: material.generationId,
            format: file.format,
            mediaType: file.mediaType,
            sha256: file.sha256,
            bytes,
          };
          files.push(owned);
          totalBytes += bytes.byteLength;
          if (
            bytes.byteLength !== file.sizeBytes ||
            totalBytes > 600_000 ||
            (file.format === "pdf"
              ? new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
              : bytes[0] !== 0x50 || bytes[1] !== 0x4b)
          )
            throw unavailable();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          digest.fill(0);
          if (!active(state) || hash !== file.sha256) throw unavailable();
        }
        await fresh(state);
        const expiresAtMs = Math.min(
          state.selection.approvalExpiresAtMs,
          ...state.selection.materials.map((material) => material.expiresAtMs),
        );
        if (Date.now() >= expiresAtMs) throw unavailable();
        const receipt: ApplicationNativeTransferReceipt = {
          schema: "application-native-transfer-receipt.v1",
          nonce: value.admission.nonce,
          expiresAtMs,
          applicationId: state.selection.applicationId,
          packetId: state.selection.packetId,
          packetHash: state.selection.packetHash,
        };
        state.files = files;
        state.receipt = receipt;
        state.phase = "ready";
        reschedule(state, expiresAtMs);
        return structuredClone(receipt);
      } catch {
        for (const file of files) file.bytes.fill(0);
        if (current === state) clear();
        throw unavailable();
      } finally {
        for (const file of value.files) file.contentBase64 = "";
      }
    },
    /**
     * Private composition only. The candidate's own original, pulled with the extension's own
     * session, becomes the ready file for an uploaded-resume selection. It is held in memory for a
     * short lease, never beyond the approval, and is cleared with the selection.
     */
    attachUploaded(selection: Readonly<NativeTransferSelection>, file: TransferredNativeFile) {
      const state = current;
      const uploaded = state?.selection.uploadedResume;
      if (
        state?.phase !== "selected" ||
        !active(state) ||
        !uploaded ||
        !same(state.selection, selection) ||
        file.kind !== "uploaded_resume" ||
        file.generationId !== undefined ||
        file.sha256 !== uploaded.sha256 ||
        file.bytes.byteLength < 1 ||
        file.bytes.byteLength > UPLOADED_RESUME_MAXIMUM_BYTES
      )
        throw unavailable();
      state.files = [file];
      state.phase = "ready";
      reschedule(
        state,
        Math.min(state.selection.approvalExpiresAtMs, Date.now() + UPLOADED_RESUME_LEASE_MS),
      );
    },
    cancel(input: unknown, sender: chrome.runtime.MessageSender) {
      const value = boundedMessage(input, 4096);
      const state = current;
      if (
        !state ||
        !senderMatches(state, sender) ||
        !validateApplicationNativeTransferCancel(value) ||
        !same(value.admission, state.admission)
      )
        throw unavailable();
      clear();
    },
    discard(input: unknown, sender: chrome.runtime.MessageSender) {
      const value = boundedMessage(input, 4096);
      const state = current;
      if (
        !state ||
        !senderMatches(state, sender) ||
        !validateApplicationNativeTransferDiscard(value) ||
        !same(value.receipt, state.receipt)
      )
        throw unavailable();
      clear();
    },
    /** Private owning executor only; never returned through runtime messages or popup snapshots. */
    consume(receipt: ApplicationNativeTransferReceipt) {
      const state = current;
      if (state?.phase !== "ready" || !active(state) || !same(receipt, state.receipt))
        throw unavailable();
      state.phase = "consumed";
      return {
        files: state.files,
        signal: state.controller.signal,
        deadline: state.deadline,
        selection: structuredClone(state.selection),
        dispose: () => {
          if (current === state) clear();
        },
      };
    },
    /** Trusted owning Apply consumes private ready state; no receipt is exposed to the popup. */
    consumeSelected(reviewLink: string) {
      const state = current;
      if (state?.phase !== "ready" || !active(state) || state.selection.reviewLink !== reviewLink)
        throw unavailable();
      state.phase = "consumed";
      return {
        files: state.files,
        signal: state.controller.signal,
        deadline: state.deadline,
        selection: structuredClone(state.selection),
        dispose: () => {
          if (current === state) clear();
        },
      };
    },
    /** Browser navigation/removal and extension identity/cancel hooks own this invalidation. */
    documentChanged(tabId: number) {
      if (current && (current.selection.tabId === tabId || current.sender?.tabId === tabId))
        clear();
    },
    clear,
  };
}
