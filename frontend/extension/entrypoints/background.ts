import { authenticationStatus, login, logout, refresh } from "../lib/protocol";

type AuthMessage = { action: "login" | "logout" | "refresh" | "status" };

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cancel") || message.includes("access_denied")) {
    return "Authentication action cancelled.";
  }
  if (message === "configuration_required") {
    return "Public Auth0 configuration is required.";
  }
  if (message === "reauthentication_required") {
    return "Log in again to create a renewable session.";
  }
  return "Authentication action did not complete.";
}

void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onMessage.addListener(
  (message: AuthMessage, _sender, sendResponse: (response: unknown) => void) => {
    void (async () => {
      try {
        if (message.action === "login") {
          await login();
        } else if (message.action === "logout") {
          await logout();
        } else if (message.action === "refresh") {
          await refresh();
        }
        sendResponse({ ok: true, status: await authenticationStatus() });
      } catch (error) {
        sendResponse({
          error: safeMessage(error),
          ok: false,
          status: await authenticationStatus(),
        });
      }
    })();
    return true;
  },
);
