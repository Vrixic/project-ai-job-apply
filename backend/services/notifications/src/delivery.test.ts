import { describe, expect, it, vi } from "vitest";
import {
  DeliveryProviderError,
  normalizeEmailAddress,
  notificationEmail,
  retryDelayMilliseconds,
} from "./delivery.js";
import { SesEmailProvider } from "./providers/ses-email.js";
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
