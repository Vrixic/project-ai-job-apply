import {
  capabilityForPage,
  DEFAULT_DARK_DETECTOR_POLICY_REVISION,
  extensionDetectorActivationPolicy,
} from "../lib/capability-policy";
import { extensionConfiguration } from "../lib/config";
import {
  fileContributionAppeal,
  getContributionStatus,
  getOwnerTrustStatus,
  withdrawContribution,
} from "../lib/contribution-owner-api";
import {
  CONTRIBUTION_RECEIPTS_KEY,
  type ContributionReceipt,
  parseContributionReceipts,
  receiptFromContribution,
  receiptsForIdentity,
  updateContributionStatus,
  updateTrustStatus,
  upsertContributionReceipt,
} from "../lib/contribution-receipts";
import { detectPublicJob } from "../lib/detectors";
import type { CaptureField, SanitizedJobCapture } from "../lib/job-capture";
import { sendJobIntent } from "../lib/job-intent-api";
import { parseExtensionMessage } from "../lib/messages";
import { captureCurrentPublicJobPage } from "../lib/page-inspection";
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
import {
  CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY,
  ExtensionContributionPolicyRuntime,
  fetchSignedContributionCapabilityPolicy,
  type SignedExtensionContributionCapabilityPolicy,
} from "../lib/signed-capability-policy";
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

type DeliveryReadinessReason =
  | "api_configuration_required"
  | "identity_configuration_required"
  | "policy_configuration_required"
  | "preview_required"
  | "ready"
  | "retention_configuration_required"
  | "sign_in_required"
  | "signed_policy_disabled"
  | "signed_policy_unavailable";

interface DeliveryReadiness {
  contribution: { ready: boolean; reason: DeliveryReadinessReason };
  privateSave: { ready: boolean; reason: DeliveryReadinessReason };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cancel") || message.includes("access_denied")) {
    return "Authentication action cancelled.";
  }
  if (message === "configuration_required") return "Public Auth0 configuration is required.";
  if (message === "api_configuration_required") {
    return "Configure the API origin before using account delivery.";
  }
  if (message === "reauthentication_required" || message === "authentication_required") {
    return "Log in again to continue.";
  }
  if (message === "capture_required") return "Inspect the current page again before continuing.";
  if (message === "retention_policy_required") {
    return "Pending-item retention must be configured before adding a job.";
  }
  if (message === "contribution_capability_disabled") {
    return "Public contribution is currently disabled by its signed capability policy.";
  }
  if (message === "queue_capacity_reached") {
    return "The delivery queue is full. Retry pending items or remove stopped items.";
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

function unavailable(reason: DeliveryReadinessReason) {
  return { ready: false, reason } as const;
}

async function activeStoredCapture(): Promise<SanitizedJobCapture | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const stored = await chrome.storage.session.get(LAST_CAPTURE_KEY);
  const last = stored[LAST_CAPTURE_KEY] as LastCapture | undefined;
  return last && tab?.id === last.tabId && tab.url === last.tabUrl ? last.capture : undefined;
}

async function deliveryReadiness(
  capture: SanitizedJobCapture | undefined,
): Promise<DeliveryReadiness> {
  const status = await authenticationStatus();
  const baseReason = !status.configured
    ? "identity_configuration_required"
    : !status.authenticated
      ? "sign_in_required"
      : !status.apiConfigured
        ? "api_configuration_required"
        : !extensionConfiguration.pendingRetentionMilliseconds
          ? "retention_configuration_required"
          : undefined;
  if (baseReason) {
    return { contribution: unavailable(baseReason), privateSave: unavailable(baseReason) };
  }

  if (!capture) {
    return {
      contribution: unavailable("preview_required"),
      privateSave: unavailable("preview_required"),
    };
  }
  const privateSave = { ready: true, reason: "ready" } as const;
  if (
    !extensionConfiguration.ugcContributionPolicyVersion ||
    Object.keys(extensionConfiguration.capabilityPolicyPublicKeys).length === 0
  ) {
    return { contribution: unavailable("policy_configuration_required"), privateSave };
  }
  try {
    await contributionPolicyStartup;
  } catch {
    return { contribution: unavailable("signed_policy_unavailable"), privateSave };
  }
  const decision = contributionPolicy.decision(capture, chrome.runtime.getManifest().version);
  if (!decision.allowed) {
    return {
      contribution: unavailable(
        decision.reason === "policy_missing"
          ? "signed_policy_unavailable"
          : "signed_policy_disabled",
      ),
      privateSave,
    };
  }
  return { contribution: { ready: true, reason: "ready" }, privateSave };
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

async function contributionReceipts(): Promise<ContributionReceipt[]> {
  await storageBoundaryStartup;
  const stored = (await chrome.storage.local.get(CONTRIBUTION_RECEIPTS_KEY))[
    CONTRIBUTION_RECEIPTS_KEY
  ];
  return parseContributionReceipts(stored);
}

async function writeContributionReceipts(receipts: ContributionReceipt[]): Promise<void> {
  await chrome.storage.local.set({ [CONTRIBUTION_RECEIPTS_KEY]: receipts });
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
    const result = await sendJobIntent(
      intent,
      session.accessToken,
      fetch,
      chrome.runtime.getManifest().version,
    );
    if (intent.intent === "contribute" && result.outcome === "accepted" && result.contribution) {
      await writeContributionReceipts(
        upsertContributionReceipt(
          await contributionReceipts(),
          receiptFromContribution(result.contribution, session.identityFence),
        ),
      );
    }
    const settled = settleDispatch(intent, result, now);
    if (settled) replacement.push(settled);
  }
  await writePendingQueue(replacement);
  return {
    pending: replacement.filter((intent) => intent.state === "pending").length,
    stopped: replacement.filter((intent) => intent.state !== "pending").length,
  };
}

