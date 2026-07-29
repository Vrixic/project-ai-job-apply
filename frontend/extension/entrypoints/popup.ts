interface AuthStatus {
  authenticated: boolean;
  configured: boolean;
  refreshAvailable: boolean;
}

interface AuthResponse {
  error?: string;
  ok: boolean;
  status: AuthStatus;
}

const statusNode = document.querySelector<HTMLElement>("#status");
const detailNode = document.querySelector<HTMLElement>("#detail");
const loginButton = document.querySelector<HTMLButtonElement>("#login");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh");
const logoutButton = document.querySelector<HTMLButtonElement>("#logout");

function render(response: AuthResponse) {
  if (!statusNode || !detailNode || !loginButton || !refreshButton || !logoutButton) {
    throw new Error("The extension popup is incomplete");
  }
  statusNode.textContent = response.status.configured
    ? response.status.authenticated
      ? "Signed in"
      : "Signed out"
    : "Configuration required";
  detailNode.textContent =
    response.error ??
    (response.status.refreshAvailable
      ? "A renewable session is held in extension session storage."
      : "No refresh credential is held.");
  loginButton.hidden = response.status.authenticated || !response.status.configured;
  refreshButton.hidden = !response.status.authenticated || !response.status.refreshAvailable;
  logoutButton.hidden = !response.status.authenticated;
}

async function invoke(action: "login" | "logout" | "refresh" | "status") {
  for (const button of [loginButton, refreshButton, logoutButton]) {
    if (button) {
      button.disabled = true;
    }
  }
  const response = (await chrome.runtime.sendMessage({ action })) as AuthResponse;
  render(response);
  for (const button of [loginButton, refreshButton, logoutButton]) {
    if (button) {
      button.disabled = false;
    }
  }
}

loginButton?.addEventListener("click", () => void invoke("login"));
refreshButton?.addEventListener("click", () => void invoke("refresh"));
logoutButton?.addEventListener("click", () => void invoke("logout"));
void invoke("status");
