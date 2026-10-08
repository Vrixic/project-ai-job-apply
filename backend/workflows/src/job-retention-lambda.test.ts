import { expect, it, vi } from "vitest";
import { createJobRetentionLambda } from "./job-retention-lambda.js";

const counts = { reportsExpired: 2, casesExpired: 1, eventsExpired: 2, controlsExpired: 1 };
const target = "arn:aws:lambda:us-east-2:123456789012:function:audit-retention:9";
const request = { schemaVersion: 1, action: "expire" };
const context = { invokedFunctionArn: target };
function fixture() {
  const env: Record<string, string | undefined> = {
    JOB_RETENTION_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "audit-retention",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    AWS_SESSION_TOKEN: "synthetic-session",
    DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-audit-db",
    JOB_RETENTION_BATCH_LIMIT: "3",
  };
  const resolve = vi.fn(
    async (_config: { DATABASE_SECRET_ID?: string | undefined }) =>
      "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  );
  const expire = vi.fn(async (_limit: number) => ({ ...counts }));
  const close = vi.fn(async () => undefined);
  const createRuntime = vi.fn((_url: string, _enabled: () => boolean) => ({ expire, close }));
  const run = createJobRetentionLambda({
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createRuntime,
  });
  return { env, resolve, expire, close, createRuntime, run };
}
it("uses the pinned managed secret, bounded expiry-only runtime and counts-only output", async () => {
  const f = fixture();
  expect(await f.run(request, context)).toEqual({
    schemaVersion: 1,
    owner: "jobs",
    ...counts,
  });
  expect(f.resolve.mock.calls[0]?.[0]).toEqual({ DATABASE_SECRET_ID: f.env.DATABASE_SECRET_ID });
  expect(f.expire).toHaveBeenCalledWith(3);
  expect(f.createRuntime.mock.calls[0]?.[1]()).toBe(true);
  expect(f.close).toHaveBeenCalledTimes(1);
});
it.each([
  ["JOB_RETENTION_ENABLED", "false"],
  ["AWS_REGION", "us-east-1"],
  ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
  ["AWS_SESSION_TOKEN", undefined],
  ["DATABASE_URL", "postgres://synthetic"],
  ["DATABASE_SECRET_ID", "arn:aws:secretsmanager:us-east-2:999999999999:secret:foreign"],
  ["JOB_RETENTION_BATCH_LIMIT", "1001"],
  ["JOB_RETENTION_BATCH_LIMIT", "03"],
] as const)("refuses invalid %s before secret or SQL access", async (key, value) => {
  const f = fixture();
  f.env[key] = value;
  await expect(f.run(request, context)).rejects.toThrow("JobRetentionUnavailable");
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.createRuntime).not.toHaveBeenCalled();
});
it("refuses extra data, accessors and wrong recipient without invoking their getters", async () => {
  const f = fixture(),
    getter = vi.fn(() => "expire");
  for (const input of [
    { ...request, operatorId: "synthetic-forbidden" },
    Object.defineProperty({ ...request }, "action", { enumerable: true, get: getter }),
    null,
  ])
    await expect(f.run(input, context)).rejects.toThrow();
  await expect(f.run(request, { invokedFunctionArn: `${target}0` })).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(f.resolve).not.toHaveBeenCalled();
});
it("refuses warm retargeting while allowing session credential rotation", async () => {
  const f = fixture();
  await f.run(request, context);
  f.env.AWS_SESSION_TOKEN = "synthetic-rotated";
  await f.run(request, context);
  f.env.JOB_RETENTION_BATCH_LIMIT = "4";
  await expect(f.run(request, context)).rejects.toThrow();
  expect(f.resolve).toHaveBeenCalledTimes(2);
});
it("withdrawal during secret lookup cannot create a runtime", async () => {
  const f = fixture();
  f.resolve.mockImplementationOnce(async () => {
    f.env.JOB_RETENTION_ENABLED = "false";
    return "postgres://synthetic";
  });
  await expect(f.run(request, context)).rejects.toThrow();
  expect(f.createRuntime).not.toHaveBeenCalled();
});
it("closes the runtime on SQL failure and hides raw errors", async () => {
  const f = fixture();
  f.expire.mockRejectedValueOnce(Error("synthetic-credential-bearing-error"));
  await expect(f.run(request, context)).rejects.toThrow(/^JobRetentionUnavailable$/);
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(await f.run(request, context)).toMatchObject(counts);
});
it.each([-1, 4, 1.5, NaN])("refuses invalid owner count %s and still closes", async (count) => {
  const f = fixture();
  f.expire.mockResolvedValueOnce({ ...counts, reportsExpired: count });
  await expect(f.run(request, context)).rejects.toThrow();
  expect(f.close).toHaveBeenCalledTimes(1);
});
it("refuses withdrawal during expiry or close without claiming counts", async () => {
  for (const stage of ["expire", "close"] as const) {
    const f = fixture();
    if (stage === "expire")
      f.expire.mockImplementationOnce(async () => {
        f.env.JOB_RETENTION_ENABLED = "false";
        return { ...counts };
      });
    else
      f.close.mockImplementationOnce(async () => {
        f.env.JOB_RETENTION_ENABLED = "false";
      });
    await expect(f.run(request, context)).rejects.toThrow();
    expect(f.close).toHaveBeenCalledTimes(1);
  }
});
it("rejects overlapping invocations without releasing the original admission guard", async () => {
  const f = fixture();
  let release!: (count: typeof counts) => void;
  f.expire.mockImplementationOnce(
    () =>
      new Promise<typeof counts>((resolve) => {
        release = resolve;
      }),
  );
  const original = f.run(request, context);
  await vi.waitFor(() => expect(f.expire).toHaveBeenCalledTimes(1));
  await expect(f.run(request, context)).rejects.toThrow();
  await expect(f.run(request, context)).rejects.toThrow();
  release({ ...counts });
  await expect(original).resolves.toMatchObject(counts);
  await f.run(request, context);
  expect(f.close).toHaveBeenCalledTimes(2);
});

it("rejects extra owner data and accessors without evaluating them", async () => {
  const getter = vi.fn(() => 2);
  for (const value of [
    { ...counts, rawReport: "synthetic-forbidden" },
    Object.defineProperty({ ...counts }, "eventsExpired", { enumerable: true, get: getter }),
  ]) {
    const f = fixture();
    f.expire.mockResolvedValueOnce(value);
    await expect(f.run(request, context)).rejects.toThrow("JobRetentionUnavailable");
    expect(f.close).toHaveBeenCalledTimes(1);
  }
  expect(getter).not.toHaveBeenCalled();
});
it("snapshots validated counts before close and enforces the two-events-per-case bound", async () => {
  const f = fixture();
  const returned = { ...counts, eventsExpired: 6 };
  f.expire.mockResolvedValueOnce(returned);
  f.close.mockImplementationOnce(async () => {
    returned.eventsExpired = 999;
  });
  expect(await f.run(request, context)).toMatchObject({ eventsExpired: 6 });
  f.expire.mockResolvedValueOnce({ ...counts, eventsExpired: 7 });
  await expect(f.run(request, context)).rejects.toThrow("JobRetentionUnavailable");
});
