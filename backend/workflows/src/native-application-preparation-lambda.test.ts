import { describe, expect, it, vi } from "vitest";
import { createNativeApplicationPreparationLambda } from "./native-application-preparation-lambda.js";

const target = "arn:aws:lambda:us-east-2:123456789012:function:native-preparation:9";
const input = {
  schemaVersion: 1 as const,
  workflowDefinitionVersion: 1 as const,
  action: "advance" as const,
  eventId: "019a4000-0000-7000-8000-000000000001",
  preparationId: "019a4000-0000-7000-8000-000000000002",
};
function fixture() {
  const env: Record<string, string | undefined> = {
    NATIVE_APPLICATION_PREPARATION_ENABLED: "true",
    NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED: "true",
    RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
    RESTRICTED_PACKET_ENCRYPTION_KEY_ARN:
      "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111",
    RESTRICTED_PACKET_FINGERPRINT_KEY_ARN:
      "arn:aws:kms:us-east-2:123456789012:key/22222222-2222-4222-8222-222222222222",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "native-preparation",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db",
    NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN:
      "arn:aws:lambda:us-east-2:123456789012:function:native-launch:7",
  };
  const result = {
    schemaVersion: 1 as const,
    action: input.action,
    preparationId: input.preparationId,
    outcome: "completed" as const,
  };
  const run = vi.fn(async () => result);
  const resolveDatabaseUrl = vi.fn(async () => "postgres://synthetic.invalid/native-preparation");
  const createRuntime = vi.fn(
    (_url: string, _config: unknown, _enabled: () => boolean, _launchEnabled: () => boolean) => ({
      run,
      close: async () => undefined,
    }),
  );
  const handler = createNativeApplicationPreparationLambda({
    environment: () => env,
    resolveDatabaseUrl,
    createRuntime,
  });
  return { env, handler, run, createRuntime, resolveDatabaseUrl, result };
}
describe("dedicated native preparation bootstrap", () => {
  it.each([
    ["NATIVE_APPLICATION_PREPARATION_ENABLED", undefined],
    ["RESTRICTED_PACKET_PROTECTION_ENABLED", undefined],
    ["RESTRICTED_PACKET_ENCRYPTION_KEY_ARN", ""],
    [
      "RESTRICTED_PACKET_FINGERPRINT_KEY_ARN",
      "arn:aws:kms:us-east-1:123456789012:key/22222222-2222-4222-8222-222222222222",
    ],
    ["RESTRICTED_PACKET_HISTORICAL_KEYS_JSON", "bad"],
    ["NATIVE_APPLICATION_PREPARATION_ENABLED", "TRUE"],
    ["NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED", "TRUE"],
    ["AWS_REGION", "us-east-1"],
    ["AWS_SESSION_TOKEN", undefined],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["DATABASE_SECRET_ID", "arn:aws:secretsmanager:us-east-2:999999999999:secret:foreign"],
    ["NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN", undefined],
    ["NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN", target],
    ["NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN", target.replace(":9", ":8")],
    [
      "NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:123456789012:function:native-launch:alias",
    ],
    [
      "NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN",
      "arn:aws:lambda:us-east-2:999999999999:function:native-launch:7",
    ],
    ["DATABASE_URL", ""],
    ["OPENAI_API_KEY", ""],
    ["OPENAI_API_KEY_SECRET_ID", ""],
    ["COVER_LETTER_OPENAI_SECRET_ID", ""],
    ["COVER_LETTER_PROVIDER_FUNCTION_ARN", ""],
    ["CANDIDATE_DOCUMENT_BUCKET", ""],
    ["PLATFORM_KMS_KEY_ARN", ""],
  ])("refuses %s before secret/runtime I/O", async (key, value) => {
    const f = fixture();
    f.env[key as string] = value;
    expect(await f.handler(input, { invokedFunctionArn: target })).toMatchObject({
      outcome: "retryable_failure",
      errorCode: "store_unavailable",
    });
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
  });
  it("allows recovery while fresh launch is disabled, without repinning configuration", async () => {
    const f = fixture();
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(f.result);
    const launchEnabled = f.createRuntime.mock.calls[0]?.[3];
    expect(launchEnabled?.()).toBe(true);
    f.env.NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED = "false";
    expect(launchEnabled?.()).toBe(false);
    expect(await f.handler(input, { invokedFunctionArn: target })).toEqual(f.result);
    expect(f.createRuntime).toHaveBeenCalledOnce();
  });
  it("single-flights startup and refuses configuration drift", async () => {
    const f = fixture();
    await Promise.all([
      f.handler(input, { invokedFunctionArn: target }),
      f.handler(input, { invokedFunctionArn: target }),
    ]);
    expect(f.resolveDatabaseUrl).toHaveBeenCalledOnce();
    expect(f.createRuntime).toHaveBeenCalledOnce();
    f.env.NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN = f.env.NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN?.replace(
      ":7",
      ":8",
    );
    expect(await f.handler(input, { invokedFunctionArn: target })).toMatchObject({
      errorCode: "store_unavailable",
    });
    expect(f.run).toHaveBeenCalledTimes(2);
  });
  it("rejects content-bearing input before initialization", async () => {
    const f = fixture();
    await expect(
      f.handler({ ...input, body: "Synthetic forbidden" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("ApplicationPreparationActivityInputRejected");
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("refuses a foreign invoked version", async () => {
    const f = fixture();
    expect(
      await f.handler(input, { invokedFunctionArn: target.replace(":9", ":8") }),
    ).toMatchObject({ errorCode: "store_unavailable" });
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
});

it("refuses route commands by default and legacy advance under routing before initialization", async () => {
  const f = fixture();
  const route = {
    schemaVersion: 1,
    protocol: "native-preparation-route.v1",
    eventId: input.eventId,
    preparationId: input.preparationId,
    action: "stage",
  };
  expect(await f.handler(route, { invokedFunctionArn: target })).toMatchObject({
    outcome: "pending",
    original: null,
  });
  expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  f.env.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED = "true";
  expect(await f.handler(input, { invokedFunctionArn: target })).toMatchObject({
    errorCode: "store_unavailable",
  });
  expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
});
it("routes metadata through the pinned runtime and validates its exact request", async () => {
  const f = fixture();
  f.env.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED = "true";
  const route = {
    schemaVersion: 1 as const,
    protocol: "native-preparation-route.v1" as const,
    eventId: input.eventId,
    preparationId: input.preparationId,
    action: "stage" as const,
  };
  const runRoute = vi.fn(async () => ({
    schemaVersion: 1 as const,
    request: route,
    outcome: "terminal" as const,
    original: null,
  }));
  const handler = createNativeApplicationPreparationLambda({
    environment: () => f.env,
    resolveDatabaseUrl: f.resolveDatabaseUrl,
    createRuntime: () => ({ run: f.run, runRoute, close: async () => undefined }),
  });
  expect(await handler(route, { invokedFunctionArn: target })).toEqual(await runRoute());
  expect(f.run).not.toHaveBeenCalled();
  runRoute.mockResolvedValue({
    schemaVersion: 1,
    request: { ...route, eventId: input.preparationId },
    outcome: "terminal",
    original: null,
  });
  expect(await handler(route, { invokedFunctionArn: target })).toMatchObject({
    outcome: "pending",
  });
});
