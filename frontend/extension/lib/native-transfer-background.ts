import {
  validateApplication,
  validateApplicationApplyIntent,
  validateApplicationUploadedResumeFile,
} from "@ai-job-apply/api-contracts/browser-validators";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { executeApprovedApplication } from "./application-executor";
import { parseHandoffLink, readApprovedHandoff, readJson } from "./application-handoff";
import {
  createNativeMaterialTransfer,
  type NativeTransferSelection,
  type TransferredNativeFile,
  UPLOADED_RESUME_MAXIMUM_BYTES,
} from "./native-material-transfer";
import { createNarrativeAnswerSession } from "./narrative-answer-session";
import { sameNativeTransferBinding } from "./native-transfer-binding";
import { providerForUrl } from "./providers";
import {
  isOpenPanelRequest,
  notifyPanel,
  OPEN_PANEL_RECEIPT,
  OPEN_PANEL_REQUEST,
  openSidePanel,
} from "./side-panel";

const unavailable = () => Error("NativeMaterialTransferUnavailable");

/** How long the panel waits for the website to arm the extension before it stops saying so. */
const PREPARING_MS = 90_000;

/** Composition is installed only in the separate execution build. No provider or token transport. */
export function installNativeTransferBackground(options: {
  webOrigin: string;
  apiOrigin: string;
  registry: AdapterRegistry;
  identity(signal: AbortSignal): Promise<{ accessToken: string; identityFence: string }>;
}) {
  let generation = 0;
  let selecting: AbortController | undefined;
  // The website asked for the panel when Apply was pressed, and has not armed the extension yet.
  // The panel shows that it is preparing instead of an empty review link. In memory only.
  let preparingUntil = 0;
  // Which step of a selection last ran, so a refusal can say where it stopped. Never any content.
  let stage = "";
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

  // The answer icon (ADR-057) follows the page the candidate prepared and nothing else.
  const answers = createNarrativeAnswerSession({
    apiOrigin: options.apiOrigin,
    identity: options.identity,
    async inject({ tabId, documentId }) {
      await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: ["narrative-answer.js"],
        world: "ISOLATED",
      });
    },
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    const reply = answers.handle(message, sender);
    if (!reply) return false;
    void reply.then(respond, () => respond({ status: "error", reason: "failed" }));
    return true;
  });

  // Selecting the page again keeps the pending Apply: only identity changes and Clear end it.
  function clearSelection() {
    generation++;
    selecting?.abort();
    selecting = undefined;
    transfer.clear();
  }
  function clear() {
    preparingUntil = 0;
    clearIntent();
    clearSelection();
    answers.clear();
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
    stage = "employer-tab";
    const link = parseHandoffLink(reviewLink, options.webOrigin);
    const tab = await chrome.tabs.get(tabId);
    const provider = tab.url ? providerForUrl(tab.url) : undefined;
    if (!link || !tab.url || tab.incognito || !provider || signal.aborted) throw unavailable();
    stage = "sign-in";
    const session = await options.identity(signal);
    stage = "approval";
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
    stage = "application";
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
    stage = "page-access";
    const documents = await chrome.scripting.executeScript({
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] },
      func: () => ({ url: location.href, topFrame: window.top === window }),
    });
    stage = "page-match";
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
    stage = "resume";
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
      variantId: provider.variantId,
    };
  }

  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined || change.status === "loading") {
      transfer.documentChanged(tabId);
      answers.clear(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    transfer.documentChanged(tabId);
    answers.clear(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && Object.hasOwn(changes, "auth0Session")) clear();
  });
  chrome.runtime.onMessageExternal.addListener((message: unknown, sender, respond) => {
    const schema =
      message && typeof message === "object" && "schema" in message ? message.schema : undefined;
    if (schema === OPEN_PANEL_REQUEST) {
      // The website sends this in the turn of the candidate's Apply click, the only moment the
      // browser opens a panel, so it is handled before anything else. It carries no data; only the
      // website's own top document in a normal window may ask, and it can ask for nothing but this.
      const windowId = sender.tab?.windowId;
      if (
        !isOpenPanelRequest(message) ||
        sender.id ||
        sender.nativeApplication ||
        sender.origin !== options.webOrigin ||
        sender.frameId !== 0 ||
        sender.documentLifecycle !== "active" ||
        sender.tab?.incognito ||
        typeof windowId !== "number" ||
        windowId < 0
      ) {
        respond({ error: "ApplicationOpenPanelUnavailable" });
        return false;
      }
      preparingUntil = Date.now() + PREPARING_MS;
      const opened = openSidePanel(windowId);
      // A panel that is already open learns that an Apply started; a new one asks when it loads.
      notifyPanel();
      void opened.then((value) => respond({ schema: OPEN_PANEL_RECEIPT, opened: value }));
      return true;
    }
    if (schema === "application-apply-intent.v1") {
      void (async () => {
        const text = JSON.stringify(message);
        if (new TextEncoder().encode(text).byteLength > 4096) throw unavailable();
        const value: unknown = JSON.parse(text);
        // Chrome reports the address the page loaded with, not a later history.replaceState, so the
        // link comes from the validated identifiers. The verified origin and tab bind the sender.
        const link = validateApplicationApplyIntent(value)
          ? parseHandoffLink(
              `${options.webOrigin}/jobs?application=${value.applicationId}&job=${value.jobId}`,
              options.webOrigin,
            )
          : undefined;
        if (
          !validateApplicationApplyIntent(value) ||
          !link ||
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
        preparingUntil = 0;
        notifyPanel();
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

  /**
   * The resume reaches the extension a few seconds after the page is selected. A candidate who
   * acts sooner waits for it here instead of being refused.
   */
  async function waitForResume(maximumMs = 20_000) {
    const until = Date.now() + maximumMs;
    while (
      ["selected", "admitting", "admitted", "committing"].includes(transfer.phase()) &&
      Date.now() < until
    )
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  return {
    clear,
    /** Explicit trusted extension action while the exact employer tab is active. */
    async select(reviewLink: string) {
      // The same page selected again (the popup selects it each time it opens) keeps its resume.
      const link = parseHandoffLink(reviewLink, options.webOrigin);
      const open = await chrome.tabs.query({ active: true, currentWindow: true });
      const openTab = open.length === 1 ? open[0]?.id : undefined;
      const kept = link && openTab !== undefined ? transfer.holds(link.href, openTab) : undefined;
      if (kept) {
        void answers.arm(kept.page);
        return { ok: true, resume: kept.resume };
      }
      clearSelection();
      stage = "";
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
          stage = "transfer";
          if (fence !== generation || controller.signal.aborted) throw unavailable();
          transfer.select(selected);
          void answers.arm({
            tabId: selected.tabId,
            documentId: selected.documentId,
            applicationId: selected.applicationId,
            employerUrl: selected.employerUrl,
          });
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
        if (fence === generation) clearSelection();
        throw Object.assign(unavailable(), { stage });
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
        : Date.now() < preparingUntil
          ? { ok: true, preparingUntilMs: preparingUntil }
          : { ok: true };
    },
    // Private executor composition only. No content in popup snapshots or external responses.
    consume: transfer.consume,
    consumeSelected: transfer.consumeSelected,
    waitForResume,
    async apply(reviewLink: string, fillOnly = false) {
      await waitForResume();
      let owned: ReturnType<typeof transfer.consumeSelected>;
      try {
        owned = transfer.consumeSelected(reviewLink);
      } catch {
        // No current selection or no resume received yet: the candidate selects the page again.
        throw Object.assign(unavailable(), { stage: `selection-or-resume:${transfer.phase()}` });
      }
      try {
        return await executeApprovedApplication({
          apiOrigin: options.apiOrigin,
          registry: options.registry,
          identity: options.identity,
          ...(fillOnly ? { fillOnly: true } : {}),
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
