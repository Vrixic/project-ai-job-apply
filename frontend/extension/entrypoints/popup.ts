import { CAPTURE_FIELDS, type CaptureField, type SanitizedJobCapture } from "../lib/job-capture";
import { appealEvidenceDigest } from "../lib/contribution-owner-api";

interface AuthStatus {
  apiConfigured: boolean;
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
}

interface QueueStatus {
  pending: number;
  stopped: number;
}

interface ExtensionResponse {
  capture?: SanitizedJobCapture;
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
const fieldList = node<HTMLElement>("#field-list");
const consent = node<HTMLInputElement>("#contribution-consent");
const loginButton = node<HTMLButtonElement>("#login");
const refreshButton = node<HTMLButtonElement>("#refresh");
const logoutButton = node<HTMLButtonElement>("#logout");
const inspectButton = node<HTMLButtonElement>("#inspect");
const saveButton = node<HTMLButtonElement>("#save-private");
const contributeButton = node<HTMLButtonElement>("#contribute");
const retryButton = node<HTMLButtonElement>("#retry");
const clearStoppedButton = node<HTMLButtonElement>("#clear-stopped");
const clearQueueButton = node<HTMLButtonElement>("#clear-queue");
const main = node<HTMLElement>("main");
const contributionList = node<HTMLElement>("#contribution-list");
const ownerActionStatus = node<HTMLElement>("#owner-action-status");
const appealDialog = node<HTMLDialogElement>("#appeal-dialog");
const appealForm = node<HTMLFormElement>("#appeal-form");
const appealEvidence = node<HTMLTextAreaElement>("#appeal-evidence");
const cancelAppeal = node<HTMLButtonElement>("#cancel-appeal");

let currentCapture: SanitizedJobCapture | undefined;
let appealContributionId: string | undefined;

function controls(): HTMLButtonElement[] {
  return [...[
    loginButton,
    refreshButton,
    logoutButton,
    inspectButton,
    saveButton,
    contributeButton,
    retryButton,
    clearStoppedButton,
    clearQueueButton,
  ], ...contributionList.querySelectorAll<HTMLButtonElement>("button")];
}

function setBusy(busy: boolean): void {
  main.setAttribute("aria-busy", String(busy));
  for (const button of controls()) button.disabled = busy;
  if (!busy) contributeButton.disabled = !currentCapture || !consent.checked;
}

function renderStatus(response: ExtensionResponse): void {
  if (response.status) {
    authStatus.textContent = response.status.configured
      ? response.status.authenticated
        ? "Signed in"
        : "Signed out"
      : "Identity configuration required";
    loginButton.hidden = response.status.authenticated || !response.status.configured;
    refreshButton.hidden = !response.status.authenticated || !response.status.refreshAvailable;
    logoutButton.hidden = !response.status.authenticated;
    inspectButton.disabled = !response.status.authenticated || !response.status.apiConfigured;
    if (!response.status.apiConfigured) {
      detail.textContent = "The API origin is not configured; capture and delivery remain off.";
    }
  }
  if (response.queue) {
    queueStatus.textContent = `${response.queue.pending} pending · ${response.queue.stopped} stopped`;
    retryButton.hidden = response.queue.pending === 0;
    clearStoppedButton.hidden = response.queue.stopped === 0;
    clearQueueButton.hidden = response.queue.pending + response.queue.stopped === 0;
  }
  if (response.receipts) renderReceipts(response.receipts);
  if (response.ownerAction) {
    ownerActionStatus.textContent = ({ ok: "Contribution information updated.", not_found: "No owner-visible record is available yet.", unavailable: "The service is unavailable. Your saved receipt was kept.", version_conflict: "The record changed. Refresh Trust status before trying again.", rejected: "The request was not accepted." })[response.ownerAction];
    ownerActionStatus.focus();
  }
  if (response.error) detail.textContent = response.error;
}

function renderReceipts(receipts: ContributionReceipt[]): void {
  contributionList.replaceChildren();
  if (!receipts.length) {
    const empty = document.createElement("p");
    empty.textContent = "No acknowledged contributions for this account.";
    contributionList.append(empty);
    return;
  }
  for (const receipt of receipts) {
    const article = document.createElement("article"); article.className = "contribution-receipt";
    const heading = document.createElement("h3"); heading.textContent = `Contribution ${receipt.contributionId.slice(0, 8)}`;
    const state = document.createElement("p"); state.textContent = `Processing: ${receipt.state.replaceAll("_", " ")}`;
    const trust = document.createElement("p"); trust.textContent = receipt.trust ? `Trust: ${receipt.trust.state.replaceAll("_", " ")}${receipt.trust.appealed ? " · appealed" : ""}` : "Trust: refresh to check";
    const actions = document.createElement("div"); actions.className = "actions compact";
    const add = (label: string, action: string) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "quiet"; button.textContent = label;
      button.addEventListener("click", () => {
        if (action === "appeal") { appealContributionId = receipt.contributionId; appealEvidence.value = ""; appealDialog.showModal(); appealEvidence.focus(); return; }
        if (action === "withdraw" && !window.confirm("Withdraw this contribution from Trust eligibility?")) return;
        void invoke({ action, contributionId: receipt.contributionId, ...(action === "withdraw" ? { confirmed: true } : {}) });
      });
      actions.append(button);
    };
    add("Refresh processing", "contribution_refresh"); add("Refresh Trust", "trust_refresh");
    if (receipt.trust) { add("Withdraw", "withdraw"); add("Appeal", "appeal"); }
    article.append(heading, state, trust, actions); contributionList.append(article);
  }
}

