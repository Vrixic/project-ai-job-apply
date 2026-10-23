import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => void;

/** Runs the real worker script against a minimal fake of the service worker global scope. */
function loadWorker(
  windows: { url: string; focus: () => Promise<void>; navigate?: (url: string) => Promise<void> }[],
) {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const scope = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(),
    registration: { showNotification },
    location: { origin: "https://app.example.test" },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow,
    },
  };
  const source = readFileSync(
    fileURLToPath(new URL("../public/push-sw.js", import.meta.url)),
    "utf8",
  );
  new Function("self", source)(scope);
  return { handlers, showNotification, openWindow };
}

async function dispatch(handler: Handler | undefined, extra: Record<string, unknown> = {}) {
  const waits: Promise<unknown>[] = [];
  handler?.({ waitUntil: (promise: Promise<unknown>) => waits.push(promise), ...extra });
  await Promise.all(waits);
}

describe("push service worker", () => {
  it("shows fixed wording and ignores any push content", async () => {
    const { handlers, showNotification } = loadWorker([]);
    await dispatch(handlers.get("push"), { data: { text: () => "secret application detail" } });
    expect(showNotification).toHaveBeenCalledOnce();
    const [title, options] = showNotification.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(title).toBe("You have a new update");
    expect(options.body).toBe("Open your inbox to see it.");
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain("secret");
  });

  it("opens the inbox in an existing window of this site", async () => {
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const other = vi.fn(async () => undefined);
    const { handlers, openWindow } = loadWorker([
      { url: "https://elsewhere.example/page", focus: other },
      { url: "https://app.example.test/jobs", focus, navigate },
    ]);
    const close = vi.fn();
    await dispatch(handlers.get("notificationclick"), { notification: { close } });
    expect(close).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/inbox");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window on the inbox when none is open", async () => {
    const { handlers, openWindow } = loadWorker([]);
    await dispatch(handlers.get("notificationclick"), { notification: { close: vi.fn() } });
    expect(openWindow).toHaveBeenCalledWith("/inbox");
  });
});
