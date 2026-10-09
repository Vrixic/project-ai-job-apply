import { mountApplicationHandoff } from "../lib/application-handoff-ui";
import { extensionConfiguration } from "../lib/config";
import { appealEvidenceDigest } from "../lib/contribution-owner-api";
import { CAPTURE_FIELDS, type CaptureField, type SanitizedJobCapture } from "../lib/job-capture";

interface AuthStatus {
  apiConfigured: boolean;
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
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

interface DeliveryCapabilityReadiness {
  ready: boolean;
  reason: DeliveryReadinessReason;
}

interface DeliveryReadiness {
  contribution: DeliveryCapabilityReadiness;
  privateSave: DeliveryCapabilityReadiness;
}

interface QueueStatus {
  blocked: number;
  lastError?: string;
  pending: number;
  stopped: number;
}

interface ExtensionResponse {
  deliveryOutcome?: "acknowledged" | "pending" | "stopped" | "blocked" | "unconfirmed";
  capture?: SanitizedJobCapture;
  delivery?: DeliveryReadiness;
  error?: string;
  ok: boolean;
  queue?: QueueStatus;
  ownerAction?: "ok" | "not_found" | "unavailable" | "version_conflict" | "rejected";
  receipts?: ContributionReceipt[];
  sharedJobsState?:
    | "cached"
    | "refreshed"
    | "sign_in_required"
    | "storage_unavailable"
    | "unavailable"
    | "rejected";
  status?: AuthStatus;
}

interface ContributionReceipt {
  contributionId: string;
  state: string;
  trust?: { appealed: boolean; state: string; version: number };
}

const node = <T extends Element>(selector: string): T => {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing extension control: ${selector}`);
  return result;
};

const authStatus = node<HTMLElement>("#auth-status");
const detail = node<HTMLElement>("#detail");
const queueStatus = document.querySelector<HTMLElement>("#queue-status");
const preview = node<HTMLElement>("#preview");
const previewHeading = node<HTMLElement>("#preview-heading");
const fieldList = node<HTMLElement>("#field-list");
const selectionSummary = node<HTMLElement>("#selection-summary");
const deliveryReadiness = node<HTMLElement>("#delivery-readiness");
const loginButton = node<HTMLButtonElement>("#login");
const refreshButton = node<HTMLButtonElement>("#refresh");
const logoutButton = node<HTMLButtonElement>("#logout");
const inspectButton = node<HTMLButtonElement>("#inspect");
const contributeButton = node<HTMLButtonElement>("#contribute");
const retryButton = document.querySelector<HTMLButtonElement>("#retry");
const retryStoppedButton = document.querySelector<HTMLButtonElement>("#retry-stopped");
const clearStoppedButton = document.querySelector<HTMLButtonElement>("#clear-stopped");
const clearQueueButton = document.querySelector<HTMLButtonElement>("#clear-queue");
const main = node<HTMLElement>("main");
const contributionsPanel = document.querySelector<HTMLDetailsElement>("#contributions-panel");
const queuePanel = document.querySelector<HTMLDetailsElement>("#queue-panel");
const contributionsStatus = document.querySelector<HTMLElement>("#contributions-status");
const contributionList = document.querySelector<HTMLElement>("#contribution-list");
const sharedJobsRefreshButton = document.querySelector<HTMLButtonElement>("#refresh-shared-jobs");
const sharedJobsStatus = document.querySelector<HTMLElement>("#shared-jobs-status");
const ownerActionStatus = document.querySelector<HTMLElement>("#owner-action-status");
const appealDialog = document.querySelector<HTMLDialogElement>("#appeal-dialog");
const appealForm = document.querySelector<HTMLFormElement>("#appeal-form");
const appealEvidence = document.querySelector<HTMLTextAreaElement>("#appeal-evidence");
const cancelAppeal = document.querySelector<HTMLButtonElement>("#cancel-appeal");

const readinessCopy: Record<DeliveryReadinessReason, string> = {
  development_capture_disabled:
    "This development build accepts only explicitly selected and detector-enabled provider pages for extension version 0.2.0.",
  api_configuration_required: "Configure the API origin to deliver selected fields.",
  identity_configuration_required: "Add public Auth0 settings, then sign in.",
  policy_configuration_required: extensionConfiguration.developmentContributions
    ? "Configure the public-add preview authorization version before delivery."
    : "Configure the public contribution policy before sharing.",
  preview_required: "Inspect a supported public job first.",
  ready: "Ready.",
  retention_configuration_required: "Configure pending-item retention before delivery.",
  sign_in_required: "Sign in to continue.",
  signed_policy_disabled: "The signed policy currently disables public contribution.",
  signed_policy_unavailable:
    "The signed contribution policy is unavailable or expired. Wait 15 seconds, then inspect the current tab again to recheck.",
};

const busyCopy: Record<string, string> = {
  appeal: "Submitting the appeal…",
  capture: "Inspecting the current tab…",
  cancel_contribution: "Cancelling the contribution before verification…",
  clear_queue: "Removing queued items…",
  clear_stopped: "Removing stopped items…",
  contribution_refresh: "Refreshing contribution status…",
  contribute: "Adding the job to the shared review queue…",
  login: "Opening sign in…",
  logout: "Signing out…",
  refresh: "Refreshing the session…",
  retry: "Retrying queued delivery…",
  retry_stopped: "Retrying stopped delivery…",
  status: "Checking extension readiness…",
  shared_jobs_refresh: "Loading your latest shared jobs…",
  trust_refresh: "Refreshing Trust status…",
  withdraw: "Withdrawing the contribution…",
};

let currentCapture: SanitizedJobCapture | undefined;
let currentDelivery: DeliveryReadiness | undefined;
let appealContributionId: string | undefined;
let appealSubmitting = false;
let appealOutcome: string | undefined;
let busy = false;
let authenticated = false;
let fieldSequence = 0;

function controls(): HTMLButtonElement[] {
  return [
    loginButton,
    refreshButton,
    logoutButton,
    inspectButton,
    contributeButton,
    retryButton,
    retryStoppedButton,
    clearStoppedButton,
    clearQueueButton,
    sharedJobsRefreshButton,
    ...fieldList.querySelectorAll<HTMLButtonElement>("button"),
    ...(contributionList?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ...(appealForm?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].filter((button): button is HTMLButtonElement => button !== null);
}

function updateControlState(): void {
  for (const button of controls()) button.disabled = busy;
  if (busy) return;

  inspectButton.disabled = false;
  contributeButton.disabled = !currentCapture || currentDelivery?.contribution.ready !== true;
  if (sharedJobsRefreshButton) sharedJobsRefreshButton.disabled = !authenticated;
}

function setBusy(nextBusy: boolean, action?: string): void {
  busy = nextBusy;
  main.setAttribute("aria-busy", String(nextBusy));
  if (nextBusy && action) detail.textContent = busyCopy[action] ?? "Working…";
  updateControlState();
}

function renderDeliveryReadiness(): void {
  if (!currentDelivery) {
    deliveryReadiness.textContent =
      "Adding this job is unavailable until delivery readiness is confirmed.";
    return;
  }
  deliveryReadiness.textContent = currentDelivery.contribution.ready
    ? "Ready to add all available public job fields."
    : readinessCopy[currentDelivery.contribution.reason];
}

function renderSessionStatus(status: AuthStatus): void {
  authenticated = status.authenticated;
  if (!authenticated) appealOutcome = undefined;
  if (!authenticated) renderReceipts([], "sign_in_required");
  authStatus.textContent = status.configured
    ? status.authenticated
      ? "Signed in"
      : status.refreshAvailable
        ? "Session expired"
        : "Signed out"
    : "Identity configuration required";
  loginButton.hidden = status.authenticated || !status.configured;
  refreshButton.hidden = !status.configured || !status.refreshAvailable;
  logoutButton.hidden = !status.configured || (!status.authenticated && !status.refreshAvailable);

  if (!status.configured) {
    detail.textContent = "Inspection is ready. Add public Auth0 settings to enable shared jobs.";
  } else if (!status.authenticated) {
    detail.textContent = status.refreshAvailable
      ? "Refresh your session or sign in again before adding a shared job. Sign out to clear the retained session."
      : "Inspection is ready. Sign in before adding a shared job.";
  } else if (!status.apiConfigured) {
    detail.textContent = "Inspection is ready. Configure the API origin to enable shared jobs.";
  } else {
    detail.textContent = "Inspection is ready. You are signed in to add shared jobs.";
  }
}

function renderStatus(response: ExtensionResponse): void {
  if (response.status) {
    renderSessionStatus(response.status);
  }
  if (response.delivery) currentDelivery = response.delivery;
  renderDeliveryReadiness();

  if (
    response.queue &&
    queueStatus &&
    retryButton &&
    retryStoppedButton &&
    clearStoppedButton &&
    clearQueueButton &&
    queuePanel
  ) {
    const failure = response.queue.lastError
      ? {
          contribution_capability_policy_unavailable:
            extensionConfiguration.developmentContributions
              ? "Development contribution unavailable"
              : "Policy service unavailable",
          authentication_required: "Sign in again to deliver",
          http_429: "Rate limited",
          http_5xx: "Server unavailable",
          internal_error: "Internal server error",
          invalid_response: "Invalid server response",
          identity_changed: "Held for a different signed-in session",
          job_contribution_unavailable: "Contribution service unavailable",
          network_error: "Network unavailable",
          request_rejected: "Request rejected",
          request_too_large: "Job details exceed the delivery size limit",
          retry_exhausted: "Retries exhausted",
          retryable: "Delivery unavailable",
          ugc_contribution_consent_unavailable: "Consent service unavailable",
        }[response.queue.lastError]
      : undefined;
    const blocked = response.queue.blocked > 0 ? ` · ${response.queue.blocked} account-held` : "";
    queueStatus.textContent = `${response.queue.pending} pending · ${response.queue.stopped} stopped${blocked}${failure ? ` · ${failure}` : ""}`;
    retryButton.hidden = response.queue.pending === 0;
    retryStoppedButton.hidden = response.queue.stopped === 0;
    clearStoppedButton.hidden = response.queue.stopped + response.queue.blocked === 0;
    clearQueueButton.hidden =
      response.queue.pending + response.queue.stopped + response.queue.blocked === 0;
    if (response.queue.stopped + response.queue.blocked > 0) queuePanel.open = true;
  }
  if (response.receipts) renderReceipts(response.receipts, response.sharedJobsState);
  if (response.ownerAction && ownerActionStatus && contributionsPanel) {
    const latestOutcome = {
      ok: "Contribution information updated.",
      not_found: "No owner-visible record is available yet. Refresh again after processing.",
      unavailable: "The service is unavailable. Your saved receipt was kept; try again later.",
      version_conflict: "The record changed. Refresh Trust status before trying again.",
      rejected: "The request was not accepted. Refresh status before trying again.",
    }[response.ownerAction];
    ownerActionStatus.textContent = appealOutcome
      ? `${appealOutcome} ${latestOutcome}`
      : latestOutcome;
    contributionsPanel.open = true;
    ownerActionStatus.focus();
  }
  if (response.error) detail.textContent = response.error;
  if (currentCapture) updateSelectionSummary();
  else updateControlState();
}

function renderReceipts(
  receipts: ContributionReceipt[],
  state: ExtensionResponse["sharedJobsState"] = "cached",
): void {
  if (!contributionList || !contributionsStatus || !sharedJobsStatus) return;
  contributionList.replaceChildren();
  contributionsStatus.textContent =
    receipts.length > 0
      ? `${receipts.length} saved`
      : state === "refreshed"
        ? "No shared jobs"
        : state === "sign_in_required"
          ? "Sign in required"
          : state === "cached"
            ? "History not loaded"
            : "History unavailable";
  sharedJobsStatus.textContent = {
    cached:
      "Showing this device's saved status. Refresh shared jobs to load your latest 25 contributions from your account.",
    refreshed:
      "Your latest shared jobs were loaded. Up to 25 receipts are kept on this device; Trust status refreshes separately.",
    sign_in_required:
      "Sign in or refresh your session to load your shared jobs. Do not submit the jobs again.",
    storage_unavailable:
      "This device's contribution history could not be read. Close and reopen the extension, then try again. No data was cleared.",
    unavailable:
      "Shared jobs could not be loaded. Saved receipts were kept; try Refresh shared jobs again later.",
    rejected:
      "The shared-job history response was not accepted. Saved receipts were kept; try again later.",
  }[state];
  if (!receipts.length) {
    const empty = document.createElement("p");
    empty.textContent =
      state === "refreshed"
        ? "No shared jobs were returned for this account."
        : state === "cached"
          ? "No contribution receipts are saved on this device. This does not mean your shared jobs were deleted."
          : "Your contribution history is not available in this view yet.";
    contributionList.append(empty);
    return;
  }
  for (const receipt of receipts) {
    const article = document.createElement("article");
    article.className = "contribution-receipt";
    const heading = document.createElement("h3");
    heading.textContent = `Contribution ${receipt.contributionId.slice(0, 8)}`;
    const state = document.createElement("p");
    state.textContent =
      receipt.state === "consent_invalid"
        ? "Contribution authorization ended. It cannot be published under this authorization."
        : `Processing: ${receipt.state.replaceAll("_", " ")}`;
    const trust = document.createElement("p");
    trust.textContent = receipt.trust
      ? `Trust: ${receipt.trust.state.replaceAll("_", " ")}${receipt.trust.appealed ? " · appealed" : ""}`
      : "Trust: refresh to check";
    const actions = document.createElement("div");
    actions.className = "actions compact";
    const add = (label: string, action: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiet";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (action === "appeal") {
          if (!appealDialog || !appealEvidence) return;
          appealContributionId = receipt.contributionId;
          appealEvidence.value = "";
          appealForm?.querySelector("[data-appeal-error]")?.remove();
          appealDialog.showModal();
          appealEvidence.focus();
          return;
        }
        if (
          action === "withdraw" &&
          !window.confirm("Withdraw this contribution from Trust eligibility?")
        )
          return;
        if (
          action === "cancel_contribution" &&
          !window.confirm(
            "Cancel this contribution before verification? This ends its publication authorization and keeps the receipt.",
          )
        )
          return;
        void invoke({
          action,
          contributionId: receipt.contributionId,
          ...(action === "withdraw" || action === "cancel_contribution" ? { confirmed: true } : {}),
        });
      });
      actions.append(button);
    };
    add("Refresh processing", "contribution_refresh");
    add("Refresh Trust", "trust_refresh");
    if (receipt.trust) {
      add("Withdraw", "withdraw");
      add("Appeal", "appeal");
    } else if (
      ["queued", "normalized", "awaiting_independent_verification"].includes(receipt.state)
    ) {
      add("Cancel contribution", "cancel_contribution");
    }
    article.append(heading, state, trust, actions);
    contributionList.append(article);
  }
}

function appendField(
  container: HTMLElement,
  label: string,
  value: string | undefined,
  options: {
    expandable?: "description" | "source-url";
    field?: CaptureField;
    kind: "required" | "system" | "display";
    translateNo?: boolean;
    unavailableMessage?: string;
  },
): void {
  const row = document.createElement("div");
  const valueId = `capture-field-${fieldSequence++}`;
  const missing = options.field !== undefined && !value;
  row.className = "field-row";
  row.dataset.fieldKind = missing ? "unavailable" : options.field ? "included" : options.kind;
  if (options.field) row.dataset.field = options.field;

  const content = document.createElement("span");
  content.className = "field-content";
  const labelLine = document.createElement("span");
  labelLine.className = "field-label-line";
  const heading = document.createElement("span");
  heading.className = "field-label";
  heading.textContent = label;
  const requirement = document.createElement("span");
  requirement.className = "field-requirement";
  requirement.textContent = options.field
    ? missing
      ? "Unavailable"
      : "Included"
    : "Always included";
  labelLine.append(heading);
  if (options.kind !== "display") labelLine.append(requirement);
  const body = document.createElement("span");
  body.className = `field-value${missing ? " not-detected" : ""}`;
  body.id = valueId;
  body.textContent = value ?? options.unavailableMessage ?? "Not available for sharing";
  if (options.translateNo) body.translate = false;
  content.append(labelLine, body);

  row.append(content);

  const expandable =
    !missing &&
    options.expandable &&
    ((options.expandable === "description" && (value?.length ?? 0) > 240) ||
      (options.expandable === "source-url" && (value?.length ?? 0) > 76));
  if (expandable) {
    body.classList.add("is-collapsed");
    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className = "expand-field";
    expandButton.dataset.expandField = options.expandable;
    expandButton.setAttribute("aria-controls", valueId);
    expandButton.setAttribute("aria-expanded", "false");
    expandButton.textContent =
      options.expandable === "source-url" ? "Show full URL" : "Show full description";
    expandButton.addEventListener("click", () => {
      const expanded = expandButton.getAttribute("aria-expanded") === "true";
      expandButton.setAttribute("aria-expanded", String(!expanded));
      body.classList.toggle("is-collapsed", expanded);
      expandButton.textContent = expanded
        ? options.expandable === "source-url"
          ? "Show full URL"
          : "Show full description"
        : options.expandable === "source-url"
          ? "Hide full URL"
          : "Hide full description";
    });
    row.append(expandButton);
  }
  container.append(row);
}

function selectedFields(): CaptureField[] {
  return CAPTURE_FIELDS.filter(
    (field) =>
      field !== "title" &&
      Boolean(currentCapture?.[field]) &&
      (field !== "workMode" || Boolean(displayWorkMode(currentCapture?.workMode))),
  );
}

function displayWorkMode(value: SanitizedJobCapture["workMode"]): string | undefined {
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "on_site") return "In person";
  return undefined;
}

function updateSelectionSummary(): void {
  if (!currentCapture) {
    selectionSummary.textContent = "";
    return;
  }
  const includedFields = selectedFields().length;
  const assumedWorkMode = !displayWorkMode(currentCapture.workMode);
  const missing = CAPTURE_FIELDS.length - includedFields - 1 - Number(assumedWorkMode);
  const nextAction = currentDelivery?.contribution.ready
    ? "Next action: Add job to shared database"
    : "Delivery unavailable: review readiness below";
  selectionSummary.textContent = `All available public job fields included · ${nextAction}${
    missing > 0 ? ` · ${missing} unavailable for sharing` : ""
  }`;

  const sourceSummary = fieldList.querySelector<HTMLElement>("#source-summary");
  if (sourceSummary) {
    sourceSummary.textContent = !currentCapture.externalJobId
      ? "4 always included · External job ID unavailable for sharing"
      : "Source details and external job ID included";
  }
  updateControlState();
}

function renderCapture(capture: SanitizedJobCapture): void {
  currentCapture = capture;
  fieldSequence = 0;
  fieldList.replaceChildren();

  const jobGroup = document.createElement("section");
  jobGroup.className = "field-group";
  jobGroup.setAttribute("aria-labelledby", "job-details-heading");
  const jobHeading = document.createElement("h3");
  jobHeading.id = "job-details-heading";
  jobHeading.className = "field-group-heading";
  jobHeading.textContent = "Job details";
  jobGroup.append(jobHeading);
  appendField(jobGroup, "Title", capture.title, { kind: "required" });
  appendField(jobGroup, "Company", capture.company, { field: "company", kind: "system" });
  appendField(jobGroup, "Location", capture.location, { field: "location", kind: "system" });
  const workMode = displayWorkMode(capture.workMode);
  appendField(
    jobGroup,
    "Work type",
    workMode ?? "In person",
    workMode ? { field: "workMode", kind: "system" } : { kind: "display" },
  );
  appendField(jobGroup, "Description", capture.description, {
    expandable: "description",
    field: "description",
    kind: "system",
    ...(capture.descriptionUnavailableReason === "too_long"
      ? {
          unavailableMessage:
            "Description exceeds the 50,000-character limit. No shortened description will be shared.",
        }
      : capture.descriptionUnavailableReason === "source_too_large"
        ? {
            unavailableMessage:
              "Description source exceeds the safe capture limit. No shortened description will be shared.",
          }
        : {}),
  });

  const sourceDetails = document.createElement("details");
  sourceDetails.id = "source-details";
  sourceDetails.className = "source-details";
  const sourceHeading = document.createElement("summary");
  const sourceTitle = document.createElement("span");
  sourceTitle.textContent = "Source details";
  const sourceSummary = document.createElement("span");
  sourceSummary.id = "source-summary";
  sourceSummary.className = "summary-status";
  sourceHeading.append(sourceTitle, sourceSummary);
  const sourceFields = document.createElement("div");
  sourceFields.className = "source-fields";
  appendField(sourceFields, "Provider", capture.provider, { kind: "system", translateNo: true });
  appendField(sourceFields, "Page variant", capture.pageVariant, {
    kind: "system",
    translateNo: true,
  });
  appendField(
    sourceFields,
    "Submitting client",
    `Browser extension ${chrome.runtime.getManifest().version}`,
    { kind: "system", translateNo: true },
  );
  appendField(sourceFields, "Public URL", capture.sourceUrl, {
    expandable: "source-url",
    kind: "system",
    translateNo: true,
  });
  appendField(sourceFields, "External job ID", capture.externalJobId, {
    field: "externalJobId",
    kind: "system",
    translateNo: true,
  });
  sourceDetails.append(sourceHeading, sourceFields);
  fieldList.append(jobGroup, sourceDetails);

  preview.hidden = false;
  detail.textContent =
    "Preview ready. Review the detected fields before choosing a delivery action.";
  updateSelectionSummary();
  renderDeliveryReadiness();
  previewHeading.focus();
}

function successMessage(action: string, response: ExtensionResponse): string | undefined {
  if (!response.ok) return undefined;
  if (action === "enqueue") {
    switch (response.deliveryOutcome) {
      case "acknowledged":
        return "Job received for review. Provider verification happens before publication.";
      case "pending":
        return "Job saved on this device, but delivery is not confirmed. ApplyDash will retry automatically; do not add it again.";
      case "stopped":
        return "Job delivery stopped and has not been confirmed. Contact support before adding it again.";
      case "blocked":
        return "Job delivery is held for the original signed-in account. Sign in with that account; do not add it again.";
      default:
        return "Job delivery could not be confirmed. Do not add it again until its status is resolved.";
    }
  }
  if (action === "retry") return "Queued delivery was retried. Review the queue counts below.";
  if (action === "retry_stopped") {
    return "Stopped delivery was restarted with its original idempotency key.";
  }
  if (action === "clear_stopped") return "Stopped items were removed from this device.";
  if (action === "clear_queue") return "All queued items were removed from this device.";
  return undefined;
}

async function invoke(message: Record<string, unknown>): Promise<ExtensionResponse> {
  const action = String(message.action ?? "status");
  const busyAction = action === "enqueue" ? String(message.intent ?? action) : action;
  setBusy(true, busyAction);
  try {
    const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse;
    renderStatus(response);
    if (
      action === "shared_jobs_refresh" &&
      response.sharedJobsState &&
      contributionsPanel &&
      sharedJobsStatus
    ) {
      contributionsPanel.open = true;
      sharedJobsStatus.focus();
    }
    if (response.capture) {
      renderCapture(response.capture);
    } else if (action === "capture" && !response.ok) {
      currentCapture = undefined;
      preview.hidden = true;
      updateControlState();
    }
    const confirmation = successMessage(action, response);
    if (confirmation) detail.textContent = confirmation;
    return response;
  } catch {
    const response: ExtensionResponse = {
      error: "The extension did not respond. Close and reopen it, then try again.",
      ok: false,
    };
    renderStatus(response);
    return response;
  } finally {
    setBusy(false);
  }
}

loginButton.addEventListener("click", () => void invoke({ action: "login" }));
refreshButton.addEventListener("click", () => void invoke({ action: "refresh" }));
logoutButton.addEventListener("click", () => {
  appealOutcome = undefined;
  if (ownerActionStatus) ownerActionStatus.textContent = "";
  currentCapture = undefined;
  currentDelivery = undefined;
  preview.hidden = true;
  authenticated = false;
  renderReceipts([], "sign_in_required");
  void invoke({ action: "logout" });
});
sharedJobsRefreshButton?.addEventListener(
  "click",
  () => void invoke({ action: "shared_jobs_refresh" }),
);
inspectButton.addEventListener("click", () => void invoke({ action: "capture" }));
retryButton?.addEventListener("click", () => void invoke({ action: "retry" }));
retryStoppedButton?.addEventListener("click", () => {
  if (
    window.confirm(
      "Retry stopped deliveries now? The original selected fields and idempotency keys will be reused.",
    )
  ) {
    void invoke({ action: "retry_stopped" });
  }
});
clearStoppedButton?.addEventListener("click", () => void invoke({ action: "clear_stopped" }));
clearQueueButton?.addEventListener("click", () => {
  if (window.confirm("Remove every pending and stopped item from this device?")) {
    void invoke({ action: "clear_queue" });
  }
});
contributeButton.addEventListener("click", () => {
  if (currentCapture && currentDelivery?.contribution.ready) {
    void invoke({ action: "enqueue", approvedFields: selectedFields(), intent: "contribute" });
  }
});
cancelAppeal?.addEventListener("click", () => appealDialog?.close());
appealDialog?.addEventListener("close", () => {
  if (appealEvidence) appealEvidence.value = "";
  appealContributionId = undefined;
});
appealForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!appealEvidence || !appealDialog || appealSubmitting || busy) return;
  const evidenceText = appealEvidence.value;
  const contributionId = appealContributionId;
  if (
    !contributionId ||
    !evidenceText.trim() ||
    !window.confirm("Submit this appeal evidence digest now?")
  )
    return;
  appealSubmitting = true;
  setBusy(true, "appeal");
  let dispatched = false;
  try {
    const evidenceDigestSha256 = await appealEvidenceDigest(evidenceText);
    appealDialog.close();
    dispatched = true;
    const response = await invoke({
      action: "appeal",
      confirmed: true,
      contributionId,
      evidenceDigestSha256,
    });
    const confirmed =
      response.ok &&
      response.receipts?.some(
        (receipt) => receipt.contributionId === contributionId && receipt.trust?.appealed,
      );
    appealOutcome = !authenticated
      ? undefined
      : confirmed
        ? "Appeal recorded. An independent reviewer must resolve it."
        : response.ownerAction === "version_conflict"
          ? "Appeal not recorded: the server reported a conflict. Refresh Trust and contact the operator before submitting again."
          : "Appeal submission was not confirmed. Refresh Trust and contact the operator before submitting again.";
    if (ownerActionStatus && authenticated && appealOutcome) {
      ownerActionStatus.textContent = appealOutcome;
      ownerActionStatus.focus();
    }
  } catch {
    const message = dispatched
      ? "Appeal submission was not confirmed. Refresh Trust and contact the operator before submitting again."
      : "Appeal could not be prepared. Nothing was submitted. Your text is still available; try again.";
    detail.textContent = message;
    // Keep the failure inside the modal so it is visible while the modal remains open.
    let failure = appealForm.querySelector<HTMLElement>("[data-appeal-error]");
    if (!failure) {
      failure = document.createElement("p");
      failure.dataset.appealError = "true";
      failure.setAttribute("role", "alert");
      appealForm.append(failure);
    }
    failure.textContent = message;
  } finally {
    appealSubmitting = false;
    setBusy(false);
  }
});

renderDeliveryReadiness();
mountApplicationHandoff();
void invoke({ action: "status" });