function appendField(label: string, value: string, removable?: CaptureField): void {
  const row = document.createElement("label");
  row.className = "field-row";
  if (removable) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.field = removable;
    row.append(checkbox);
  } else {
    const required = document.createElement("span");
    required.className = "required-field";
    required.textContent = "Required";
    row.append(required);
  }
  const content = document.createElement("span");
  const heading = document.createElement("strong");
  heading.textContent = label;
  const body = document.createElement("span");
  body.className = "field-value";
  body.textContent = value;
  content.append(heading, body);
  row.append(content);
  fieldList.append(row);
}

function renderCapture(capture: SanitizedJobCapture): void {
  currentCapture = capture;
  fieldList.replaceChildren();
  appendField("Provider", capture.provider);
  appendField("Page variant", capture.pageVariant);
  appendField("Submitting client", `Browser extension ${chrome.runtime.getManifest().version}`);
  appendField("Public URL", capture.sourceUrl);
  appendField("Title", capture.title);
  for (const field of CAPTURE_FIELDS) {
    if (field === "title") continue;
    const value = capture[field];
    if (value) appendField(field, value, field);
  }
  consent.checked = false;
  contributeButton.disabled = true;
  preview.hidden = false;
  detail.textContent =
    "Review the exact public fields below. Private save and contribution are separate.";
}

function selectedFields(): CaptureField[] {
  return [...fieldList.querySelectorAll<HTMLInputElement>("input[data-field]:checked")].map(
    (input) => input.dataset.field as CaptureField,
  );
}

async function invoke(message: Record<string, unknown>): Promise<ExtensionResponse> {
  setBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse;
    renderStatus(response);
    if (response.capture) renderCapture(response.capture);
    return response;
  } finally {
    setBusy(false);
  }
}

loginButton.addEventListener("click", () => void invoke({ action: "login" }));
refreshButton.addEventListener("click", () => void invoke({ action: "refresh" }));
logoutButton.addEventListener("click", () => {
  currentCapture = undefined;
  preview.hidden = true;
  void invoke({ action: "logout" });
});
inspectButton.addEventListener("click", () => void invoke({ action: "capture" }));
retryButton.addEventListener("click", () => void invoke({ action: "retry" }));
clearStoppedButton.addEventListener("click", () => void invoke({ action: "clear_stopped" }));
clearQueueButton.addEventListener("click", () => {
  if (window.confirm("Remove every pending and stopped item from this device?")) {
    void invoke({ action: "clear_queue" });
  }
});
saveButton.addEventListener("click", () => {
  if (currentCapture) {
    void invoke({ action: "enqueue", approvedFields: selectedFields(), intent: "private_save" });
  }
});
contributeButton.addEventListener("click", () => {
  if (currentCapture && consent.checked) {
    void invoke({ action: "enqueue", approvedFields: selectedFields(), intent: "contribute" });
  }
});
consent.addEventListener("change", () => {
  contributeButton.disabled = !currentCapture || !consent.checked;
});
cancelAppeal.addEventListener("click", () => {
  appealEvidence.value = "";
  appealContributionId = undefined;
  appealDialog.close();
});
appealForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const evidenceText = appealEvidence.value;
  const contributionId = appealContributionId;
  if (!contributionId || !evidenceText.trim() || !window.confirm("Submit this appeal evidence digest now?")) return;
  const evidenceDigestSha256 = await appealEvidenceDigest(evidenceText);
  appealEvidence.value = "";
  appealContributionId = undefined;
  appealDialog.close();
  void invoke({ action: "appeal", confirmed: true, contributionId, evidenceDigestSha256 });
});

void invoke({ action: "status" });
