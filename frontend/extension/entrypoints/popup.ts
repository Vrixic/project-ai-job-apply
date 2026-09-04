import { appealEvidenceDigest } from "../lib/contribution-owner-api";
import { CAPTURE_FIELDS, type CaptureField, type SanitizedJobCapture } from "../lib/job-capture";

interface AuthStatus {
  apiConfigured: boolean;
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
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

interface DeliveryCapabilityReadiness {
  ready: boolean;
  reason: DeliveryReadinessReason;
}

interface DeliveryReadiness {
  contribution: DeliveryCapabilityReadiness;
  privateSave: DeliveryCapabilityReadiness;
}

interface QueueStatus {
  lastError?: string;
  pending: number;
  stopped: number;
}

interface ExtensionResponse {
  capture?: SanitizedJobCapture;
  delivery?: DeliveryReadiness;
  error?: string;
  ok: boolean;
  queue?: QueueStatus;
  ownerAction?: "ok" | "not_found" | "unavailable" | "version_conflict" | "rejected";
  receipts?: ContributionReceipt[];
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
const queueStatus = node<HTMLElement>("#queue-status");
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
const retryButton = node<HTMLButtonElement>("#retry");
const retryStoppedButton = node<HTMLButtonElement>("#retry-stopped");
const clearStoppedButton = node<HTMLButtonElement>("#clear-stopped");
const clearQueueButton = node<HTMLButtonElement>("#clear-queue");
const main = node<HTMLElement>("main");
const queuePanel = node<HTMLDetailsElement>("#queue-panel");
const contributionsPanel = node<HTMLDetailsElement>("#contributions-panel");
const contributionsStatus = node<HTMLElement>("#contributions-status");
const contributionList = node<HTMLElement>("#contribution-list");
const ownerActionStatus = node<HTMLElement>("#owner-action-status");
const appealDialog = node<HTMLDialogElement>("#appeal-dialog");
const appealForm = node<HTMLFormElement>("#appeal-form");
const appealEvidence = node<HTMLTextAreaElement>("#appeal-evidence");
const cancelAppeal = node<HTMLButtonElement>("#cancel-appeal");

const readinessCopy: Record<DeliveryReadinessReason, string> = {
  api_configuration_required: "Configure the API origin to deliver selected fields.",
  identity_configuration_required: "Add public Auth0 settings, then sign in.",
  policy_configuration_required: "Configure the public contribution policy before sharing.",
  preview_required: "Inspect a supported public job first.",
  ready: "Ready.",
  retention_configuration_required: "Configure pending-item retention before delivery.",
  sign_in_required: "Sign in to continue.",
  signed_policy_disabled: "The signed policy currently disables public contribution.",
  signed_policy_unavailable: "The signed contribution policy is unavailable. Try again later.",
};

const busyCopy: Record<string, string> = {
  appeal: "Submitting the appeal…",
  capture: "Inspecting the current tab…",
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
  trust_refresh: "Refreshing Trust status…",
  withdraw: "Withdrawing the contribution…",
};

let currentCapture: SanitizedJobCapture | undefined;
let currentDelivery: DeliveryReadiness | undefined;
let appealContributionId: string | undefined;
let busy = false;
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
    ...fieldList.querySelectorAll<HTMLButtonElement>("button"),
    ...contributionList.querySelectorAll<HTMLButtonElement>("button"),
  ];
}

function updateControlState(): void {
  for (const button of controls()) button.disabled = busy;
  if (busy) return;

  inspectButton.disabled = false;
  contributeButton.disabled = !currentCapture || currentDelivery?.contribution.ready !== true;
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
    ? "Ready to add the selected public fields."
    : readinessCopy[currentDelivery.contribution.reason];
}

