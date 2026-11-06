/**
 * The extension lives in the browser's side panel: docked to the right, top to bottom, and open
 * while the candidate moves between tabs. The toolbar icon opens it for the window it was clicked
 * in. Clicking the icon is also what gives the extension access to the page in front of the
 * candidate (activeTab), so an open panel is told when that happens and looks at the page again.
 */
export const PANEL_ACCESS_GRANTED = "panel_access_granted";

interface SidePanelApi {
  action?: { onClicked?: { addListener(listener: (tab: chrome.tabs.Tab) => void): void } };
  runtime: { sendMessage(message: unknown): Promise<unknown> | undefined };
  sidePanel?: { open(options: { windowId: number }): Promise<void> | undefined };
}

export function registerSidePanel(api: SidePanelApi = chrome): void {
  api.action?.onClicked?.addListener((tab) => {
    // The browser only opens a panel in the turn of the click itself: nothing is awaited first.
    if (typeof tab.windowId === "number" && tab.windowId >= 0) {
      try {
        void Promise.resolve(api.sidePanel?.open({ windowId: tab.windowId })).catch(
          () => undefined,
        );
      } catch {
        // The panel is unavailable in this browser: the icon does nothing rather than throwing.
      }
    }
    // Nobody is listening when the panel is not open yet; it looks at the page when it loads.
    try {
      void Promise.resolve(api.runtime.sendMessage({ panel: PANEL_ACCESS_GRANTED })).catch(
        () => undefined,
      );
    } catch {
      // Same: there is no panel to tell.
    }
  });
}

/** True for the background's own notice that the candidate just opened the extension on a page. */
export function isPanelAccessGranted(
  message: unknown,
  sender: { id?: string; tab?: unknown },
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.tab === undefined &&
    typeof message === "object" &&
    message !== null &&
    (message as { panel?: unknown }).panel === PANEL_ACCESS_GRANTED
  );
}
