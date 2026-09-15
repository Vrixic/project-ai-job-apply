import { safeActionErrorMessage } from "../lib/action-error";
import {
  capabilityForPage,
  DEFAULT_DARK_DETECTOR_POLICY_REVISION,
  extensionDetectorActivationPolicy,
} from "../lib/capability-policy";
import { extensionConfiguration } from "../lib/config";
import {
  cancelContribution,
  fileContributionAppeal,
  getContributionHistory,
  getContributionStatus,
  getOwnerTrustStatus,
  withdrawContribution,
} from "../lib/contribution-owner-api";
import {
  CONTRIBUTION_RECEIPTS_KEY,
  type ContributionReceipt,
  mergeContributionHistory,
  parseContributionReceipts,
  receiptFromContribution,
  receiptsForIdentity,
  updateContributionStatus,
  updateTrustStatus,
  upsertContributionReceipt,
} from "../lib/contribution-receipts";
import { detectPublicJob } from "../lib/detectors";
import { DevelopmentContributionRuntime } from "../lib/development-contributions";
import type { CaptureField, SanitizedJobCapture } from "../lib/job-capture";
import { prepareContribution, sendJobIntent } from "../lib/job-intent-api";
import { parseExtensionMessage } from "../lib/messages";
import { captureCurrentPublicJobPage } from "../lib/page-inspection";
import {
  createPendingIntent,
  deferPendingIntent,
  dueForDispatch,
  fenceMismatchedIntent,
  MAXIMUM_QUEUE_ITEMS,
  PENDING_QUEUE_KEY,
  type PendingJobIntent,
  restartStoppedIntent,
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
let identityGeneration = 0;
let identityTransition: number | undefined;
let localMutationTail: Promise<void> = Promise.resolve();
let pendingDispatch:
  | { generation: number; promise: Promise<ReturnType<typeof summarizeQueue>> }
  | undefined;

function assertIdentityGeneration(generation: number, allowTransition = false): void {
  if (generation !== identityGeneration || (!allowTransition && identityTransition !== undefined)) {
    throw new Error("identity_changed");
  }
}

function queueLocalMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = localMutationTail.then(async () => {
    await storageBoundaryStartup;
    return operation();
  });
  localMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function withLocalMutation<T>(generation: number, operation: () => Promise<T>): Promise<T> {
  return queueLocalMutation(async () => {
    assertIdentityGeneration(generation);
    const value = await operation();
    assertIdentityGeneration(generation);
    return value;
  });
}

function clearLocalForLogout(): Promise<void> {
  // This fixed barrier is queued at message acceptance, before any await or newer mutation.
  return queueLocalMutation(async () => {
    await chrome.storage.session.remove(LAST_CAPTURE_KEY);
    await chrome.storage.local.set({
      [PENDING_QUEUE_KEY]: [],
      [CONTRIBUTION_RECEIPTS_KEY]: [],
    });
    await chrome.alarms.clear(RETRY_ALARM);
  });
}

const contributionPolicy = extensionConfiguration.developmentContributions
  ? new DevelopmentContributionRuntime(
      extensionDetectorActivationPolicy,
      extensionConfiguration.developmentContributionProviders,
    )
  : new ExtensionContributionPolicyRuntime(
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
  | "development_capture_disabled"
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
  const tab = await activeBrowserTab();
  const stored = await chrome.storage.session.get(LAST_CAPTURE_KEY);
  const last = stored[LAST_CAPTURE_KEY] as LastCapture | undefined;
  return last && tab?.id === last.tabId && tab.url === last.tabUrl ? last.capture : undefined;
}

async function activeBrowserTab(): Promise<chrome.tabs.Tab | undefined> {
  // A service worker's current window can be detached DevTools. Resolve a browser
  // window explicitly; do not fall back to a previously captured or arbitrary tab.
  try {
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal", "popup"] });
    if (
      !Number.isInteger(window.id) ||
      window.id === undefined ||
      window.id < 0 ||
      (window.type !== "normal" && window.type !== "popup")
    )
      return undefined;
    const tabs = await chrome.tabs.query({ active: true, windowId: window.id });
    return tabs.length === 1 ? tabs[0] : undefined;
  } catch {
    return undefined;
  }
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
    (!extensionConfiguration.developmentContributions &&
      Object.keys(extensionConfiguration.capabilityPolicyPublicKeys).length === 0)
  ) {
    return { contribution: unavailable("policy_configuration_required"), privateSave };
  }
  try {
    await contributionPolicyStartup;
    await contributionPolicy.refreshForReadiness();
  } catch {
    return {
      contribution: unavailable(
        extensionConfiguration.developmentContributions
          ? "development_capture_disabled"
          : "signed_policy_unavailable",
      ),
      privateSave,
    };
  }
  const decision = contributionPolicy.decision(capture, chrome.runtime.getManifest().version);
  if (!decision.allowed) {
    return {
      contribution: unavailable(
        extensionConfiguration.developmentContributions
          ? "development_capture_disabled"
          : ["policy_missing", "policy_expired", "policy_not_yet_valid"].includes(decision.reason)
            ? "signed_policy_unavailable"
            : "signed_policy_disabled",
      ),
      privateSave,
    };
  }
  return { contribution: { ready: true, reason: "ready" }, privateSave };
}

