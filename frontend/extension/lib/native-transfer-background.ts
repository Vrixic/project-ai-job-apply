import {
  validateApplication,
  validateApplicationApplyIntent,
  validateApplicationUploadedResumeFile,
} from "@ai-job-apply/api-contracts/browser-validators";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { executeApprovedApplication } from "./application-executor";
import { parseHandoffLink, readApprovedHandoff, readJson } from "./application-handoff";
import { greenhouseApplicationIdentity } from "./greenhouse/inspect";
import {
  createNativeMaterialTransfer,
  type NativeTransferSelection,
  type TransferredNativeFile,
  UPLOADED_RESUME_MAXIMUM_BYTES,
} from "./native-material-transfer";
import { sameNativeTransferBinding } from "./native-transfer-binding";

const unavailable = () => Error("NativeMaterialTransferUnavailable");

/** Composition is installed only in the separate execution build. No provider or token transport. */
export function installNativeTransferBackground(options: {
  webOrigin: string;
  apiOrigin: string;
  registry: AdapterRegistry;
  identity(signal: AbortSignal): Promise<{ accessToken: string; identityFence: string }>;
}) {
  let generation = 0;
  let selecting: AbortController | undefined;
  // Identifiers only, in memory only. The packet itself is always re-read with the extension's own
  // session; this just lets the popup find the application without a pasted link.
  let intent:
    | {
        reviewLink: string;
        applicationId: string;
        jobId: string;
        packetId: string;
        packetHash: string;
        deadline: number;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  // The popup-facing part (link and deadline only) also lives in session storage so a restarted
  // service worker does not forget a pending Apply. It is cleared with the in-memory copy.
  const intentStorageKey = "applicationApplyIntent";
  function clearIntent() {
    if (intent) clearTimeout(intent.timer);
    intent = undefined;
    try {
      void chrome.storage.session?.remove(intentStorageKey)?.catch(() => undefined);
    } catch {
      // Session storage is a convenience; the in-memory state is authoritative.
    }
  }
  function rememberIntent(reviewLink: string, deadline: number) {
    try {
      void chrome.storage.session
        ?.set({ [intentStorageKey]: { reviewLink, deadline } })
        ?.catch(() => undefined);
    } catch {
      // See above.
    }
  }
  async function restoredIntent(): Promise<{ reviewLink: string; deadline: number } | undefined> {
    try {
      const stored = (await chrome.storage.session?.get(intentStorageKey))?.[intentStorageKey] as
        | { reviewLink?: unknown; deadline?: unknown }
        | undefined;
      return typeof stored?.reviewLink === "string" &&
        typeof stored.deadline === "number" &&
        Date.now() < stored.deadline
        ? { reviewLink: stored.reviewLink, deadline: stored.deadline }
        : undefined;
    } catch {
      return undefined;
    }
  }
  const transfer = createNativeMaterialTransfer({
    webOrigin: options.webOrigin,
    registry: options.registry,
    async revalidate(selection, signal) {
      const proof = await protectedSelection(
        selection.reviewLink,
        selection.tabId,
        signal,
        selection.documentId,
      );
      if (!sameNativeTransferBinding(proof, selection)) throw unavailable();
    },
  });

  function clear() {
    generation++;
    selecting?.abort();
    selecting = undefined;
    clearIntent();
    transfer.clear();
  }

  /** Pulls the candidate's own original with the extension's session and verifies it exactly. */
  async function pullUploadedResume(
    selected: NativeTransferSelection,
    signal: AbortSignal,
  ): Promise<TransferredNativeFile> {
    const uploaded = selected.uploadedResume;
    if (!uploaded) throw unavailable();
    const session = await options.identity(signal);
    if (session.identityFence !== selected.ownerFence || signal.aborted) throw unavailable();
    const value = await readJson(
      new URL(`/v1/applications/${selected.applicationId}/resume/uploaded`, options.apiOrigin),
      session.accessToken,
      signal,
      3_800_000,
    );
    if (
      !validateApplicationUploadedResumeFile(value) ||
      value.documentId !== uploaded.documentId ||
      value.sha256 !== uploaded.sha256 ||
      value.sizeBytes > UPLOADED_RESUME_MAXIMUM_BYTES ||
      value.mediaType !==
        (value.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    )
      throw unavailable();
    const bytes = Uint8Array.from(atob(value.contentBase64), (character) =>
      character.charCodeAt(0),
    );
    value.contentBase64 = "";
    try {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      digest.fill(0);
      if (
        signal.aborted ||
        bytes.byteLength !== value.sizeBytes ||
        hash !== uploaded.sha256 ||
        (value.format === "pdf"
          ? new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
          : bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      )
        throw unavailable();
    } catch {
      bytes.fill(0);
      throw unavailable();
    }
    return {
      kind: "uploaded_resume",
      format: value.format,
      mediaType: value.mediaType,
      sha256: value.sha256,
      bytes,
    };
  }

  async function protectedSelection(
    reviewLink: string,
    tabId: number,
    signal: AbortSignal,
    documentId?: string,
  ): Promise<NativeTransferSelection> {
    const link = parseHandoffLink(reviewLink, options.webOrigin);
    const tab = await chrome.tabs.get(tabId);
    if (
      !link ||
      !tab.url ||
      tab.incognito ||
      !greenhouseApplicationIdentity(tab.url) ||
      signal.aborted
    )
      throw unavailable();
    const session = await options.identity(signal);
    const snapshot = await readApprovedHandoff(
      link,
      tab.url,
      options.apiOrigin,
      session.accessToken,
      signal,
    );
    const application = await readJson(
      new URL(`/v1/applications/${link.applicationId}`, options.apiOrigin),
      session.accessToken,
      signal,
    );
    const packet = validateApplication(application) ? application.currentPacket : undefined;
    const approval = validateApplication(application) ? application.approval : undefined;
    if (
      !validateApplication(application) ||
      !packet ||
      !approval ||
      application.id !== link.applicationId ||
      application.canonicalJobId !== link.jobId ||
      application.revision !== snapshot.revision ||
      packet.packetHash !== snapshot.packetHash ||
      approval.id !== snapshot.approvalId ||
      application.currentAction !== "ready_to_submit"
    )
      throw unavailable();
    const documents = await chrome.scripting.executeScript({
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] },
      func: () => ({ url: location.href, topFrame: window.top === window }),
    });
    const captured = documents[0];
    const identity = await options.identity(signal);
    const current = await chrome.tabs.get(tabId);
    if (
      signal.aborted ||
      documents.length !== 1 ||
      captured?.frameId !== 0 ||
      !captured.documentId ||
      (documentId && captured.documentId !== documentId) ||
      !captured.result?.topFrame ||
      captured.result.url !== tab.url ||
      current.url !== tab.url ||
      current.incognito ||
      identity.identityFence !== session.identityFence ||
      Date.now() >= snapshot.deadline
    )
      throw unavailable();
    const materials = packet.temporaryMaterials ?? [];
    // The packet, never the website, says which resume to use: a generated file bound to its
    // original generation, otherwise the candidate's own uploaded original bound by its digest.
    const resumeField = packet.fields.find((field) => field.fieldKey === "documents.resume");
    const uploadedDocumentId = resumeField?.sourceFactIds[0];
    const uploadedResume =
      !materials.length &&
      packet.artifactHashes.resume &&
      resumeField?.origin === "confirmed_fact" &&
      resumeField.value === packet.artifactHashes.resume &&
      uploadedDocumentId
        ? { documentId: uploadedDocumentId, sha256: packet.artifactHashes.resume }
        : undefined;
    if (!materials.length && !uploadedResume) throw unavailable();
    return {
      applicationId: application.id,
      packetId: packet.id,
      packetHash: packet.packetHash,
      approvalId: approval.id,
      revision: application.revision,
      approvalExpiresAtMs: Date.parse(approval.expiresAt),
      materials,
      ...(uploadedResume ? { uploadedResume } : {}),
      reviewLink: link.href,
      jobId: link.jobId,
      ownerFence: identity.identityFence,
      tabId,
      documentId: captured.documentId,
      employerUrl: tab.url,
      variantId: "greenhouse-standard-v1",
    };
  }

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined || change.status === "loading") transfer.documentChanged(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => transfer.documentChanged(tabId));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && Object.hasOwn(changes, "auth0Session")) clear();
  });
  chrome.runtime.onMessageExternal.addListener((message: unknown, sender, respond) => {
    const schema =
      message && typeof message === "object" && "schema" in message ? message.schema : undefined;
    if (schema === "application-apply-intent.v1") {
      void (async () => {
        const text = JSON.stringify(message);
        if (new TextEncoder().encode(text).byteLength > 4096) throw unavailable();
        const value: unknown = JSON.parse(text);
        const link = sender.url ? parseHandoffLink(sender.url, options.webOrigin) : undefined;
        if (
          !validateApplicationApplyIntent(value) ||
          !link ||
          link.applicationId !== value.applicationId ||
          link.jobId !== value.jobId ||
          sender.id ||
          sender.nativeApplication ||
          sender.origin !== options.webOrigin ||
          sender.frameId !== 0 ||
          sender.documentLifecycle !== "active" ||
          sender.tab?.incognito ||
          !Number.isSafeInteger(sender.tab?.id)
        )
          throw unavailable();
        clearIntent();
        const deadline = Date.now() + 10 * 60_000;
        intent = {
          reviewLink: link.href,
          applicationId: value.applicationId,
          jobId: value.jobId,
          packetId: value.packetId,
          packetHash: value.packetHash,
          deadline,
          timer: setTimeout(clearIntent, 10 * 60_000),
        };
        rememberIntent(link.href, deadline);
        return { schema: "application-apply-intent-receipt.v1", expiresAtMs: deadline };
      })().then(respond, () => respond({ error: "ApplicationApplyIntentUnavailable" }));
      return true;
    }
    if (
      ![
        "application-native-transfer-begin.v1",
        "application-native-transfer-commit.v1",
        "application-native-transfer-cancel.v1",
        "application-native-transfer-discard.v1",
      ].includes(typeof schema === "string" ? schema : "")
    )
      return false;
    void (async () => {
      if (schema === "application-native-transfer-begin.v1") return transfer.begin(message, sender);
      if (schema === "application-native-transfer-commit.v1")
        return transfer.commit(message, sender);
      if (schema === "application-native-transfer-cancel.v1") transfer.cancel(message, sender);
      else transfer.discard(message, sender);
      return { ok: true };
    })().then(respond, () => respond({ error: "NativeMaterialTransferUnavailable" }));
    return true;
  });

  return {
    clear,
    /** Explicit trusted extension action while the exact employer tab is active. */
    async select(reviewLink: string) {
      clear();
      const fence = generation;
      const controller = new AbortController();
      selecting = controller;
      const timer = setTimeout(() => controller.abort(), 30_000);
      const stopped = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(unavailable()), { once: true });
      });
      try {
        const work = async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs.length !== 1 || tabs[0]?.id === undefined) throw unavailable();
          const selected = await protectedSelection(reviewLink, tabs[0].id, controller.signal);
          if (fence !== generation || controller.signal.aborted) throw unavailable();
          transfer.select(selected);
          if (selected.uploadedResume) {
            const file = await pullUploadedResume(selected, controller.signal);
            try {
              transfer.attachUploaded(selected, file);
            } catch (error) {
              file.bytes.fill(0);
              throw error;
            }
          }
          return { ok: true, resume: selected.uploadedResume ? "uploaded" : "generated" };
        };
        return await Promise.race([work(), stopped]);
      } catch {
        if (fence === generation) clear();
        throw unavailable();
      } finally {
        clearTimeout(timer);
        if (selecting === controller) selecting = undefined;
      }
    },
    /** The link the popup may offer after Apply was pressed on the website. No content. */
    async pendingIntent() {
      const pending =
        intent && Date.now() < intent.deadline
          ? { reviewLink: intent.reviewLink, deadline: intent.deadline }
          : await restoredIntent();
      return pending
        ? { ok: true, reviewLink: pending.reviewLink, expiresAtMs: pending.deadline }
        : { ok: true };
    },
    // Private executor composition only. No content in popup snapshots or external responses.
    consume: transfer.consume,
    consumeSelected: transfer.consumeSelected,
    async apply(reviewLink: string) {
      const owned = transfer.consumeSelected(reviewLink);
      try {
        return await executeApprovedApplication({
          apiOrigin: options.apiOrigin,
          registry: options.registry,
          identity: options.identity,
          owned,
          async preflight(selection, signal) {
            const proof = await protectedSelection(
              selection.reviewLink,
              selection.tabId,
              signal,
              selection.documentId,
            );
            if (!sameNativeTransferBinding(proof, selection)) throw unavailable();
          },
        });
      } finally {
        owned.dispose();
      }
    },
  };
}