function renderSessionStatus(status: AuthStatus): void {
  authStatus.textContent = status.configured
    ? status.authenticated
      ? "Signed in"
      : "Signed out"
    : "Identity configuration required";
  loginButton.hidden = status.authenticated || !status.configured;
  refreshButton.hidden = !status.authenticated || !status.refreshAvailable;
  logoutButton.hidden = !status.authenticated;

  if (!status.configured) {
    detail.textContent = "Inspection is ready. Add public Auth0 settings to enable shared jobs.";
  } else if (!status.authenticated) {
    detail.textContent = "Inspection is ready. Sign in before adding a shared job.";
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

  if (response.queue) {
    const failure = response.queue.lastError
      ? {
          contribution_capability_policy_unavailable: "Policy service unavailable",
          http_429: "Rate limited",
          http_5xx: "Server unavailable",
          internal_error: "Internal server error",
          invalid_response: "Invalid server response",
          job_contribution_unavailable: "Contribution service unavailable",
          network_error: "Network unavailable",
          request_rejected: "Request rejected",
          retry_exhausted: "Retries exhausted",
          retryable: "Delivery unavailable",
          ugc_contribution_consent_unavailable: "Consent service unavailable",
        }[response.queue.lastError]
      : undefined;
    queueStatus.textContent = `${response.queue.pending} pending · ${response.queue.stopped} stopped${failure ? ` · ${failure}` : ""}`;
    retryButton.hidden = response.queue.pending === 0;
    retryStoppedButton.hidden = response.queue.stopped === 0;
    clearStoppedButton.hidden = response.queue.stopped === 0;
    clearQueueButton.hidden = response.queue.pending + response.queue.stopped === 0;
    if (response.queue.stopped > 0) queuePanel.open = true;
  }
  if (response.receipts) renderReceipts(response.receipts);
  if (response.ownerAction) {
    ownerActionStatus.textContent = {
      ok: "Contribution information updated.",
      not_found: "No owner-visible record is available yet. Refresh again after processing.",
      unavailable: "The service is unavailable. Your saved receipt was kept; try again later.",
      version_conflict: "The record changed. Refresh Trust status before trying again.",
      rejected: "The request was not accepted. Refresh status before trying again.",
    }[response.ownerAction];
    contributionsPanel.open = true;
    ownerActionStatus.focus();
  }
  if (response.error) detail.textContent = response.error;
  if (currentCapture) updateSelectionSummary();
  else updateControlState();
}

function renderReceipts(receipts: ContributionReceipt[]): void {
  contributionList.replaceChildren();
  contributionsStatus.textContent =
    receipts.length === 0 ? "No contributions" : `${receipts.length} saved`;
  if (!receipts.length) {
    const empty = document.createElement("p");
    empty.textContent = "No acknowledged contributions for this account.";
    contributionList.append(empty);
    return;
  }
  for (const receipt of receipts) {
    const article = document.createElement("article");
    article.className = "contribution-receipt";
    const heading = document.createElement("h3");
    heading.textContent = `Contribution ${receipt.contributionId.slice(0, 8)}`;
    const state = document.createElement("p");
    state.textContent = `Processing: ${receipt.state.replaceAll("_", " ")}`;
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
          appealContributionId = receipt.contributionId;
          appealEvidence.value = "";
          appealDialog.showModal();
          appealEvidence.focus();
          return;
        }
        if (
          action === "withdraw" &&
          !window.confirm("Withdraw this contribution from Trust eligibility?")
        )
          return;
        void invoke({
          action,
          contributionId: receipt.contributionId,
          ...(action === "withdraw" ? { confirmed: true } : {}),
        });
      });
      actions.append(button);
    };
    add("Refresh processing", "contribution_refresh");
    add("Refresh Trust", "trust_refresh");
    if (receipt.trust) {
      add("Withdraw", "withdraw");
      add("Appeal", "appeal");
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
    kind: "required" | "system";
    translateNo?: boolean;
  },
): void {
  const row = document.createElement("div");
  const valueId = `capture-field-${fieldSequence++}`;
  const missing = options.field !== undefined && !value;
  row.className = "field-row";
  row.dataset.fieldKind = missing ? "unavailable" : options.field ? "optional" : options.kind;

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
      ? "Not available"
      : "Optional"
    : "Always included";
  labelLine.append(heading, requirement);
  const body = document.createElement("span");
  body.className = `field-value${missing ? " not-detected" : ""}`;
  body.id = valueId;
  body.textContent = value ?? "Not detected on this page";
  if (options.translateNo) body.translate = false;
  content.append(labelLine, body);

  if (options.field) {
    const selection = document.createElement("label");
    selection.className = "field-selection";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !missing;
    checkbox.disabled = missing;
    checkbox.dataset.field = options.field;
    checkbox.addEventListener("change", updateSelectionSummary);
    selection.append(checkbox, content);
    row.append(selection);
  } else {
    row.append(content);
  }

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
  return [...fieldList.querySelectorAll<HTMLInputElement>("input[data-field]:checked")].map(
    (input) => input.dataset.field as CaptureField,
  );
}

