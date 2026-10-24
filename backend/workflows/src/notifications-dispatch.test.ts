import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createNotificationsDispatchHandler,
  createRuntimeNotificationsDispatcher,
  isNotificationsDispatchEvent,
  readNotificationsVapidSecret,
} from "./notifications-dispatch.js";

const ruleArn =
  "arn:aws:events:us-east-2:123456789012:rule/ai-job-apply-development-notifications-dispatch";

function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return {
    version: "0",
    id: "019c2b89-79b2-7000-8000-000000000009",
    source: "aws.events",
    "detail-type": "Scheduled Event",
    account: "123456789012",
    region: "us-east-2",
    time: "2026-10-23T00:00:00Z",
    resources: [ruleArn],
    detail: {},
    ...overrides,
  };
}

const summary = { sent: 2, skipped: 3, failed: 0, retried: 1, deferred: 0 };

describe("isNotificationsDispatchEvent", () => {
  it("accepts only the exact scheduled event of the configured rule", () => {
    expect(isNotificationsDispatchEvent(scheduledEvent(), ruleArn)).toBe(true);
    for (const event of [
      scheduledEvent({ source: "aws.lambda" }),
      scheduledEvent({ "detail-type": "Other" }),
      scheduledEvent({ account: "999999999999" }),
      scheduledEvent({ region: "us-east-1" }),
      scheduledEvent({ resources: [`${ruleArn}-other`] }),
      scheduledEvent({ resources: [ruleArn, ruleArn] }),
      scheduledEvent({ resources: ruleArn }),
      scheduledEvent({ detail: { owner: "x" } }),
      scheduledEvent({ detail: [] }),
      scheduledEvent({ detail: null }),
      null,
      "text",
      [],
    ])
      expect(isNotificationsDispatchEvent(event, ruleArn)).toBe(false);
    expect(isNotificationsDispatchEvent(scheduledEvent(), "not-an-arn")).toBe(false);
  });
});

describe("createNotificationsDispatchHandler", () => {
  it("expires due items, dispatches and reports counts only", async () => {
    const run = vi.fn(async () => summary);
    const expireDue = vi.fn(async () => 4);
    const handler = createNotificationsDispatchHandler({
      dispatcher: { run },
      expireDue,
      expectedRuleArn: ruleArn,
    });
    await expect(handler(scheduledEvent())).resolves.toEqual({
      schemaVersion: 1,
      expired: 4,
      ...summary,
    });
    expect(expireDue).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });

  it("refuses a foreign event before any work", async () => {
    const run = vi.fn(async () => summary);
    const expireDue = vi.fn(async () => 0);
    const handler = createNotificationsDispatchHandler({
      dispatcher: { run },
      expireDue,
      expectedRuleArn: ruleArn,
    });
    await expect(handler(scheduledEvent({ source: "aws.lambda" }))).rejects.toThrow(
      "NotificationsDispatchEventRejected",
    );
    expect(run).not.toHaveBeenCalled();
    expect(expireDue).not.toHaveBeenCalled();
  });

  it("still delivers when expiry fails, then raises the expiry failure", async () => {
    const run = vi.fn(async () => summary);
    const handler = createNotificationsDispatchHandler({
      dispatcher: { run },
      expireDue: async () => {
        throw new Error("ExpiryFailed");
      },
      expectedRuleArn: ruleArn,
    });
    await expect(handler(scheduledEvent())).rejects.toThrow("ExpiryFailed");
    expect(run).toHaveBeenCalledOnce();
  });

  it("expires items even when delivery fails, then raises the delivery failure", async () => {
    const expireDue = vi.fn(async () => 1);
    const handler = createNotificationsDispatchHandler({
      dispatcher: {
        run: async () => {
          throw new Error("DeliveryFailed");
        },
      },
      expireDue,
      expectedRuleArn: ruleArn,
    });
    await expect(handler(scheduledEvent())).rejects.toThrow("DeliveryFailed");
    expect(expireDue).toHaveBeenCalledOnce();
  });

  it("rejects an invalid rule at construction", () => {
    expect(() =>
      createNotificationsDispatchHandler({
        dispatcher: { run: async () => summary },
        expireDue: async () => 0,
        expectedRuleArn: "bad",
      }),
    ).toThrow("NotificationsDispatchConfigurationInvalid");
  });
});