async function ownerAction(
  message: Extract<ReturnType<typeof parseExtensionMessage>, { contributionId: string }>,
) {
  if (!message || !extensionConfiguration.apiOrigin) {
    throw new Error("api_configuration_required");
  }
  const session = await authenticatedApiSession();
  const all = await contributionReceipts();
  const receipt = receiptsForIdentity(all, session.identityFence).find(
    (item) => item.contributionId === message.contributionId,
  );
  if (!receipt) throw new Error("contribution_required");
  const result =
    message.action === "contribution_refresh"
      ? await getContributionStatus(
          receipt.contributionId,
          session.accessToken,
          extensionConfiguration.apiOrigin,
        )
      : message.action === "trust_refresh"
        ? await getOwnerTrustStatus(
            receipt.contributionId,
            session.accessToken,
            extensionConfiguration.apiOrigin,
          )
        : message.action === "withdraw" && receipt.trust
          ? await withdrawContribution(
              receipt.contributionId,
              receipt.trust.version,
              session.accessToken,
              extensionConfiguration.apiOrigin,
            )
          : message.action === "appeal" && receipt.trust
            ? await fileContributionAppeal(
                receipt.contributionId,
                receipt.trust.version,
                message.evidenceDigestSha256,
                session.accessToken,
                extensionConfiguration.apiOrigin,
              )
            : { outcome: "rejected" as const };
  if (result.outcome === "ok") {
    const updated =
      message.action === "contribution_refresh"
        ? updateContributionStatus(
            receipt,
            result.value as import("@ai-job-apply/api-contracts").JobContribution,
          )
        : updateTrustStatus(
            receipt,
            result.value as import("@ai-job-apply/api-contracts").OwnerTrustCase,
          );
    await writeContributionReceipts(upsertContributionReceipt(all, updated));
  }
  return result.outcome;
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
          await writeContributionReceipts([]);
        }
      } else if (message.action === "refresh") await refresh();
      else if (message.action === "clear_queue") await writePendingQueue([]);
      else if (message.action === "clear_stopped") {
        await writePendingQueue(
          (await pendingQueue()).filter((intent) => intent.state === "pending"),
        );
      } else if (message.action === "capture") {
        const result = await captureCurrentPage();
        return {
          ...result,
          delivery: await deliveryReadiness(result.ok ? result.capture : undefined),
          status: await authenticationStatus(),
        };
      } else if (message.action === "enqueue") {
        const queue = await enqueue(message.intent, message.approvedFields);
        const session = await authenticatedApiSession();
        return {
          delivery: await deliveryReadiness(await activeStoredCapture()),
          ok: true,
          queue,
          receipts: receiptsForIdentity(await contributionReceipts(), session.identityFence),
          status: await authenticationStatus(),
        };
      } else if (message.action === "retry") {
        return {
          delivery: await deliveryReadiness(await activeStoredCapture()),
          ok: true,
          queue: await dispatchPending(),
          status: await authenticationStatus(),
        };
      } else if (
        ["contribution_refresh", "trust_refresh", "withdraw", "appeal"].includes(message.action)
      ) {
        const outcome = await ownerAction(message as Parameters<typeof ownerAction>[0]);
        const session = await authenticatedApiSession();
        return {
          delivery: await deliveryReadiness(await activeStoredCapture()),
          ok: outcome === "ok",
          ownerAction: outcome,
          receipts: receiptsForIdentity(await contributionReceipts(), session.identityFence),
          status: await authenticationStatus(),
        };
      }
      const queue = await pendingQueue();
      let receipts: ContributionReceipt[] = [];
      try {
        const session = await authenticatedApiSession();
        receipts = receiptsForIdentity(await contributionReceipts(), session.identityFence);
      } catch {
        /* signed-out responses never expose fenced receipts */
      }
      return {
        delivery: await deliveryReadiness(await activeStoredCapture()),
        ok: true,
        queue: {
          pending: queue.filter((intent) => intent.state === "pending").length,
          stopped: queue.filter((intent) => intent.state !== "pending").length,
        },
        receipts,
        status: await authenticationStatus(),
      };
    } catch (error) {
      return {
        delivery: await deliveryReadiness(await activeStoredCapture()),
        error: safeMessage(error),
        ok: false,
        status: await authenticationStatus(),
      };
    }
  })().then(sendResponse);
  return true;
});
