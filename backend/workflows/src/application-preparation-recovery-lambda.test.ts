import { describe, expect, it, vi } from "vitest";
import { createApplicationPreparationRecoveryLambda } from "./application-preparation-recovery-lambda.js";

const now = new Date("2026-10-04T12:00:00Z");
const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-recovery:9";
const durable = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:7";
const older = durable.replace(":7", ":6");
const rule = "arn:aws:events:us-east-2:123456789012:rule/synthetic-recovery";
const queue = "https://sqs.us-east-2.amazonaws.com/123456789012/synthetic-preparation";
const id = "019d04cf-1f80-7000-8000-00000000000a";
function environment(
  mode: "terminal" | "reconcile" = "terminal",
): Record<string, string | undefined> {
  return {
    APPLICATION_PREPARATION_RECOVERY_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-recovery",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic-token",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
    APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN: durable,
    ...(mode === "reconcile"
      ? {
          APPLICATION_PREPARATION_RECOVERY_RULE_ARN: rule,
          APPLICATION_PREPARATION_QUEUE_URL: queue,
        }
      : {}),
  };
}
function event(mode: "terminal" | "reconcile" = "terminal", version = durable) {
  return {
    version: "0",
    id,
    "detail-type": mode === "terminal" ? "Durable Execution Status Change" : "Scheduled Event",
    source: mode === "terminal" ? "aws.lambda" : "aws.events",
    account: "123456789012",
    time: now.toISOString(),
    region: "us-east-2",
    resources: mode === "terminal" ? [] : [rule],
    detail:
      mode === "terminal"
        ? {
            durableExecutionArn: `${version}/durable-execution/preparation-${id}/synthetic-execution`,
            durableExecutionName: `preparation-${id}`,
            functionArn: version,
            status: "FAILED",
            startTimestamp: new Date(now.getTime() - 1000).toISOString(),
            endTimestamp: now.toISOString(),
          }
        : {},
  };
}
function fixture(mode: "terminal" | "reconcile" = "terminal") {
  const env = environment(mode);
  const resolve = vi.fn().mockResolvedValue("postgres://synthetic");
  const run = vi.fn<(value: unknown) => Promise<unknown>>().mockResolvedValue({ handled: true });
  const create = vi.fn<
    NonNullable<
      Parameters<typeof createApplicationPreparationRecoveryLambda>[1]
    >["createRuntime"] & {}
  >((_url, _config, _mode, enabled, nudges) => ({
    run: async (value) => {
      expect(enabled()).toBe(true);
      return run({ value, nudges: nudges() });
    },
    close: async () => {},
  }));
  const handler = createApplicationPreparationRecoveryLambda(mode, {
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createRuntime: create,
    clock: () => now,
  });
  return { env, resolve, run, create, handler };
}
describe("native preparation terminal and scheduled recovery", () => {
  it.each([
    ["APPLICATION_PREPARATION_RECOVERY_ENABLED", undefined],
    ["APPLICATION_PREPARATION_RECOVERY_ENABLED", "TRUE"],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "invalid"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "01"],
    ["AWS_SESSION_TOKEN", undefined],
    ["DATABASE_URL", ""],
    ["CANDIDATE_DOCUMENT_BUCKET", ""],
    ["OPENAI_API_KEY", ""],
    ["DATABASE_SECRET_ID", "arn:aws:secretsmanager:us-east-2:999999999999:secret:foreign"],
    ["APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN", target],
    ["APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN", durable.replace(":7", ":alias")],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", "[]"],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", JSON.stringify([older])],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", JSON.stringify([durable, durable])],
    ["APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS", JSON.stringify([durable, target])],
    ["APPLICATION_PREPARATION_QUEUE_URL", queue],
    ["APPLICATION_PREPARATION_RECOVERY_RULE_ARN", rule],
    ["APPLICATION_PREPARATION_NUDGES_ENABLED", "true"],
  ])("refuses terminal configuration %s before setup", async (key, value) => {
    const f = fixture();
    f.env[key as string] = value;
    await expect(f.handler(event(), { invokedFunctionArn: target })).rejects.toThrow(
      "ApplicationPreparationRecoveryUnavailable",
    );
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["APPLICATION_PREPARATION_RECOVERY_RULE_ARN", "APPLICATION_PREPARATION_QUEUE_URL"])(
    "refuses missing scheduled configuration %s",
    async (key) => {
      const f = fixture("reconcile");
      delete f.env[key];
      await expect(f.handler(event("reconcile"), { invokedFunctionArn: target })).rejects.toThrow(
        "ApplicationPreparationRecoveryUnavailable",
      );
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it.each(["terminal", "reconcile"] as const)(
    "validates %s envelope before managed-secret setup",
    async (mode) => {
      const f = fixture(mode);
      const value = { ...event(mode), candidateText: "synthetic-injected" };
      await expect(f.handler(value, { invokedFunctionArn: target })).rejects.toThrow(
        "ApplicationPreparationRecoveryInputRejected",
      );
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it("refuses an unretained terminal version before setup", async () => {
    const f = fixture();
    await expect(
      f.handler(event("terminal", older), { invokedFunctionArn: target }),
    ).rejects.toThrow("ApplicationPreparationRecoveryInputRejected");
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each(["terminal", "reconcile"] as const)(
    "refuses foreign numeric invoked %s target",
    async (mode) => {
      const f = fixture(mode);
      await expect(
        f.handler(event(mode), { invokedFunctionArn: target.replace(":9", ":8") }),
      ).rejects.toThrow("ApplicationPreparationRecoveryUnavailable");
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it("single-flights setup, detaches input and leaves nudges off", async () => {
    const f = fixture("reconcile");
    let finish: (url: string) => void = () => {};
    f.resolve.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const value = event("reconcile");
    const first = f.handler(value, { invokedFunctionArn: target });
    const second = f.handler(event("reconcile"), { invokedFunctionArn: target });
    value.resources[0] = "foreign";
    finish("postgres://synthetic");
    await Promise.all([first, second]);
    expect(f.resolve).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls[0]?.[0]).toEqual({ value: event("reconcile"), nudges: false });
    expect(f.resolve.mock.calls[0]?.[1]).toMatchObject({
      requestTimeoutMilliseconds: 3000,
      retryDelaysMilliseconds: [],
    });
  });
  it("retries read-only setup on a later call without retrying effects", async () => {
    const f = fixture();
    f.resolve.mockRejectedValueOnce(Error("synthetic-secret-failed"));
    await expect(f.handler(event(), { invokedFunctionArn: target })).rejects.toThrow(
      "ApplicationPreparationRecoveryUnavailable",
    );
    await f.handler(event(), { invokedFunctionArn: target });
    expect(f.resolve).toHaveBeenCalledTimes(2);
    f.run.mockRejectedValueOnce(Error("synthetic-effect-failed"));
    await expect(f.handler(event(), { invokedFunctionArn: target })).rejects.toThrow(
      "synthetic-effect-failed",
    );
    expect(f.run).toHaveBeenCalledTimes(2);
  });
  it("withdraws nudges while retaining scheduled recovery", async () => {
    const f = fixture("reconcile");
    f.env.APPLICATION_PREPARATION_NUDGES_ENABLED = "true";
    await f.handler(event("reconcile"), { invokedFunctionArn: target });
    delete f.env.APPLICATION_PREPARATION_NUDGES_ENABLED;
    await f.handler(event("reconcile"), { invokedFunctionArn: target });
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls.map((call) => call[0])).toEqual([
      { value: event("reconcile"), nudges: true },
      { value: event("reconcile"), nudges: false },
    ]);
  });
  it.each([
    "DATABASE_SECRET_ID",
    "APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN",
    "APPLICATION_PREPARATION_QUEUE_URL",
    "APPLICATION_PREPARATION_RECOVERY_RULE_ARN",
    "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS",
  ])("pins warm configuration %s", async (key) => {
    const f = fixture("reconcile");
    await f.handler(event("reconcile"), { invokedFunctionArn: target });
    f.env[key] =
      key === "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS"
        ? JSON.stringify([durable, older])
        : `${f.env[key]}changed`;
    await expect(f.handler(event("reconcile"), { invokedFunctionArn: target })).rejects.toThrow(
      "ApplicationPreparationRecoveryUnavailable",
    );
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.run).toHaveBeenCalledTimes(1);
  });
  it("withdrawal during managed-secret setup refuses runtime creation", async () => {
    const f = fixture();
    f.resolve.mockImplementation(async () => {
      delete f.env.APPLICATION_PREPARATION_RECOVERY_ENABLED;
      return "postgres://synthetic";
    });
    await expect(f.handler(event(), { invokedFunctionArn: target })).rejects.toThrow(
      "ApplicationPreparationRecoveryUnavailable",
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["stale", "foreign_rule", "text_detail", "accessor"])(
    "refuses scheduled %s before setup",
    async (fault) => {
      const f = fixture("reconcile");
      const value = event("reconcile");
      if (fault === "stale") value.time = new Date(now.getTime() - 300001).toISOString();
      if (fault === "foreign_rule") value.resources[0] = `${rule}-foreign`;
      if (fault === "text_detail") value.detail = { text: "synthetic" } as typeof value.detail;
      if (fault === "accessor")
        Object.defineProperty(value, "time", { enumerable: true, get: () => now.toISOString() });
      await expect(f.handler(value, { invokedFunctionArn: target })).rejects.toThrow(
        "ApplicationPreparationRecoveryInputRejected",
      );
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
});
