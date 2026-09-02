import {
  capabilityForPage,
  DEFAULT_DARK_DETECTOR_POLICY_REVISION,
  extensionDetectorActivationPolicy,
} from "../lib/capability-policy";
import { extensionConfiguration } from "../lib/config";
import { detectPublicJob } from "../lib/detectors";
import type { CaptureField, SanitizedJobCapture } from "../lib/job-capture";
import { sendJobIntent } from "../lib/job-intent-api";
import { parseExtensionMessage } from "../lib/messages";
import { captureCurrentPublicJobPage } from "../lib/page-inspection";
import {
  CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY,
  ExtensionContributionPolicyRuntime,
  fetchSignedContributionCapabilityPolicy,
  type SignedExtensionContributionCapabilityPolicy,
} from "../lib/signed-capability-policy";
import {
  createPendingIntent,
  dueForDispatch,
  fenceMismatchedIntent,
  MAXIMUM_QUEUE_ITEMS,
  PENDING_QUEUE_KEY,
  type PendingJobIntent,
  retainUnexpiredIntents,
  settleDispatch,
} from "../lib/pending-queue";
import {
  authenticatedApiSession,
  authenticationStatus,
  login,
  logout,
  refresh,
} from "../lib/protocol";
import { restrictExtensionStorageToTrustedContexts } from "../lib/storage-boundary";

const LAST_CAPTURE_KEY = "d2LastJobCaptureV1";
const RETRY_ALARM = "d2PendingJobIntentRetry";

const contributionPolicy = new ExtensionContributionPolicyRuntime(
  extensionConfiguration.capabilityPolicyPublicKeys,
  {
    async read() {
      return (await chrome.storage.local.get(CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY))[
        CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY
      ];
    },
    async remove() {
      await chrome.storage.local.remove(CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY);
    },
    async write(envelope: SignedExtensionContributionCapabilityPolicy) {
      await chrome.storage.local.set({
        [CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY]: envelope,
      });
    },
  },
  async () => {
    if (!extensionConfiguration.apiOrigin) {
      throw new Error("The API origin is not configured");
    }
    return fetchSignedContributionCapabilityPolicy(extensionConfiguration.apiOrigin);
  },
);

const storageBoundaryStartup = restrictExtensionStorageToTrustedContexts(chrome.storage);
let contributionPolicyStartup = storageBoundaryStartup.then(() => contributionPolicy.start());

interface LastCapture {
  capture: SanitizedJobCapture;
  tabId: number;
  tabUrl: string;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cancel") || message.includes("access_denied")) {
    return "Authentication action cancelled.";
  }
  if (message === "configuration_required") return "Public Auth0 configuration is required.";
  if (message === "reauthentication_required" || message === "authentication_required") {
    return "Log in again to continue.";
  }
  if (message === "capture_required") return "Inspect the current page again before continuing.";
  if (message === "retention_policy_required") {
    return "Pending-item retention must be configured before saving or contributing.";
  }
  if (message === "contribution_capability_disabled") {
    return "Public contribution is currently disabled by its signed capability policy.";
  }
  return "The action did not complete.";
}

function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab === undefined &&
    typeof sender.url === "string" &&
    sender.url.startsWith(chrome.runtime.getURL(""))
  );
}

async function pendingQueue(): Promise<PendingJobIntent[]> {
  await storageBoundaryStartup;
  const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
  const stored = result[PENDING_QUEUE_KEY];
  const queue = Array.isArray(stored) ? (stored as PendingJobIntent[]) : [];
  const retained = retainUnexpiredIntents(queue);
  if (retained.length !== queue.length) await writePendingQueue(retained);
  return retained;
}