async function readPendingQueue(generation: number): Promise<PendingJobIntent[]> {
  const result = await chrome.storage.local.get(PENDING_QUEUE_KEY);
  assertIdentityGeneration(generation);
  const stored = result[PENDING_QUEUE_KEY];
  const queue = Array.isArray(stored) ? (stored as PendingJobIntent[]) : [];
  const retained = retainUnexpiredIntents(queue);
  if (retained.length !== queue.length) await writePendingQueue(retained, generation);
  return retained;
}

function pendingQueue(generation = identityGeneration): Promise<PendingJobIntent[]> {
  return withLocalMutation(generation, () => readPendingQueue(generation));
}

function updatePendingQueue(
  generation: number,
  update: (queue: PendingJobIntent[]) => PendingJobIntent[],
): Promise<PendingJobIntent[]> {
  return withLocalMutation(generation, async () => {
    const queue = update(await readPendingQueue(generation));
    await writePendingQueue(queue, generation);
    return queue;
  });
}

async function writeLocalRecords(
  key: typeof PENDING_QUEUE_KEY | typeof CONTRIBUTION_RECEIPTS_KEY,
  value: PendingJobIntent[] | ContributionReceipt[],
  generation: number,
): Promise<void> {
  const previous = await chrome.storage.local.get(key);
  assertIdentityGeneration(generation, true);
  await chrome.storage.local.set({ [key]: value });
  if (generation !== identityGeneration) {
    // The lock still excludes newer mutations. Restore the pre-write value before allowing a
    // newer login/clear to proceed, including when that login ultimately cancels.
    if (previous[key] === undefined) await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({ [key]: previous[key] });
    throw new Error("identity_changed");
  }
}

