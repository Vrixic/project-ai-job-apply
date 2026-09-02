import { CAPTURE_FIELDS, type CaptureField, type SanitizedJobCapture } from "../lib/job-capture";

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
  status?: AuthStatus;
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

let currentCapture: SanitizedJobCapture | undefined;

function controls(): HTMLButtonElement[] {
  return [
    loginButton,
    refreshButton,
    logoutButton,
    inspectButton,
    saveButton,
    contributeButton,
    retryButton,
    clearStoppedButton,
    clearQueueButton,
  ];
}

function setBusy(busy: boolean): void {
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
  if (response.error) detail.textContent = response.error;
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
clearQueueButton.addEventListener("click", () => void invoke({ action: "clear_queue" }));
saveButton.addEventListener("click", () => {
  if (currentCapture) {
    void invoke({ action: "enqueue", approvedFields: CAPTURE_FIELDS, intent: "private_save" });
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

void invoke({ action: "status" });
