import { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { handler } from "./cover-letter-isolated-provider-lambda.js";
import { isolatedProviderFixture } from "./cover-letter-isolated-provider-test-support.js";

describe("source-only isolated provider bootstrap", () => {
  it.each(["claim", "reserve", "dispatch", "result"])(
    "lost %s acknowledgement never grants another model call",
    async (fault) => {
      const f = await isolatedProviderFixture();
      const originalInvoke = f.invoke.getMockImplementation();
      const originalObject = f.objectSend.getMockImplementation();
      let lost = false;
      f.invoke.mockImplementation(async (...args) => {
        const input = JSON.parse(new TextDecoder().decode(args[0].input.Payload as Uint8Array));
        const output = await originalInvoke?.(...args);
        if (!lost && input.action === fault) {
          lost = true;
          throw Error("SyntheticLostRPCACK");
        }
        if (!output) throw Error();
        return output;
      });
      f.objectSend.mockImplementation(async (command) => {
        const output = await originalObject?.(command);
        if (
          !lost &&
          command instanceof PutObjectCommand &&
          command.input.IfMatch &&
          command.input.Key?.includes(`/${fault}.v1.json`)
        ) {
          lost = true;
          throw Error("SyntheticLostObjectACK");
        }
        if (!output) throw Error();
        return output;
      });
      expect((await f.call()).outcome).toBe("in_progress");
      await f.call();
      expect(lost).toBe(true);
      expect(f.modelFetch).toHaveBeenCalledTimes(fault === "result" ? 1 : 0);
      expect(
        f.invoke.mock.calls.map(
          ([command]) =>
            JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array)).action,
        ),
      ).not.toContain("settle");
    },
  );
  it.each([
    ["COVER_LETTER_ISOLATED_PROVIDER_ENABLED", undefined],
    ["COVER_LETTER_ISOLATED_PROVIDER_ENABLED", "false"],
    ["COVER_LETTER_ISOLATED_PROVIDER_ENABLED", "TRUE"],
    ["COVER_LETTER_BACKGROUND_PROVIDER_ENABLED", undefined],
    ["COVER_LETTER_BACKGROUND_PROVIDER_ENABLED", "false"],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "invalid"],
    ["AWS_LAMBDA_FUNCTION_NAME", "bad:name"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "alias"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "0"],
    ["AWS_SESSION_TOKEN", ""],
    ["DATABASE_URL", "postgres://synthetic"],
    ["DATABASE_SECRET_ID", "synthetic-db"],
    ["OPENAI_API_KEY", "plaintext-key"],
    ["OPENAI_API_KEY", ""],
    ["CANDIDATE_DOCUMENT_BUCKET", "bad.bucket"],
    ["CANDIDATE_DOCUMENT_BUCKET", ""],
    [
      "PLATFORM_KMS_KEY_ARN",
      "arn:aws:kms:us-east-2:999999999999:key/019a4000-0000-7000-8000-000000000003",
    ],
    [
      "COVER_LETTER_OPENAI_SECRET_ID",
      "arn:aws:secretsmanager:us-east-2:999999999999:secret:synthetic",
    ],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic-name"],
    [
      "COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:alias",
    ],
    [
      "COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:999999999999:function:synthetic-control:3",
    ],
    [
      "COVER_LETTER_RESPONSE_CAPTURE_FUNCTION_ARN",
      "arn:aws:lambda:us-east-1:123456789012:function:synthetic-capture:5",
    ],
    [
      "COVER_LETTER_RESPONSE_CAPTURE_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:5",
    ],
    [
      "COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:10",
    ],
  ])("refuses configuration %s=%s before secret/client/I/O access", async (key, value) => {
    const f = await isolatedProviderFixture();
    f.env[key ?? ""] = value;
    await expect(f.call()).resolves.toMatchObject({ outcome: "in_progress" });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.createObjectClient).not.toHaveBeenCalled();
    expect(f.createLambdaClient).not.toHaveBeenCalled();
    expect(f.objectSend).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.modelFetch).not.toHaveBeenCalled();
  });
  it("exported entrypoint refuses while default-off", async () => {
    const f = await isolatedProviderFixture();
    await expect(handler(f.input, { invokedFunctionArn: f.target })).resolves.toMatchObject({
      outcome: "in_progress",
    });
  });
  it.each([
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:8",
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider",
  ])("refuses invoked target %s before I/O", async (target) => {
    const f = await isolatedProviderFixture();
    await expect(f.run(f.input, { invokedFunctionArn: target })).resolves.toMatchObject({
      outcome: "in_progress",
    });
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each(["extra", "wrong_owner", "missing", "accessor", "proxy"])(
    "rejects malformed input %s before setup",
    async (fault) => {
      const f = await isolatedProviderFixture();
      const input = { ...f.input };
      if (fault === "extra") Object.assign(input, { text: "SyntheticForbiddenPrompt" });
      if (fault === "wrong_owner") input.documentId = "invalid";
      if (fault === "missing") Object.assign(input, { request: undefined });
      if (fault === "accessor")
        Object.defineProperty(input, "request", {
          get() {
            throw Error("SyntheticPrivateDiagnostic");
          },
        });
      const raw =
        fault === "proxy"
          ? new Proxy(input, {
              getPrototypeOf() {
                throw Error("SyntheticPrivateReflectionDiagnostic");
              },
            })
          : input;
      await expect(f.run(raw, { invokedFunctionArn: f.target })).rejects.toThrow(
        "CoverLetterProviderTransportRejected",
      );
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it("connects real actor/object/gateway/control/capture ports and replay without another model call", async () => {
    const f = await isolatedProviderFixture();
    await expect(f.call()).resolves.toMatchObject({ outcome: "ready" });
    await expect(f.call()).resolves.toMatchObject({ outcome: "ready" });
    expect(f.modelFetch).toHaveBeenCalledTimes(1);
    expect(f.createObjectClient).toHaveBeenCalledTimes(1);
    expect(f.createLambdaClient).toHaveBeenCalledTimes(1);
    const settings = { region: "us-east-2", maxAttempts: 1, ignoreConfiguredEndpointUrls: true };
    expect(f.createObjectClient).toHaveBeenCalledWith(settings);
    expect(f.createLambdaClient).toHaveBeenCalledWith(settings);
    expect(f.resolve).toHaveBeenCalledTimes(2); // Extension owns rotation, no retained warm key.
    const actions = f.invoke.mock.calls.map(
      ([cmd]) => JSON.parse(new TextDecoder().decode(cmd.input.Payload as Uint8Array)).action,
    );
    expect(actions).toEqual(["claim", "reserve", "record_creation", "settle"]);
    for (const [command] of f.objectSend.mock.calls)
      if (command instanceof PutObjectCommand) {
        expect(command.input.IfMatch).toBeTruthy();
        expect(command.input.IfNoneMatch).toBeUndefined();
      }
    expect(
      f.invoke.mock.calls.every(
        ([command]) =>
          command.input.InvocationType === "RequestResponse" && command.input.LogType === "None",
      ),
    ).toBe(true);
  });
  it.each(["secret_failure", "invalid_key", "withdrawal", "changed_target", "changed_bucket"])(
    "refuses %s after read-only setup with no effects",
    async (fault) => {
      const f = await isolatedProviderFixture();
      f.resolve.mockImplementation(async () => {
        if (fault === "secret_failure") throw Error("SyntheticPrivateSecretDiagnostic");
        if (fault === "withdrawal") f.env.COVER_LETTER_ISOLATED_PROVIDER_ENABLED = "false";
        if (fault === "changed_target")
          f.env.COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN =
            f.env.COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN?.replace(":3", ":4");
        if (fault === "changed_bucket") f.env.CANDIDATE_DOCUMENT_BUCKET = "another-bucket";
        return fault === "invalid_key" ? "short" : "synthetic-api-key-value";
      });
      await expect(f.call()).resolves.toEqual({
        schemaVersion: 1,
        documentId: f.input.documentId,
        outcome: "in_progress",
      });
      expect(f.createObjectClient).not.toHaveBeenCalled();
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.modelFetch).not.toHaveBeenCalled();
    },
  );
  it("retries only failed read-only setup on a later call", async () => {
    const f = await isolatedProviderFixture();
    f.resolve.mockRejectedValueOnce(Error("SyntheticSecretUnavailable"));
    expect((await f.call()).outcome).toBe("in_progress");
    expect((await f.call()).outcome).toBe("ready");
    expect(f.modelFetch).toHaveBeenCalledTimes(1);
    expect(f.invoke).toHaveBeenCalledTimes(4);
  });
  it("coalesces concurrent secret reads and preserves one dispatch winner", async () => {
    const f = await isolatedProviderFixture();
    let release: ((key: string) => void) | undefined;
    f.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f.call();
    const second = f.call();
    expect(f.resolve).toHaveBeenCalledTimes(1);
    release?.("synthetic-api-key-value");
    const outputs = await Promise.all([first, second]);
    expect(outputs.some((output) => output.outcome === "ready")).toBe(true);
    expect(f.createObjectClient).toHaveBeenCalledTimes(1);
    expect(f.modelFetch).toHaveBeenCalledTimes(1);
  });
  it("refuses a changed configuration after successful setup", async () => {
    const f = await isolatedProviderFixture();
    await f.call();
    f.env.COVER_LETTER_OPENAI_SECRET_ID += "changed";
    expect((await f.call()).outcome).toBe("in_progress");
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.modelFetch).toHaveBeenCalledTimes(1);
  });
  it("one-attempt RPC lost capture ACK cannot write a result or redispatch", async () => {
    const f = await isolatedProviderFixture();
    const original = f.invoke.getMockImplementation();
    f.invoke.mockImplementation(async (...args) => {
      const action = JSON.parse(
        new TextDecoder().decode(args[0].input.Payload as Uint8Array),
      ).action;
      const output = await original?.(...args);
      if (action === "record_creation") throw Error("SyntheticLostCaptureACK");
      if (!output) throw Error();
      return output;
    });
    expect((await f.call()).outcome).toBe("in_progress");
    expect((await f.call()).outcome).toBe("in_progress");
    expect(f.modelFetch).toHaveBeenCalledTimes(1);
    const puts = f.objectSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.input.Key).toContain("dispatch");
  });
});
