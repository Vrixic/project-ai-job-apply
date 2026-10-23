/**
 * Browser side of Web Push (ADR-056). The service worker shows fixed wording and opens the inbox;
 * the platform never sends content, so there are no payload keys to manage here.
 */

const WORKER_PATH = "/push-sw.js";
const STORED_ID_KEY = "notification-push-subscription-id";

export type PushOutcome = "subscribed" | "denied" | "unsupported" | "failed";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export function readStoredSubscriptionId(): string | undefined {
  try {
    return window.localStorage.getItem(STORED_ID_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function storeSubscriptionId(id: string | undefined): void {
  try {
    if (id) window.localStorage.setItem(STORED_ID_KEY, id);
    else window.localStorage.removeItem(STORED_ID_KEY);
  } catch {
    // A blocked store only means this browser forgets which subscription is its own.
  }
}

/** Asks permission and subscribes this browser. Returns the endpoint to register with the platform. */
export async function subscribeThisBrowser(
  publicKey: string,
): Promise<
  | { outcome: "subscribed"; endpoint: string }
  | { outcome: "denied" }
  | { outcome: "unsupported" }
  | { outcome: "failed" }
> {
  if (!pushSupported()) return { outcome: "unsupported" };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { outcome: "denied" };
    const registration = await navigator.serviceWorker.register(WORKER_PATH);
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      }));
    return { outcome: "subscribed", endpoint: subscription.endpoint };
  } catch {
    return { outcome: "failed" };
  }
}

/** Stops this browser's push subscription. Safe when there is none. */
export async function unsubscribeThisBrowser(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration(WORKER_PATH);
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // The platform side is removed regardless; a stale browser subscription is harmless.
  }
}

export function browserNotificationsBlocked(): boolean {
  return pushSupported() && Notification.permission === "denied";
}