// Raw storage helpers are called only inside the short local mutation lock, never across HTTP.
async function writePendingQueue(queue: PendingJobIntent[], generation: number): Promise<void> {
  await writeLocalRecords(PENDING_QUEUE_KEY, queue, generation);
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

function summarizeQueue(queue: readonly PendingJobIntent[]) {
  const lastError =
    [...queue].reverse().find((intent) => intent.state === "pending" && intent.lastError)
      ?.lastError ?? [...queue].reverse().find((intent) => intent.lastError)?.lastError;
  return {
    blocked: queue.filter((intent) => intent.state === "blocked").length,
    pending: queue.filter((intent) => intent.state === "pending").length,
    stopped: queue.filter((intent) => intent.state === "terminal").length,
    ...(lastError ? { lastError } : {}),
  };
}

async function readContributionReceipts(generation: number): Promise<ContributionReceipt[]> {
  const stored = (await chrome.storage.local.get(CONTRIBUTION_RECEIPTS_KEY))[
    CONTRIBUTION_RECEIPTS_KEY
  ];
  assertIdentityGeneration(generation);
  const parsed = parseContributionReceipts(stored);
  if (stored !== undefined && (!Array.isArray(stored) || parsed.length !== stored.length)) {
    throw new Error("contribution_history_unavailable");
  }
  return parsed;
}

function contributionReceipts(generation = identityGeneration): Promise<ContributionReceipt[]> {
  return withLocalMutation(generation, () => readContributionReceipts(generation));
}

async function writeContributionReceipts(
  receipts: ContributionReceipt[],
  generation: number,
): Promise<void> {
  await writeLocalRecords(CONTRIBUTION_RECEIPTS_KEY, receipts, generation);
}

type SharedJobsState =
  | "cached"
  | "refreshed"
  | "sign_in_required"
  | "storage_unavailable"
  | "unavailable"
  | "rejected";

function sharedJobsFailure(error: unknown): SharedJobsState {
  const message = error instanceof Error ? error.message : "";
  return [
    "authentication_required",
    "reauthentication_required",
    "configuration_required",
    "token_request_failed",
    "invalid_token_response",
    "invalid_token_identity",
    "identity_changed",
    "required_scope_missing",
  ].includes(message)
    ? "sign_in_required"
    : "storage_unavailable";
}

async function sharedJobsSnapshot(generation: number): Promise<{
  receipts: ContributionReceipt[];
  sharedJobsState: SharedJobsState;
}> {
  try {
    const session = await authenticatedApiSession();
    assertIdentityGeneration(generation);
    return {
      receipts: receiptsForIdentity(await contributionReceipts(generation), session.identityFence),
      sharedJobsState: "cached",
    };
  } catch (error) {
    // Hide records when ownership/storage cannot be established, but never call that empty history.
    return { receipts: [], sharedJobsState: sharedJobsFailure(error) };
  }
}

async function refreshSharedJobs(generation: number): Promise<SharedJobsState> {
  if (!extensionConfiguration.apiOrigin) return "unavailable";
  const session = await authenticatedApiSession();
  assertIdentityGeneration(generation);
  const result = await getContributionHistory(
    session.accessToken,
    extensionConfiguration.apiOrigin,
  );
  assertIdentityGeneration(generation);
  const currentSession = await authenticatedApiSession();
  if (currentSession.identityFence !== session.identityFence) throw new Error("identity_changed");
  if (result.outcome !== "ok") {
    return result.outcome === "rejected" ? "rejected" : "unavailable";
  }
  await withLocalMutation(generation, async () => {
    const current = await readContributionReceipts(generation);
    const merged = mergeContributionHistory(current, result.value.items, session.identityFence);
    await writeContributionReceipts(merged, generation);
  });
  return "refreshed";
}

async function dispatchPending(
  ignoreBackoff = false,
  generation = identityGeneration,
): Promise<ReturnType<typeof summarizeQueue>> {
  assertIdentityGeneration(generation);
  if (pendingDispatch?.generation === generation) return pendingDispatch.promise;
  const promise = runDispatch(generation, ignoreBackoff);
  pendingDispatch = { generation, promise };
  try {
    return await promise;
  } finally {
    if (pendingDispatch?.promise === promise) pendingDispatch = undefined;
  }
}

async function runDispatch(
  generation: number,
  ignoreBackoff: boolean,
): Promise<ReturnType<typeof summarizeQueue>> {
  const queue = await pendingQueue(generation);
  if (queue.length === 0) return summarizeQueue(queue);
  if (queue.some((intent) => intent.state === "pending" && intent.intent === "contribute")) {
    let policyReady = false;
    try {
      await contributionPolicyStartup;
      policyReady = await contributionPolicy.refresh();
    } catch {
      // The pending item remains local and records the actionable delivery gate below.
    }
    if (!policyReady) {
      const deferred = await updatePendingQueue(generation, (current) =>
        current.map((intent) =>
          intent.intent === "contribute"
            ? deferPendingIntent(intent, "contribution_capability_policy_unavailable")
            : intent,
        ),
      );
      return summarizeQueue(deferred);
    }
  }
  let session: Awaited<ReturnType<typeof authenticatedApiSession>>;
  try {
    session = await authenticatedApiSession();
  } catch {
    const deferred = await updatePendingQueue(generation, (current) =>
      current.map((intent) => deferPendingIntent(intent, "authentication_required")),
    );
    return summarizeQueue(deferred);
  }
  assertIdentityGeneration(generation);
  for (const queued of queue) {
    const now = new Date();
    const intent = await withLocalMutation(generation, async () => {
      const current = await readPendingQueue(generation);
      const found = current.find(
        (item) => item.id === queued.id && item.identityFence === queued.identityFence,
      );
      if (!found) return undefined; // Explicit removal wins over an older dispatch snapshot.
      let replacement: PendingJobIntent | undefined;
      if (found.state === "pending" && found.identityFence !== session.identityFence) {
        replacement = fenceMismatchedIntent(found);
      } else if (!dueForDispatch(found, session.identityFence, now, ignoreBackoff)) {
        return undefined;
      } else if (
        found.intent === "contribute" &&
        !contributionPolicy.decision(found.capture, chrome.runtime.getManifest().version, now)
          .allowed
      ) {
        replacement = deferPendingIntent(found, "contribution_capability_policy_unavailable");
      }
      if (replacement) {
        await writePendingQueue(
          current.map((item) =>
            item.id === found.id && item.identityFence === found.identityFence ? replacement : item,
          ),
          generation,
        );
        return undefined;
      }
      return found;
    });
    if (!intent) continue;
    assertIdentityGeneration(generation);
    const result = await sendJobIntent(
      intent,
      session.accessToken,
      (...args) => {
        // One intent can send consent and intake separately; logout also fences the latter.
        assertIdentityGeneration(generation);
        return fetch(...args);
      },
      chrome.runtime.getManifest().version,
    );
    await withLocalMutation(generation, async () => {
      const current = await readPendingQueue(generation);
      if (
        !current.some(
          (item) => item.id === intent.id && item.identityFence === intent.identityFence,
        )
      )
        return;
      if (intent.intent === "contribute" && result.outcome === "accepted" && result.contribution) {
        await writeContributionReceipts(
          upsertContributionReceipt(
            await readContributionReceipts(generation),
            receiptFromContribution(result.contribution, session.identityFence),
          ),
          generation,
        );
      }
      const settled = settleDispatch(intent, result, now);
      await writePendingQueue(
        current.flatMap((item) =>
          item.id === intent.id && item.identityFence === intent.identityFence
            ? settled
              ? [settled]
              : []
            : [item],
        ),
        generation,
      );
    });
  }
  return summarizeQueue(await pendingQueue(generation));
}

async function ownerAction(
  message: Extract<ReturnType<typeof parseExtensionMessage>, { contributionId: string }>,
  generation: number,
) {
  if (!message || !extensionConfiguration.apiOrigin) {
    throw new Error("api_configuration_required");
  }
  const session = await authenticatedApiSession();
  const all = await contributionReceipts(generation);
  const receipt = receiptsForIdentity(all, session.identityFence).find(
    (item) => item.contributionId === message.contributionId,
  );
  if (!receipt) throw new Error("contribution_required");
  assertIdentityGeneration(generation);
  const result =
    message.action === "cancel_contribution" && !receipt.trust
      ? await cancelContribution(
          receipt.contributionId,
          session.accessToken,
          extensionConfiguration.apiOrigin,
        )
      : message.action === "contribution_refresh"
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
    const currentSession = await authenticatedApiSession();
    if (generation !== identityGeneration || currentSession.identityFence !== session.identityFence)
      return "rejected" as const;
    const committed = await withLocalMutation(generation, async () => {
      const currentReceipts = await readContributionReceipts(generation);
      const currentReceipt = receiptsForIdentity(currentReceipts, session.identityFence).find(
        (item) => item.contributionId === receipt.contributionId,
      );
      if (!currentReceipt) return false;
      const updated =
        message.action === "contribution_refresh" || message.action === "cancel_contribution"
          ? updateContributionStatus(
              currentReceipt,
              result.value as import("@ai-job-apply/api-contracts").JobContribution,
            )
          : updateTrustStatus(
              currentReceipt,
              result.value as import("@ai-job-apply/api-contracts").OwnerTrustCase,
            );
      if (message.action === "contribution_refresh" || message.action === "cancel_contribution") {
        if (Date.parse(updated.updatedAt) < Date.parse(currentReceipt.updatedAt)) return true;
      } else if (currentReceipt.trust && updated.trust) {
        if (updated.trust.version < currentReceipt.trust.version) return true;
        if (updated.trust.version === currentReceipt.trust.version) {
          // An old identical read is harmless; contradictory evidence at the same version is not.
          return (
            updated.trust.state === currentReceipt.trust.state &&
            updated.trust.appealed === currentReceipt.trust.appealed &&
            updated.trust.updatedAt === currentReceipt.trust.updatedAt &&
            updated.trust.appealDeadlineAt === currentReceipt.trust.appealDeadlineAt
          );
        }
      }
      await writeContributionReceipts(
        upsertContributionReceipt(currentReceipts, updated),
        generation,
      );
      return true;
    });
    if (!committed) return "rejected" as const;
  }
  return result.outcome;
}

