import { validateNarrativeAnswer } from "@ai-job-apply/api-contracts/browser-validators";
import { safeApiOrigin } from "./config";
import {
  isNarrativeAnswerMessage,
  type NarrativeAnswerReply,
  parseNarrativeAnswerRequest,
} from "./narrative-answer-protocol";

/** A prepared page may ask for drafts for this long; selecting the page again renews it. */
export const ANSWER_SESSION_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const RESPONSE_LIMIT_BYTES = 16_384;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

interface Binding {
  tabId: number;
  documentId: string;
  applicationId: string;
  origin: string;
  expiresAt: number;
}

/**
 * Lets the answer icon on one prepared employer page ask for a draft for one application (ADR-057).
 *
 * The binding is the page the candidate prepared: the exact tab and document, the employer origin
 * and the application, all in memory only. A request is answered only from that document's top
 * frame, one at a time, with the candidate's own signed-in session and nothing else. The question
 * and the draft are never stored or logged here.
 */
export function createNarrativeAnswerSession(options: {
  apiOrigin: string;
  identity(signal: AbortSignal): Promise<{ accessToken: string; identityFence: string }>;
  /** Puts the icon script into exactly this document of this tab. */
  inject(target: { tabId: number; documentId: string }): Promise<void>;
  now?: () => number;
  fetchImplementation?: typeof fetch;
}) {
  const now = options.now ?? Date.now;
  const apiOrigin = safeApiOrigin(options.apiOrigin);
  let bound: Binding | undefined;
  let inFlight: AbortController | undefined;

  function clear(tabId?: number) {
    if (tabId !== undefined && bound?.tabId !== tabId) return;
    bound = undefined;
    inFlight?.abort();
    inFlight = undefined;
  }

  function senderMatches(sender: chrome.runtime.MessageSender, binding: Binding): boolean {
    let senderOrigin: string | undefined;
    try {
      senderOrigin = sender.url ? new URL(sender.url).origin : undefined;
    } catch {
      senderOrigin = undefined;
    }
    return (
      sender.id === chrome.runtime.id &&
      sender.tab?.id === binding.tabId &&
      sender.tab.incognito !== true &&
      sender.frameId === 0 &&
      sender.documentId === binding.documentId &&
      (sender.documentLifecycle === undefined || sender.documentLifecycle === "active") &&
      senderOrigin === binding.origin
    );
  }

  async function draft(binding: Binding, body: string): Promise<NarrativeAnswerReply> {
    if (!apiOrigin) return { status: "error", reason: "unavailable" };
    const controller = new AbortController();
    inFlight = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let session: Awaited<ReturnType<typeof options.identity>>;
      try {
        session = await options.identity(controller.signal);
      } catch {
        return { status: "error", reason: "signin" };
      }
      const response = await (options.fetchImplementation ?? fetch)(
        new URL(`/v1/applications/${binding.applicationId}/narrative-answers`, apiOrigin),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "error", reason: "signin" };
      }
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "error", reason: "limit" };
      }
      if (response.status === 503) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "error", reason: "unavailable" };
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { status: "error", reason: "failed" };
      }
      const value = await readJson(response, controller.signal);
      // The candidate may have signed out or moved on while the draft was being written.
      if (bound !== binding || controller.signal.aborted)
        return { status: "error", reason: "closed" };
      if (!validateNarrativeAnswer(value)) return { status: "error", reason: "failed" };
      return value.status === "ready"
        ? { status: "ready", text: value.text }
        : { status: "declined", reason: value.reason };
    } catch {
      return { status: "error", reason: controller.signal.aborted ? "closed" : "failed" };
    } finally {
      clearTimeout(timer);
      if (inFlight === controller) inFlight = undefined;
    }
  }

  return {
    /** The candidate prepared this exact page for an application: let its icon ask for drafts. */
    async arm(page: {
      tabId: number;
      documentId: string;
      applicationId: string;
      employerUrl: string;
    }): Promise<void> {
      let origin: string;
      try {
        const url = new URL(page.employerUrl);
        if (url.protocol !== "https:" || url.username || url.password) throw Error();
        origin = url.origin;
      } catch {
        return;
      }
      if (
        !apiOrigin ||
        !UUID.test(page.applicationId) ||
        !Number.isSafeInteger(page.tabId) ||
        page.tabId < 0 ||
        !page.documentId
      )
        return;
      clear();
      const binding: Binding = {
        tabId: page.tabId,
        documentId: page.documentId,
        applicationId: page.applicationId,
        origin,
        expiresAt: now() + ANSWER_SESSION_MS,
      };
      bound = binding;
      try {
        await options.inject({ tabId: page.tabId, documentId: page.documentId });
      } catch {
        // The page cannot be reached (closed, navigated, no permission): there is no icon to serve.
        if (bound === binding) bound = undefined;
      }
    },
    clear,
    /**
     * Answers a message from the page's icon. Returns undefined for any other message so the main
     * listener keeps ownership of its own protocol.
     */
    handle(
      message: unknown,
      sender: chrome.runtime.MessageSender,
    ): Promise<NarrativeAnswerReply> | undefined {
      if (!isNarrativeAnswerMessage(message)) return undefined;
      const binding = bound;
      const request = parseNarrativeAnswerRequest(message);
      if (!binding || !request || now() >= binding.expiresAt || !senderMatches(sender, binding)) {
        if (binding && now() >= binding.expiresAt) clear();
        return Promise.resolve({ status: "error", reason: "closed" });
      }
      // One draft at a time: a second request while one is running is a click on a busy icon.
      if (inFlight) return Promise.resolve({ status: "error", reason: "limit" });
      return draft(
        binding,
        JSON.stringify({
          question: request.question,
          ...(request.guidance ? { guidance: request.guidance } : {}),
        }),
      );
    },
  };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT_BYTES) throw Error();
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
