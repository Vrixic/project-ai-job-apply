// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStoredSubscriptionId,
  storeSubscriptionId,
  subscribeThisBrowser,
  unsubscribeThisBrowser,
  urlBase64ToBytes,
} from "./browser-push";

describe("browser push helpers", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("decodes a base64url application server key", () => {
    // 0xfb 0xff 0xbe is "-_--" in base64url and "+/++" in base64.
    expect(Array.from(urlBase64ToBytes("-_--"))).toEqual([0xfb, 0xff, 0xbe]);
    expect(Array.from(urlBase64ToBytes("AQI"))).toEqual([1, 2]);
  });

  it("remembers which subscription belongs to this browser", () => {
    expect(readStoredSubscriptionId()).toBeUndefined();
    storeSubscriptionId("sub-1");
    expect(readStoredSubscriptionId()).toBe("sub-1");
    storeSubscriptionId(undefined);
    expect(readStoredSubscriptionId()).toBeUndefined();
  });

  it("reports unsupported browsers without asking for permission", async () => {
    await expect(subscribeThisBrowser("AQI")).resolves.toEqual({ outcome: "unsupported" });
  });

  function stubBrowser(permission: NotificationPermission) {
    const subscribe = vi.fn(async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new" }));
    const unsubscribe = vi.fn(async () => true);
    const pushManager = {
      getSubscription: vi.fn(async () => null as unknown),
      subscribe,
    };
    const registration = { pushManager };
    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => permission), permission });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn(async () => registration),
        ready: Promise.resolve(registration),
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription: async () => ({ unsubscribe }) },
        })),
      },
    });
    return { subscribe, unsubscribe, pushManager };
  }

  it("subscribes after permission is granted and returns the endpoint", async () => {
    const { subscribe } = stubBrowser("granted");
    await expect(subscribeThisBrowser("AQI")).resolves.toEqual({
      outcome: "subscribed",
      endpoint: "https://fcm.googleapis.com/fcm/send/new",
    });
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
  });

  it("does not subscribe when permission is refused", async () => {
    const { subscribe } = stubBrowser("denied");
    await expect(subscribeThisBrowser("AQI")).resolves.toEqual({ outcome: "denied" });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("stops the browser subscription on request", async () => {
    const { unsubscribe } = stubBrowser("granted");
    await unsubscribeThisBrowser();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