async function captureCurrentPage(
  generation: number,
): Promise<{ capture: SanitizedJobCapture; ok: true } | { error: string; ok: false }> {
  const tab = await activeBrowserTab();
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
  await withLocalMutation(generation, async () => {
    await chrome.storage.session.set({
      [LAST_CAPTURE_KEY]: { capture, tabId: tab.id, tabUrl: tab.url },
    });
  });
  return { capture, ok: true };
}

async function enqueue(
  intent: "contribute" | "private_save",
  approvedFields: readonly CaptureField[],
  generation: number,
) {
  const tab = await activeBrowserTab();
  const stored = await chrome.storage.session.get(LAST_CAPTURE_KEY);
  const last = stored[LAST_CAPTURE_KEY] as LastCapture | undefined;
  if (!last || !tab?.id || last.tabId !== tab.id || last.tabUrl !== tab.url) {
    throw new Error("capture_required");
  }
  if (intent === "contribute") {
    await contributionPolicyStartup;
    await contributionPolicy.refresh();
    if (!contributionPolicy.decision(last.capture, chrome.runtime.getManifest().version).allowed) {
      throw new Error(
        extensionConfiguration.developmentContributions
          ? "development_contribution_disabled"
          : "contribution_capability_disabled",
      );
    }
  }
  const session = await authenticatedApiSession();
  if (!extensionConfiguration.pendingRetentionMilliseconds) {
    throw new Error("retention_policy_required");
  }
  const created = createPendingIntent({
    approvedFields,
    capture: last.capture,
    identityFence: session.identityFence,
    intent,
    retentionMilliseconds: extensionConfiguration.pendingRetentionMilliseconds,
  });
  if (intent === "contribute") {
    // Refuse oversized selected fields before persisting an undeliverable intent or granting
    // consent. Keep the complete preview so the user can remove optional fields and try again.
    await prepareContribution(
      created,
      extensionConfiguration.ugcContributionPolicyVersion,
      chrome.runtime.getManifest().version,
    );
  }
  await updatePendingQueue(generation, (queue) => {
    if (queue.length >= MAXIMUM_QUEUE_ITEMS) throw new Error("queue_capacity_reached");
    return [...queue, created];
  });
  return dispatchPending(false, generation);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void dispatchPending().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  contributionPolicyStartup = storageBoundaryStartup.then(() => contributionPolicy.start());
  void contributionPolicyStartup.then(() => dispatchPending()).catch(() => undefined);
});
chrome.runtime.onInstalled.addListener(() => {
  contributionPolicyStartup = storageBoundaryStartup.then(() => contributionPolicy.start());
  void contributionPolicyStartup.then(() => dispatchPending()).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = parseExtensionMessage(rawMessage);
  if (!message || !trustedSender(sender)) {
    sendResponse({ error: "Invalid extension request.", ok: false });
    return false;
  }
  const identityAction = message.action === "login" || message.action === "logout";
  const generation = identityAction ? ++identityGeneration : identityGeneration;
  if (identityAction) identityTransition = generation;
  const logoutClearing = message.action === "logout" ? clearLocalForLogout() : undefined;
  void logoutClearing?.catch(() => undefined);
  void (async () => {
    let historyResult: SharedJobsState | undefined;
    try {
      await storageBoundaryStartup;
      if (identityAction) {
        try {
          if (message.action === "login") await login();
          else {
            const results = await Promise.allSettled([logout(), logoutClearing]);
            for (const result of results) {
              if (result.status === "rejected") throw result.reason;
            }
          }
        } finally {
          if (identityTransition === generation) identityTransition = undefined;
        }
      } else if (message.action === "refresh") {
        assertIdentityGeneration(generation);
        await refresh();
      } else if (message.action === "shared_jobs_refresh") {
        historyResult = await refreshSharedJobs(generation);
      } else if (message.action === "clear_queue") await updatePendingQueue(generation, () => []);
      else if (message.action === "clear_stopped") {
        await updatePendingQueue(generation, (queue) =>
          queue.filter((intent) => intent.state === "pending"),
        );
      } else if (message.action === "capture") {
        const result = await captureCurrentPage(generation);
        return {
          ...result,
          delivery: await deliveryReadiness(result.ok ? result.capture : undefined),
          status: await authenticationStatus(),
        };
      } else if (message.action === "enqueue") {
        const queue = await enqueue(message.intent, message.approvedFields, generation);
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
          queue: await dispatchPending(true, generation),
          status: await authenticationStatus(),
        };
      } else if (message.action === "retry_stopped") {
        await updatePendingQueue(generation, (queue) =>
          queue.map((intent) => restartStoppedIntent(intent)),
        );
        return {
          delivery: await deliveryReadiness(await activeStoredCapture()),
          ok: true,
          queue: await dispatchPending(true, generation),
          status: await authenticationStatus(),
        };
      } else if (
        [
          "contribution_refresh",
          "trust_refresh",
          "withdraw",
          "appeal",
          "cancel_contribution",
        ].includes(message.action)
      ) {
        const outcome = await ownerAction(message as Parameters<typeof ownerAction>[0], generation);
        const session = await authenticatedApiSession();
        return {
          delivery: await deliveryReadiness(await activeStoredCapture()),
          ok: outcome === "ok",
          ownerAction: outcome,
          receipts: receiptsForIdentity(await contributionReceipts(), session.identityFence),
          status: await authenticationStatus(),
        };
      }
      const queue = await pendingQueue(generation);
      const history = await sharedJobsSnapshot(generation);
      return {
        delivery: await deliveryReadiness(await activeStoredCapture()),
        ok: historyResult === undefined || historyResult === "refreshed",
        queue: summarizeQueue(queue),
        ...history,
        sharedJobsState:
          history.sharedJobsState === "cached"
            ? (historyResult ?? "cached")
            : history.sharedJobsState,
        status: await authenticationStatus(),
      };
    } catch (error) {
      if (identityAction && identityTransition === generation) identityTransition = undefined;
      return {
        delivery: await deliveryReadiness(await activeStoredCapture()),
        error: safeActionErrorMessage(error, message.action),
        ok: false,
        ...(["shared_jobs_refresh", "status", "pending", "refresh", "login", "logout"].includes(
          message.action,
        )
          ? { sharedJobsState: sharedJobsFailure(error), receipts: [] }
          : {}),
        status: await authenticationStatus(),
      };
    }
  })()
    .then((response) => {
      if (generation !== identityGeneration) {
        sendResponse({
          error: safeActionErrorMessage(new Error("identity_changed"), message.action),
          ok: false,
          ...("contributionId" in message ? { ownerAction: "rejected" as const } : {}),
        });
      } else sendResponse(response);
    })
    .catch(() => {
      sendResponse({
        ok: false,
        error:
          "Extension storage is unavailable. Close and reopen the extension, then try again. Saved data was not cleared.",
        ...(generation === identityGeneration
          ? { sharedJobsState: "storage_unavailable", receipts: [] }
          : {}),
      });
    });
  return true;
});