function displayWorkMode(value: SanitizedJobCapture["workMode"]): string | undefined {
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "on_site") return "On-site";
  if (value === "unknown") return "Unknown";
  return undefined;
}

function updateSelectionSummary(): void {
  if (!currentCapture) {
    selectionSummary.textContent = "";
    return;
  }
  const detectedOptional = CAPTURE_FIELDS.filter(
    (field) => field !== "title" && Boolean(currentCapture?.[field]),
  ).length;
  const selectedOptional = selectedFields().length;
  const missing = CAPTURE_FIELDS.length - detectedOptional - 1;
  const nextAction = currentDelivery?.contribution.ready
    ? "Next action: Add job to shared database"
    : "Delivery unavailable: review readiness below";
  selectionSummary.textContent = `5 required fields always included · ${selectedOptional} of ${detectedOptional} detected optional fields selected · ${nextAction}${
    missing > 0 ? ` · ${missing} not detected` : ""
  }`;

  const sourceSummary = fieldList.querySelector<HTMLElement>("#source-summary");
  if (sourceSummary) {
    const externalJobId = fieldList.querySelector<HTMLInputElement>(
      'input[data-field="externalJobId"]',
    );
    sourceSummary.textContent = !currentCapture.externalJobId
      ? "4 always included · External job ID not detected"
      : `4 always included · External job ID ${externalJobId?.checked ? "selected" : "not selected"}`;
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
  appendField(jobGroup, "Work type", displayWorkMode(capture.workMode), {
    field: "workMode",
    kind: "system",
  });
  appendField(jobGroup, "Description", capture.description, {
    expandable: "description",
    field: "description",
    kind: "system",
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
    return "The selected public fields were added to the shared job review queue.";
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
  currentCapture = undefined;
  currentDelivery = undefined;
  preview.hidden = true;
  void invoke({ action: "logout" });
});
inspectButton.addEventListener("click", () => void invoke({ action: "capture" }));
retryButton.addEventListener("click", () => void invoke({ action: "retry" }));
retryStoppedButton.addEventListener("click", () => {
  if (
    window.confirm(
      "Retry stopped deliveries now? The original selected fields and idempotency keys will be reused.",
    )
  ) {
    void invoke({ action: "retry_stopped" });
  }
});
clearStoppedButton.addEventListener("click", () => void invoke({ action: "clear_stopped" }));
clearQueueButton.addEventListener("click", () => {
  if (window.confirm("Remove every pending and stopped item from this device?")) {
    void invoke({ action: "clear_queue" });
  }
});
contributeButton.addEventListener("click", () => {
  if (currentCapture && currentDelivery?.contribution.ready) {
    void invoke({ action: "enqueue", approvedFields: selectedFields(), intent: "contribute" });
  }
});
cancelAppeal.addEventListener("click", () => appealDialog.close());
appealDialog.addEventListener("close", () => {
  appealEvidence.value = "";
  appealContributionId = undefined;
});
appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const evidenceText = appealEvidence.value;
  const contributionId = appealContributionId;
  if (
    !contributionId ||
    !evidenceText.trim() ||
    !window.confirm("Submit this appeal evidence digest now?")
  )
    return;
  const evidenceDigestSha256 = await appealEvidenceDigest(evidenceText);
  appealDialog.close();
  void invoke({ action: "appeal", confirmed: true, contributionId, evidenceDigestSha256 });
});

renderDeliveryReadiness();
void invoke({ action: "status" });
