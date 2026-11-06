/**
 * The extension lives in the browser's side panel: docked to the right, top to bottom, and open
 * while the candidate moves between tabs. The toolbar icon opens it for the window it was clicked
 * in, and so does pressing Apply on the ApplyDash website (see `OPEN_PANEL_REQUEST`). Clicking the
 * icon is also what gives the extension access to the page in front of the candidate (activeTab),
 * so an open panel is told when that happens, and when an application is armed, and looks again.
 */
export const PANEL_NOTICE = "panel_notice";

/**
 * Sent by the ApplyDash website in the turn of the candidate's Apply click, because the browser
 * opens a panel only in answer to a click. It carries nothing: no identifier, no page, no data.
 */
export const OPEN_PANEL_REQUEST = "application-open-panel.v1";
export const OPEN_PANEL_RECEIPT = "application-open-panel-receipt.v1";

interface SidePanelApi {
  action?: { onClicked?: { addListener(listener: (tab: chrome.tabs.Tab) => void): void } };
  runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
  sidePanel?: { open(options: { windowId: number }): Promise<void> | undefined };
}

/**
 * Opens the panel for a window. It must be called in the turn of the click that asked for it, so
 * nothing is awaited before it. Resolves false when the browser refuses or has no side panel.
 */
export function openSidePanel(windowId: number, api: SidePanelApi = chrome): Promise<boolean> {
  try {
    return Promise.resolve(api.sidePanel?.open({ windowId })).then(
      () => api.sidePanel !== undefined,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Tells an open panel to look at the page and the pending application again. */
export function notifyPanel(api: Pick<SidePanelApi, "runtime"> = chrome): void {
  // Nobody is listening when the panel is not open; it looks when it loads.
  try {
    void Promise.resolve(api.runtime.sendMessage({ panel: PANEL_NOTICE })).catch(() => undefined);
  } catch {
    // Same: there is no panel to tell.
  }
}

export function registerSidePanel(api: SidePanelApi = chrome): void {
  api.action?.onClicked?.addListener((tab) => {
    if (typeof tab.windowId === "number" && tab.windowId >= 0)
      void openSidePanel(tab.windowId, api);
    notifyPanel(api);
  });
}

/** True for the background's own notice that the panel should look at the page again. */
export function isPanelNotice(
  message: unknown,
  sender: { id?: string; tab?: unknown },
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.tab === undefined &&
    typeof message === "object" &&
    message !== null &&
    (message as { panel?: unknown }).panel === PANEL_NOTICE
  );
}

/** The website's request is exactly its schema and nothing else. */
export function isOpenPanelRequest(message: unknown): boolean {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 1 && (message as { schema?: unknown }).schema === OPEN_PANEL_REQUEST;
}
