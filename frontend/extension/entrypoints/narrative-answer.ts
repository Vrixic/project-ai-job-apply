import { installNarrativeAnswerUi } from "../lib/narrative-answer-page";
import type { NarrativeAnswerReply } from "../lib/narrative-answer-protocol";

// Isolated-world lifetime only. Reinjection into the same document cannot add a second set of icons.
const installed = "__applyDashNarrativeAnswerV1";
if (!Object.hasOwn(globalThis, installed) && window.top === window) {
  Object.defineProperty(globalThis, installed, { value: true });
  installNarrativeAnswerUi({
    document,
    send: (request) => chrome.runtime.sendMessage(request) as Promise<NarrativeAnswerReply>,
  });
}