async function writePendingQueue(queue: PendingJobIntent[]): Promise<void> {
  await chrome.storage.local.set({ [PENDING_QUEUE_KEY]: queue });
  const next = queue
    .filter((intent) => intent.state === "pending")
    .filter(
      (intent) =>
        intent.intent === "private_save" ||
        contributionPolicy.decision(intent.capture, chrome.runtime.getManifest().version).allowed,
    )
    .map((intent) => Date.parse(intent.nextAttemptAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  if (next) {
    chrome.alarms.create(RETRY_ALARM, { when: Math.max(next, Date.now() + 1_000) });
  } else {
    await chrome.alarms.clear(RETRY_ALARM);
  }
}

async function dispatchPending(): Promise<{ pending: number; stopped: number }> {
  const queue = await pendingQueue();
  if (queue.length === 0) return { pending: 0, stopped: 0 };
  if (queue.some((intent) => intent.state === "pending" && intent.intent === "contribute")) {
    await contributionPolicyStartup;
    await contributionPolicy.refresh();
  }
  let session: Awaited<ReturnType<typeof authenticatedApiSession>>;
  try {
    session = await authenticatedApiSession();
  } catch {
    return {
      pending: queue.filter((intent) => intent.state === "pending").length,
      stopped: queue.filter((intent) => intent.state !== "pending").length,
    };
  }
  const now = new Date();
  const replacement: PendingJobIntent[] = [];
  for (const intent of queue) {
    if (intent.state === "pending" && intent.identityFence !== session.identityFence) {
      replacement.push(fenceMismatchedIntent(intent));
      continue;
    }
    if (!dueForDispatch(intent, session.identityFence, now)) {
      replacement.push(intent);
      continue;
    }
    if (
      intent.intent === "contribute" &&
      !contributionPolicy.decision(intent.capture, chrome.runtime.getManifest().version, now)
        .allowed
    ) {
      replacement.push(intent);
      continue;
    }
    const settled = settleDispatch(
      intent,
      await sendJobIntent(intent, session.accessToken, fetch, chrome.runtime.getManifest().version),
      now,
    );
    if (settled) replacement.push(settled);
  }
  await writePendingQueue(replacement);
  return {
    pending: replacement.filter((intent) => intent.state === "pending").length,
    stopped: replacement.filter((intent) => intent.state !== "pending").length,
  };
}

async function captureCurrentPage(): Promise<
  { capture: SanitizedJobCapture; ok: true } | { error: string; ok: false }
> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return { error: "No inspectable active page.", ok: false };
  const decision = capabilityForPage(
    tab.url,
    chrome.runtime.getManifest().version,
    extensionDetectorActivationPolicy,
  );
  if (!decision.allowed) {
    const error =
      decision.reason === "configuration_missing"
        ? `Current-page inspection is disabled in ${DEFAULT_DARK_DETECTOR_POLICY_REVISION}.`
        : decision.reason === "provider_disabled"
          ? "This provider remains disabled pending representative fixture acceptance."
          : "This page is unsupported or disabled.";
    return { error, ok: false };
  }
  const [execution] = await chrome.scripting.executeScript({
    func: captureCurrentPublicJobPage,
    target: { tabId: tab.id },
  });
  const currentTab = await chrome.tabs.get(tab.id);
  if (currentTab.url !== tab.url) {
    return { error: "The page changed during inspection. Try again.", ok: false };
  }
  const capture = execution?.result ? detectPublicJob(execution.result) : undefined;
  if (
    !capture ||
    capture.provider !== decision.provider ||
    capture.pageVariant !== decision.variant
  ) {
    return { error: "No supported public job was detected.", ok: false };
  }
  await chrome.storage.session.set({
    [LAST_CAPTURE_KEY]: { capture, tabId: tab.id, tabUrl: tab.url },
  });
  return { capture, ok: true };
}

async function enqueue(
  intent: "contribute" | "private_save",
  approvedFields: readonly CaptureField[],
) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.session.get(LAST_CAPTURE_KEY);
  const last = stored[LAST_CAPTURE_KEY] as LastCapture | undefined;
  if (!last || !tab?.id || last.tabId !== tab.id || last.tabUrl !== tab.url) {
    throw new Error("capture_required");
  }
  if (intent === "contribute") {
    await contributionPolicyStartup;
    await contributionPolicy.refresh();
    if (!contributionPolicy.decision(last.capture, chrome.runtime.getManifest().version).allowed) {
      throw new Error("contribution_capability_disabled");
    }
  }
  const session = await authenticatedApiSession();
  if (!extensionConfiguration.pendingRetentionMilliseconds) {
    throw new Error("retention_policy_required");
  }
  const queue = await pendingQueue();
  if (queue.length >= MAXIMUM_QUEUE_ITEMS) throw new Error("queue_capacity_reached");
  queue.push(
    createPendingIntent({
      approvedFields,
      capture: last.capture,
      identityFence: session.identityFence,
      intent,
      retentionMilliseconds: extensionConfiguration.pendingRetentionMilliseconds,
    }),
  );
  await writePendingQueue(queue);
  return dispatchPending();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void dispatchPending();
});
chrome.runtime.onStartup.addListener(() => {
  contributionPolicyStartup = storageBoundaryStartup.then(() => contributionPolicy.start());
  void contributionPolicyStartup.then(() => dispatchPending());
});
chrome.runtime.onInstalled.addListener(() => {
  contributionPolicyStartup = storageBoundaryStartup.then(() => contributionPolicy.start());
  void contributionPolicyStartup.then(() => dispatchPending());
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = parseExtensionMessage(rawMessage);
  if (!message || !trustedSender(sender)) {
    sendResponse({ error: "Invalid extension request.", ok: false });
    return false;
  }
  void (async () => {
    try {
      await storageBoundaryStartup;
      if (message.action === "login") await login();
      else if (message.action === "logout") {
        try {
          await logout();
        } finally {
          await chrome.storage.session.remove(LAST_CAPTURE_KEY);
          await writePendingQueue([]);
        }
      } else if (message.action === "refresh") await refresh();
      else if (message.action === "clear_queue") await writePendingQueue([]);
      else if (message.action === "clear_stopped") {
        await writePendingQueue(
          (await pendingQueue()).filter((intent) => intent.state === "pending"),
        );
      } else if (message.action === "capture") return captureCurrentPage();
      else if (message.action === "enqueue") {
        return {
          ok: true,
          queue: await enqueue(message.intent, message.approvedFields),
          status: await authenticationStatus(),
        };
      } else if (message.action === "retry") {
        return { ok: true, queue: await dispatchPending(), status: await authenticationStatus() };
      }
      const queue = await pendingQueue();
      return {
        ok: true,
        queue: {
          pending: queue.filter((intent) => intent.state === "pending").length,
          stopped: queue.filter((intent) => intent.state !== "pending").length,
        },
        status: await authenticationStatus(),
      };
    } catch (error) {
      return { error: safeMessage(error), ok: false, status: await authenticationStatus() };
    }
  })().then(sendResponse);
  return true;
});
