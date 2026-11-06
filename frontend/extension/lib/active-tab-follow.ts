import { isPanelAccessGranted } from "./side-panel";

interface Listenable<Args extends unknown[]> {
  addListener(listener: (...args: Args) => void): void;
  removeListener?(listener: (...args: Args) => void): void;
}

interface FollowApi {
  runtime: {
    id: string;
    onMessage?: Listenable<[unknown, { id?: string; tab?: unknown }]>;
  };
  tabs?: {
    onActivated?: Listenable<[unknown]>;
    onUpdated?: Listenable<[number, { status?: string; url?: string }, { active?: boolean }]>;
  };
  windows?: { onFocusChanged?: Listenable<[number]> };
}

/**
 * A side panel stays open while the candidate switches tabs and pages load, so it has to notice
 * which page is in front of them now. `onChange` runs once the browser settles after any of: another
 * tab becoming active, the active tab finishing a load or changing address, another window taking
 * focus, or the extension being opened on the page (which grants access to it). Returns a stop.
 */
export function followActiveTab(
  onChange: () => void,
  api: FollowApi = chrome as unknown as FollowApi,
  settleMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, settleMs);
  };
  const updated = (
    _tabId: number,
    change: { status?: string; url?: string },
    tab: { active?: boolean },
  ) => {
    if (tab.active === true && (change.status === "complete" || change.url !== undefined))
      changed();
  };
  const message = (value: unknown, sender: { id?: string; tab?: unknown }) => {
    if (isPanelAccessGranted(value, sender, api.runtime.id)) changed();
  };
  api.tabs?.onActivated?.addListener(changed);
  api.tabs?.onUpdated?.addListener(updated);
  api.windows?.onFocusChanged?.addListener(changed);
  api.runtime.onMessage?.addListener(message);
  return () => {
    clearTimeout(timer);
    api.tabs?.onActivated?.removeListener?.(changed);
    api.tabs?.onUpdated?.removeListener?.(updated);
    api.windows?.onFocusChanged?.removeListener?.(changed);
    api.runtime.onMessage?.removeListener?.(message);
  };
}
