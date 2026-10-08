import { describe, expect, it, vi } from "vitest";
import { createApplicationPreparationStarterLambda } from "./application-preparation-starter-lambda.js";

const target = "arn:aws:lambda:us-east-2:123456789012:function:preparation-starter:9";
const durable = "arn:aws:lambda:us-east-2:123456789012:function:preparation-durable:7";
const queue = "arn:aws:sqs:us-east-2:123456789012:preparation";
const payload = {
  schemaVersion: 1,
  eventId: "01900000-0000-7000-8000-000000000001",
  eventType: "application.packet-preparation.requested.v1",
  data: { preparationId: "01900000-0000-7000-8000-000000000002" },
};
const batch = () => {
  const record = {
    messageId: "synthetic-1",
    eventSource: "aws:sqs",
    eventSourceARN: queue,
    body: JSON.stringify(payload),
  };
  return { Records: [record], record };
};
const unavailable = { batchItemFailures: [{ itemIdentifier: "synthetic-1" }] };
const environment = () => ({
  APPLICATION_PREPARATION_STARTER_ENABLED: "true",
  APPLICATION_PREPARATION_INTAKE_ENABLED: "true",
  AWS_REGION: "us-east-2",
  PLATFORM_AWS_ACCOUNT_ID: "123456789012",
  AWS_LAMBDA_FUNCTION_NAME: "preparation-starter",
  AWS_LAMBDA_FUNCTION_VERSION: "9",
  AWS_SESSION_TOKEN: "synthetic-token",
  DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
  APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN: durable,
  APPLICATION_PREPARATION_QUEUE_ARN: queue,
});
function fixture() {
  const env: Record<string, string | undefined> = environment();
  const start = vi.fn(async (_input: unknown) => undefined);
  const resolveDatabaseUrl = vi.fn(async () => "postgres://synthetic.invalid/preparation");
  const createRuntime = vi.fn(() => ({ start, close: vi.fn(async () => undefined) }));
  const handler = createApplicationPreparationStarterLambda({
    environment: () => env,
    resolveDatabaseUrl,
    createRuntime,
  });
  return { env, start, resolveDatabaseUrl, createRuntime, handler };
}
describe("native preparation SQS starter", () => {
  it.each([
    ["APPLICATION_PREPARATION_STARTER_ENABLED", undefined],
    ["APPLICATION_PREPARATION_STARTER_ENABLED", "TRUE"],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "bad"],
    ["AWS_LAMBDA_FUNCTION_NAME", "bad:name"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "09"],
    ["AWS_SESSION_TOKEN", undefined],
    ["DATABASE_URL", ""],
    ["OPENAI_API_KEY", ""],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic"],
    ["DATABASE_SECRET_ID", undefined],
    [
      "DATABASE_SECRET_ID",
      environment().DATABASE_SECRET_ID.replace("123456789012", "999999999999"),
    ],
    ["APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN", target],
    ["APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN", durable.replace(":7", ":alias")],
    [
      "APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN",
      durable.replace("123456789012", "999999999999"),
    ],
    ["APPLICATION_PREPARATION_QUEUE_ARN", queue.replace("123456789012", "999999999999")],
    ["APPLICATION_PREPARATION_QUEUE_ARN", `${queue}.fifo`],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", "invalid"],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", "[]"],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", JSON.stringify([durable, durable])],
    [
      "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS",
      JSON.stringify([durable.replace(":7", ":6")]),
    ],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", JSON.stringify([durable, target])],
  ] as const)("keeps unavailable %s=%s failed without secret/runtime I/O", async (key, value) => {
    const f = fixture();
    f.env[key] = value;
    expect(await f.handler(batch(), { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    expect(f.createRuntime).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });
  it("rejects duplicate identifiers before environment setup", async () => {
    const f = fixture();
    const event = batch();
    event.Records.push({ ...event.record });
    await expect(f.handler(event, { invokedFunctionArn: target })).rejects.toThrow(
      "ApplicationPreparationStarterInputRejected",
    );
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it.each(["foreign_queue", "invalid_json", "candidate_text"])(
    "refuses %s before managed-secret reads",
    async (kind) => {
      const f = fixture();
      const event = batch();
      const record = event.record;
      if (kind === "foreign_queue") record.eventSourceARN = `${queue}foreign`;
      else
        record.body =
          kind === "invalid_json" ? "bad" : JSON.stringify({ ...payload, text: "synthetic" });
      expect(await f.handler(event, { invokedFunctionArn: target })).toEqual(unavailable);
      expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
    },
  );
  it("refuses foreign invoked version before setup", async () => {
    const f = fixture();
    expect(await f.handler(batch(), { invokedFunctionArn: target.replace(":9", ":8") })).toEqual(
      unavailable,
    );
    expect(f.resolveDatabaseUrl).not.toHaveBeenCalled();
  });
  it("projects/detaches batch and single-flights setup across concurrent calls", async () => {
    const f = fixture();
    let release: (url: string) => void = () => undefined;
    f.resolveDatabaseUrl.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const event = batch();
    const first = f.handler(event, { invokedFunctionArn: target });
    const second = f.handler(batch(), { invokedFunctionArn: target });
    event.record.body = "bad";
    release("postgres://synthetic.invalid/preparation");
    expect(await first).toEqual({ batchItemFailures: [] });
    expect(await second).toEqual({ batchItemFailures: [] });
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.start).toHaveBeenCalledWith(payload);
  });
  it("failed read-only setup is attempted once per batch and may retry on a later invocation", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockRejectedValueOnce(Error("synthetic secret detail"));
    const event = batch();
    event.Records.push({ ...event.record, messageId: "synthetic-2" });
    expect((await f.handler(event, { invokedFunctionArn: target })).batchItemFailures).toHaveLength(
      2,
    );
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(await f.handler(batch(), { invokedFunctionArn: target })).toEqual({
      batchItemFailures: [],
    });
    expect(f.resolveDatabaseUrl).toHaveBeenCalledTimes(2);
  });
  it("leaves only the failed record retryable and never retries its effect internally", async () => {
    const f = fixture();
    f.start.mockRejectedValueOnce(Error("synthetic SQL detail"));
    const event = batch();
    event.Records.push({ ...event.record, messageId: "synthetic-2" });
    expect(await f.handler(event, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
  it("withdrawal during setup creates no runtime", async () => {
    const f = fixture();
    f.resolveDatabaseUrl.mockImplementation(async () => {
      f.env.APPLICATION_PREPARATION_STARTER_ENABLED = "false";
      return "postgres://synthetic.invalid/preparation";
    });
    expect(await f.handler(batch(), { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.createRuntime).not.toHaveBeenCalled();
  });
  it.each([
    "DATABASE_SECRET_ID",
    "APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN",
    "APPLICATION_PREPARATION_QUEUE_ARN",
    "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS",
  ])("refuses warm %s drift without recomposition", async (key) => {
    const f = fixture();
    await f.handler(batch(), { invokedFunctionArn: target });
    f.env[key] =
      key === "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS"
        ? JSON.stringify([durable, durable.replace(":7", ":6")])
        : `${f.env[key]}changed`;
    expect(await f.handler(batch(), { invokedFunctionArn: target })).toEqual(unavailable);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.createRuntime).toHaveBeenCalledTimes(1);
  });
});
