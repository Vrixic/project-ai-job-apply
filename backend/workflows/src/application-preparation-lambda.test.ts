import { describe, expect, it, vi } from "vitest";
import type { ApplicationPreparationActivityInput } from "./application-preparation-contract.js";
import { createApplicationPreparationLambda } from "./application-preparation-lambda.js";

const input: ApplicationPreparationActivityInput = {
  schemaVersion: 1,
  workflowDefinitionVersion: 1,
  eventId: "01900000-0000-7000-8000-000000000001",
  preparationId: "01900000-0000-7000-8000-000000000002",
  action: "advance",
};
const environment = () => ({
  APPLICATION_PREPARATION_ACTIVITY_ENABLED: "true",
  AWS_REGION: "us-east-2",
  PLATFORM_AWS_ACCOUNT_ID: "123456789012",
  AWS_LAMBDA_FUNCTION_NAME: "private-preparation",
  AWS_LAMBDA_FUNCTION_VERSION: "9",
  AWS_SESSION_TOKEN: "synthetic-token",
  DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
  COVER_LETTER_PROVIDER_FUNCTION_ARN:
    "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:7",
  CANDIDATE_DOCUMENT_BUCKET: "synthetic-preparation",
  PLATFORM_KMS_KEY_ARN:
    "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000001",
});
const target = "arn:aws:lambda:us-east-2:123456789012:function:private-preparation:9";
const unavailable = {
  schemaVersion: 1,
  action: "advance",
  preparationId: input.preparationId,
  outcome: "retryable_failure",
  errorCode: "store_unavailable",
};
function fixture() {
  const env: Record<string, string | undefined> = environment();
  const run = vi.fn(async (raw: unknown) => {
    const value = raw as typeof input;
    return {
      schemaVersion: 1 as const,
      action: value.action,
      preparationId: value.preparationId,
      outcome: "completed" as const,
    };
  });
  const resolveDatabaseUrl = vi.fn(async () => "postgres://synthetic.invalid/preparation");
  const createRuntime = vi.fn(() => ({ run, close: vi.fn(async () => undefined) }));
  const handler = createApplicationPreparationLambda({
    environment: () => env,
    resolveDatabaseUrl,
    createRuntime,
  });
  return { env, run, resolveDatabaseUrl, createRuntime, handler };
}
describe("native private preparation bootstrap", () => {
  it.each([
    ["APPLICATION_PREPARATION_ACTIVITY_ENABLED", undefined],
    ["APPLICATION_PREPARATION_ACTIVITY_ENABLED", "TRUE"],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "bad"],
    ["AWS_LAMBDA_FUNCTION_NAME", "bad:name"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "alias"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "0"],
    ["AWS_SESSION_TOKEN", undefined],
    ["DATABASE_URL", ""],
    ["OPENAI_API_KEY", ""],
    ["OPENAI_API_KEY_SECRET_ID", "synthetic"],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic"],
    ["DATABASE_SECRET_ID", undefined],
    ["DATABASE_SECRET_ID", "arn:aws:secretsmanager:us-east-2:999999999999:secret:foreign"],
    ["COVER_LETTER_PROVIDER_FUNCTION_ARN", undefined],
    ["COVER_LETTER_PROVIDER_FUNCTION_ARN", target],
    ["COVER_LETTER_PROVIDER_FUNCTION_ARN", target.replace(":9", ":8")],
    [
      "COVER_LETTER_PROVIDER_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:999999999999:function:foreign:7",
    ],
    [
      "COVER_LETTER_PROVIDER_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:provider:alias",
    ],
    ["CANDIDATE_DOCUMENT_BUCKET", undefined],
    ["CANDIDATE_DOCUMENT_BUCKET", "bad..bucket"],
    ["PLATFORM_KMS_KEY_ARN", undefined],
    [
      "PLATFORM_KMS_KEY_ARN",
      environment().PLATFORM_KMS_KEY_ARN.replace("123456789012", "999999999999"),
    ],
  ] as const)("refuses %s=%s before secret/runtime I/O", async (key, value) => {
    const f = fixture();
    f.env[key] = value;
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each([
    target.replace(":9", ":8"),
    target.replace(":9", ""),
    target.replace("private-preparation", "foreign"),
  ])("refuses foreign invoked target %s", async (arn) => {
    const f = fixture();
    expect(await f.handler(input, { invokedFunctionArn: arn })).toEqual(unavailable);
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("rejects extra candidate data before environment or I/O", async () => {
    const env = vi.fn(environment);
    const f = fixture();
    const handler = createApplicationPreparationLambda({
      environment: env,
      resolveDatabaseUrl: f.resolveDatabaseUrl,
      createRuntime: f.createRuntime,
    });
    await expect(
      handler({ ...input, facts: "synthetic" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("ApplicationPreparationActivityInputRejected");
    expect(env).not.toHaveBeenCalled();
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("single-flights read-only initialization, pins configuration and detaches event", async () => {
    const f = fixture();
    let release: (url: string) => void = () => undefined;
    f.resolveDatabaseUrl.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const original = structuredClone(input);
    const first = f.handler(original, { invokedFunctionArn: target });
    const second = f.handler(input, { invokedFunctionArn: target });
    original.preparationId = "01900000-0000-7000-8000-000000000099";
    release("postgres://synthetic.invalid/preparation");
    await Promise.all([first, second]);
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls[0]?.[0]).toEqual(input);
    expect(f.resolveDatabaseUrl).toHaveBeenCalledWith(
      { DATABASE_SECRET_ID: f.env.DATABASE_SECRET_ID },
      {
        sessionToken: "synthetic-token",
        requestTimeoutMilliseconds: 3000,
        retryDelaysMilliseconds: [],
      },
    );
  });
  it.each([
    "CANDIDATE_DOCUMENT_BUCKET",
    "PLATFORM_KMS_KEY_ARN",
    "COVER_LETTER_PROVIDER_FUNCTION_ARN",
    "DATABASE_SECRET_ID",
  ])("refuses warm %s drift without recomposition", async (key) => {
    const f = fixture();
    await f.handler(input, { invokedFunctionArn: target });
    f.env[key] += "changed";
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
  it("withdrawn activation during secret resolution creates no pools", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockImplementation(async () => {
      f.env.APPLICATION_PREPARATION_ACTIVITY_ENABLED = "false";
      return "postgres://synthetic.invalid/preparation";
    });
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.createRuntime).not.toHaveBeenCalled();
  });
  it("retries only failed read-only setup on a later call with original config", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockRejectedValueOnce(Error("synthetic secret diagnostic"));
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(await f.handler(input, { invokedFunctionArn: target })).toMatchObject({
      outcome: "completed",
    });
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(2);
  });
  it("does not retry or recompose an activity effect after an exception", async () => {
    const f = fixture();
    f.run.mockRejectedValueOnce(Error("synthetic candidate diagnostic"));
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.handler(input, { invokedFunctionArn: target });
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
  it("withholds a completed result after activation withdrawal", async () => {
    const f = fixture();
    f.run.mockImplementation(async (raw) => {
      const value = raw as typeof input;
      f.env.APPLICATION_PREPARATION_ACTIVITY_ENABLED = "false";
      return {
        schemaVersion: 1,
        action: value.action,
        preparationId: value.preparationId,
        outcome: "completed",
      };
    });
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
  });
  it("routes fail to the same owner-bound runtime without changing the accepted input", async () => {
    const f = fixture();
    const fail = { ...input, action: "fail" as const };
    await f.handler(fail, { invokedFunctionArn: target });
    expect(f.run).toHaveBeenCalledWith(fail);
  });
});