describe("readNotificationsVapidSecret", () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]).toString("base64url");
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const secret = { publicKey, privateKeyPem, subject: "mailto:ops@example.com" };
  const respond = (body: unknown, init: ResponseInit = { status: 200 }) =>
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init));
  const envelope = (value: unknown) => ({ SecretString: JSON.stringify(value) });

  it("reads the exact secret through the local extension with the session token", async () => {
    const fetchImplementation = respond(envelope(secret));
    await expect(
      readNotificationsVapidSecret("secret-id", {
        sessionToken: "token",
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    ).resolves.toEqual(secret);
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:2773/secretsmanager/get?secretId=secret-id");
    expect(init.headers).toEqual({ "X-Aws-Parameters-Secrets-Token": "token" });
  });

  it("refuses missing context, an unavailable extension and malformed secrets", async () => {
    await expect(readNotificationsVapidSecret(undefined, { sessionToken: "t" })).rejects.toThrow(
      "NotificationsVapidSecretContextUnavailable",
    );
    await expect(readNotificationsVapidSecret("id")).rejects.toThrow(
      "NotificationsVapidSecretContextUnavailable",
    );
    const bad = async (response: ReturnType<typeof respond>) =>
      readNotificationsVapidSecret("id", {
        sessionToken: "t",
        fetchImplementation: response as unknown as typeof fetch,
      });
    await expect(bad(respond({}, { status: 500 }))).rejects.toThrow(
      "NotificationsVapidSecretUnavailable",
    );
    await expect(bad(respond("not json"))).rejects.toThrow("NotificationsVapidSecretInvalid");
    await expect(bad(respond({ SecretString: 5 }))).rejects.toThrow(
      "NotificationsVapidSecretInvalid",
    );
    await expect(bad(respond(envelope({ ...secret, extra: 1 })))).rejects.toThrow(
      "NotificationsVapidSecretInvalid",
    );
    await expect(bad(respond(envelope({ ...secret, subject: 5 })))).rejects.toThrow(
      "NotificationsVapidSecretInvalid",
    );
    await expect(bad(respond(envelope([secret])))).rejects.toThrow(
      "NotificationsVapidSecretInvalid",
    );
    await expect(
      bad(vi.fn(async () => new Response("{}", { headers: { "content-length": "99999" } }))),
    ).rejects.toThrow("NotificationsVapidSecretInvalid");
  });

  it("builds a runtime dispatcher from validated configuration only", async () => {
    const database = { client: {} } as never;
    const base = { NOTIFICATIONS_WEB_BASE_URL: "https://app.example.test" };
    await expect(createRuntimeNotificationsDispatcher(base, database)).resolves.toMatchObject({
      dispatcher: expect.any(Object),
      expireDue: expect.any(Function),
    });
    await expect(
      createRuntimeNotificationsDispatcher(
        {
          ...base,
          NOTIFICATIONS_EMAIL_FROM: "App <no-reply@example.test>",
          NOTIFICATIONS_VAPID_SECRET_ID: "vapid",
          AWS_SESSION_TOKEN: "t",
        },
        database,
        { fetchImplementation: respond(envelope(secret)) as unknown as typeof fetch },
      ),
    ).resolves.toBeDefined();
    for (const bad of [
      {},
      { NOTIFICATIONS_WEB_BASE_URL: "http://app.example.test" },
      { NOTIFICATIONS_WEB_BASE_URL: "https://app.example.test/path?x=1" },
      { ...base, NOTIFICATIONS_EMAIL_FROM: "not an address" },
    ])
      await expect(createRuntimeNotificationsDispatcher(bad, database)).rejects.toThrow(
        "NotificationsDispatchConfigurationInvalid",
      );
    await expect(
      createRuntimeNotificationsDispatcher(
        { ...base, NOTIFICATIONS_VAPID_SECRET_ID: "v" },
        database,
      ),
    ).rejects.toThrow("NotificationsVapidSecretContextUnavailable");
  });
});
