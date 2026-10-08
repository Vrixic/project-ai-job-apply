import type { GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeTaskSecretReader, validNativeSecretReference } from "./native-task-secrets.js";

const reference = {
  arn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:native/provider-Abc123",
  versionId: "12345678-1234-1234-1234-123456789012",
};
const accountId = "123456789012";
const secret = "synthetic-secret-never-a-real-key";
function fixture() {
  const enabled = vi.fn(() => true);
  const send = vi.fn(
    async (): Promise<GetSecretValueCommandOutput> => ({
      $metadata: {},
      ARN: reference.arn,
      VersionId: reference.versionId,
      SecretString: secret,
    }),
  );
  const read = createNativeTaskSecretReader({
    reference,
    accountId,
    enabled,
    testClient: { send },
  });
  return { read, enabled, send };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("exact-version native image secret read", () => {
  it("sends one exact ARN/version request and refuses a second attempt", async () => {
    const f = fixture();
    await expect(f.read()).resolves.toBe(secret);
    const calls = f.send.mock.calls as unknown as Array<
      [{ input: unknown }, { abortSignal: AbortSignal }]
    >;
    expect(calls[0]?.[0].input).toEqual({
      SecretId: reference.arn,
      VersionId: reference.versionId,
    });
    expect(calls[0]?.[1].abortSignal.aborted).toBe(false);
    await expect(f.read()).rejects.toThrow("NativeImageConfigurationUnavailable");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("defaults off before transport", async () => {
    const send = vi.fn();
    await expect(
      createNativeTaskSecretReader({ reference, accountId, testClient: { send } })(),
    ).rejects.toThrow("NativeImageConfigurationUnavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { ARN: `${reference.arn}-foreign` },
    { VersionId: "f".repeat(32) },
    { SecretBinary: new Uint8Array([1]) },
    { SecretString: "" },
    { SecretString: "s".repeat(65_537) },
    { SecretString: undefined },
  ])("refuses incorrect or unsupported secret replies %j", async (change) => {
    const f = fixture();
    f.send.mockResolvedValueOnce({
      $metadata: {},
      ARN: reference.arn,
      VersionId: reference.versionId,
      SecretString: secret,
      ...change,
    });
    await expect(f.read()).rejects.toThrow("NativeImageConfigurationUnavailable");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("withholds after revocation and redacts SDK failures", async () => {
    const f = fixture();
    f.send.mockImplementationOnce(async () => {
      f.enabled.mockReturnValue(false);
      return {
        $metadata: {},
        ARN: reference.arn,
        VersionId: reference.versionId,
        SecretString: secret,
      };
    });
    await expect(f.read()).rejects.toThrow(/^NativeImageConfigurationUnavailable$/u);
    const other = fixture();
    other.send.mockRejectedValueOnce(Error(secret));
    await expect(other.read()).rejects.toThrow(/^NativeImageConfigurationUnavailable$/u);
  });
  it("holds the transport until actual settlement after deadline", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let settle!: (value: Awaited<ReturnType<typeof f.send>>) => void;
    f.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    let finished = false;
    const outcome = f.read().catch((error: unknown) => {
      finished = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(5001);
    expect(finished).toBe(false);
    settle({
      $metadata: {},
      ARN: reference.arn,
      VersionId: reference.versionId,
      SecretString: secret,
    });
    expect(await outcome).toEqual(Error("NativeImageConfigurationUnavailable"));
  });
  it("refuses production test seams before transport and after an awaited reply", async () => {
    const f = fixture();
    f.send.mockImplementationOnce(async () => {
      vi.stubEnv("NODE_ENV", "production");
      return {
        $metadata: {},
        ARN: reference.arn,
        VersionId: reference.versionId,
        SecretString: secret,
      };
    });
    await expect(f.read()).rejects.toThrow("NativeImageConfigurationUnavailable");
    expect(() => fixture()).toThrow("NativeImageConfigurationUnavailable");
  });
  it.each(["", "12345678901", ".*", "123456789012:other"])(
    "refuses malformed account %s",
    (account) => {
      expect(validNativeSecretReference(reference, account)).toBe(false);
    },
  );
  it.each([
    { ...reference, versionId: "AWSCURRENT" },
    { ...reference, versionId: "" },
    { ...reference, arn: reference.arn.replace("us-east-2", "us-east-1") },
    { ...reference, arn: reference.arn.replace(accountId, "999999999999") },
    { ...reference, stage: "AWSCURRENT" },
  ])("refuses unsafe reviewed references %j", (ref) => {
    expect(validNativeSecretReference(ref, accountId)).toBe(false);
  });
});
