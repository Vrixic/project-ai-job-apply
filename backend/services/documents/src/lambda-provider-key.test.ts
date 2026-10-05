import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLambdaProviderKey } from "./lambda-provider-key.js";

const input = {
  secretId: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-openai-ABCDEF",
  sessionToken: "synthetic-session-token",
};
afterEach(() => vi.useRealTimers());
describe("bounded managed provider key", () => {
  it("uses only the fixed extension endpoint and returns the key without environment mutation", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ SecretString: "synthetic-api-key-value", ARN: input.secretId }),
    );
    expect(await resolveLambdaProviderKey(input, transport)).toBe("synthetic-api-key-value");
    const [url, settings] = transport.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(input.secretId)}`,
    );
    expect(settings).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { "X-Aws-Parameters-Secrets-Token": input.sessionToken },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { SecretString: "" },
    { SecretString: "short" },
    { SecretString: "a".repeat(513) },
    { SecretString: `${"a".repeat(16)}\n` },
    { SecretString: "key containing spaces" },
    { SecretString: 123 },
    { SecretString: { key: "synthetic" } },
    { SecretString: "synthetic-api-key-value", SecretBinary: "forbidden" },
    [],
  ])("refuses invalid value %j without content diagnostics", async (payload) => {
    await expect(
      resolveLambdaProviderKey(input, async () => Response.json(payload)),
    ).rejects.toThrow("CoverLetterProviderTransportRejected");
  });
  it.each([404, 429, 500])("does not retry HTTP %i", async (status) => {
    const cancel = vi.fn();
    const transport = vi.fn<typeof fetch>(
      async () => new Response(new ReadableStream({ cancel }), { status }),
    );
    await expect(resolveLambdaProviderKey(input, transport)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["{", "a".repeat(4097)])("rejects malformed or oversized bodies", async (value) => {
    await expect(
      resolveLambdaProviderKey(input, async () => new Response(value)),
    ).rejects.toThrow();
  });
  it("bounds byte size across chunks and cancels an oversized stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(3000));
        c.enqueue(new Uint8Array(1500));
      },
      cancel,
    });
    await expect(
      resolveLambdaProviderKey(input, async () => new Response(stream)),
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("refuses malformed UTF-8", async () => {
    await expect(
      resolveLambdaProviderKey(input, async () => new Response(new Uint8Array([0xff]))),
    ).rejects.toThrow();
  });
  it.each(["fetch", "body"])("bounds stalled %s and supplies no timeout proof", async (fault) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const transport: typeof fetch = async () =>
      fault === "fetch"
        ? new Promise(() => undefined)
        : new Response(new ReadableStream({ cancel }));
    const assertion = expect(resolveLambdaProviderKey(input, transport)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3001);
    await assertion;
    if (fault === "body") expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...input, secretId: "bad" },
    { ...input, sessionToken: "" },
  ])("refuses absent managed context before fetch", async (value) => {
    const transport = vi.fn<typeof fetch>();
    await expect(resolveLambdaProviderKey(value, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
