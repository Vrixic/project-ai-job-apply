import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryProviderError,
  hashEndpoint,
  normalizeEmailAddress,
  notificationEmail,
  retryDelayMilliseconds,
  validatePushEndpoint,
} from "./delivery.js";
import { SesEmailProvider } from "./providers/ses-email.js";
import { WebPushProvider } from "./providers/web-push.js";
import { notificationKinds } from "./types.js";

describe("normalizeEmailAddress", () => {
  it.each([
    ["  Person@Example.COM ", "person@example.com"],
    ["first.last+tag@sub.example.co", "first.last+tag@sub.example.co"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeEmailAddress(input)).toBe(expected);
  });

  it.each([
    "",
    "plain",
    "a@b",
    "two@@example.com",
    "space in@example.com",
    "dot..dot@example.com",
    ".lead@example.com",
    "trail.@example.com",
    "a@-bad.example.com",
    "line\nbreak@example.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(250)}.com`,
    "a@example.com, b@example.com",
    "<a@example.com>",
  ])("rejects %j", (input) => {
    expect(normalizeEmailAddress(input)).toBeUndefined();
  });

  it("rejects non strings", () => {
    expect(normalizeEmailAddress(undefined)).toBeUndefined();
    expect(normalizeEmailAddress(42)).toBeUndefined();
  });
});

describe("validatePushEndpoint (allow-listed push services only)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QabcDEF",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => {
    expect(validatePushEndpoint(endpoint)).toBeTypeOf("string");
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.example/path",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://fcm.googleapis.com/",
    "https://fcm.googleapis.com/fcm/send/abc#frag",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/push",
    "not a url",
    `https://fcm.googleapis.com/${"a".repeat(2100)}`,
  ])("rejects %s", (endpoint) => {
    expect(validatePushEndpoint(endpoint)).toBeUndefined();
  });
});

describe("messages and backoff", () => {
  it("never puts application detail in a notification email", () => {
    for (const kind of notificationKinds) {
      const message = notificationEmail({
        to: "person@example.com",
        kind,
        webBaseUrl: "https://app.example.test/",
      });
      expect(message.subject.length).toBeGreaterThan(5);
      expect(message.text).toContain("https://app.example.test/inbox");
      expect(message.text).toContain("https://app.example.test/settings");
      expect(message.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });

  it("backs off 1 minute, 5 minutes, 30 minutes and 2 hours", () => {
    expect([1, 2, 3, 4].map(retryDelayMilliseconds)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000,
    ]);
    expect(retryDelayMilliseconds(5)).toBeUndefined();
  });

  it("hashes endpoints stably", () => {
    expect(hashEndpoint("https://fcm.googleapis.com/fcm/send/a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEndpoint("a")).toBe(hashEndpoint("a"));
    expect(hashEndpoint("a")).not.toBe(hashEndpoint("b"));
  });
});

describe("SesEmailProvider", () => {
  const message = { to: "person@example.com", subject: "Subject", text: "Body" };

  it("sends one plain text message from the configured identity", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-123" });
    const provider = new SesEmailProvider({
      fromAddress: "App <no-reply@example.com>",
      configurationSetName: "set-1",
      client: { send },
    });
    await expect(provider.send(message)).resolves.toEqual({ reference: "ses-123" });
    const input = send.mock.calls[0]?.[0].input;
    expect(input).toMatchObject({
      FromEmailAddress: "App <no-reply@example.com>",
      Destination: { ToAddresses: ["person@example.com"] },
      ConfigurationSetName: "set-1",
      Content: { Simple: { Subject: { Data: "Subject" }, Body: { Text: { Data: "Body" } } } },
    });
  });

  it("treats a rejected message as permanent and anything else as retryable", async () => {
    const rejected = Object.assign(new Error("no"), { name: "MessageRejected" });
    const throttled = Object.assign(new Error("slow"), { name: "TooManyRequestsException" });
    const permanent = new SesEmailProvider({
      fromAddress: "no-reply@example.com",
      client: { send: vi.fn().mockRejectedValue(rejected) },
    });
    const transient = new SesEmailProvider({
      fromAddress: "no-reply@example.com",
      client: { send: vi.fn().mockRejectedValue(throttled) },
    });
    await expect(permanent.send(message)).rejects.toMatchObject({
      permanent: true,
      code: "ses_MessageRejected",
    });
    await expect(transient.send(message)).rejects.toMatchObject({
      permanent: false,
      code: "ses_TooManyRequestsException",
    });
    await expect(transient.send(message)).rejects.toBeInstanceOf(DeliveryProviderError);
  });
});

describe("WebPushProvider", () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = pair.publicKey.export({ format: "jwk" });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]).toString("base64url");
  const now = () => new Date("2026-10-23T12:00:00.000Z");
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

  const provider = (response: Response | Error) => {
    const fetchImplementation = vi.fn().mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    return {
      fetchImplementation,
      instance: new WebPushProvider({
        privateKeyPem,
        publicKey,
        subject: "mailto:ops@example.com",
        now,
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      }),
    };
  };

  it("posts an empty body with a verifiable VAPID signature for the endpoint origin", async () => {
    const { fetchImplementation, instance } = provider(new Response(null, { status: 201 }));
    await expect(instance.send(endpoint)).resolves.toBe("delivered");
    const [url, init] = fetchImplementation.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers.TTL).toBe("3600");
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization ?? "");
    expect(match?.[2]).toBe(publicKey);
    const [header, payload, signature] = (match?.[1] ?? "").split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString());
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now().getTime() / 1000) + 43_200,
      sub: "mailto:ops@example.com",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: pair.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("reports a gone subscription for 404 and 410", async () => {
    await expect(
      provider(new Response(null, { status: 410 })).instance.send(endpoint),
    ).resolves.toBe("gone");
    await expect(
      provider(new Response(null, { status: 404 })).instance.send(endpoint),
    ).resolves.toBe("gone");
  });

  it("retries rather than expires when the platform identity or the service fails", async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      await expect(
        provider(new Response(null, { status })).instance.send(endpoint),
      ).rejects.toMatchObject({ permanent: false, code: `push_status_${status}` });
    }
    await expect(
      provider(new TypeError("fetch failed")).instance.send(endpoint),
    ).rejects.toMatchObject({
      permanent: false,
      code: "push_network_error",
    });
  });

  it("never calls out to a host outside the allow list", async () => {
    const { fetchImplementation, instance } = provider(new Response(null, { status: 201 }));
    await expect(instance.send("https://evil.example.com/push")).resolves.toBe("gone");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("refuses unusable configuration", () => {
    const base = { privateKeyPem, publicKey, subject: "mailto:ops@example.com" };
    expect(() => new WebPushProvider({ ...base, subject: "ops@example.com" })).toThrow("subject");
    expect(() => new WebPushProvider({ ...base, publicKey: "AAAA" })).toThrow("public key");
    expect(() => new WebPushProvider({ ...base, privateKeyPem: "nope" })).toThrow();
  });
});
