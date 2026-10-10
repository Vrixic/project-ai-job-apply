import { validateApplication } from "@ai-job-apply/api-contracts/browser-validators";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { parseHandoffLink, readApprovedHandoff, readJson } from "./application-handoff";
import { greenhouseApplicationIdentity } from "./greenhouse/inspect";
import {
  createNativeMaterialTransfer,
  type NativeTransferSelection,
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
    transfer.clear();
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
    return {
      applicationId: application.id,
      packetId: packet.id,
      packetHash: packet.packetHash,
      approvalId: approval.id,
      revision: application.revision,
      approvalExpiresAtMs: Date.parse(approval.expiresAt),
      materials: packet.temporaryMaterials ?? [],
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
          return { ok: true };
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
    // Private executor composition only. No content in popup snapshots or external responses.
    consume: transfer.consume,
  };
}
