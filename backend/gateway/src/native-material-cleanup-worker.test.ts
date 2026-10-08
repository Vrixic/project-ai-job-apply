import { expect, it, vi } from "vitest";
import { createNativeMaterialCleanupWorker } from "./native-material-cleanup-worker.js";

const environment = () => ({
  NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED: "true",
  NATIVE_APPLICATION_DISPOSAL_ENABLED: "true",
  AWS_REGION: "us-east-2",
  PLATFORM_AWS_ACCOUNT_ID: "123456789012",
  AWS_LAMBDA_FUNCTION_NAME: "synthetic-cleanup",
  AWS_LAMBDA_FUNCTION_VERSION: "7",
  AWS_SESSION_TOKEN: "synthetic-session",
  DATABASE_SECRET_ID: "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db",
});
const context = {
  invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-cleanup:7",
};
it("runs one private scheduled lease and closes its database runtime", async () => {
  const run = vi.fn(async () => ({ state: "pending" as const })),
    close = vi.fn(async () => {});
  const resolve = vi.fn(async () => "postgres://synthetic");
  const handler = createNativeMaterialCleanupWorker({
    environment,
    resolveDatabaseUrl: resolve,
    createRuntime: () => ({ runOwnerCleanup: run, close }),
  });
  expect(await handler({ schemaVersion: 1, action: "drain" }, context)).toEqual({
    state: "pending",
  });
  expect(run).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("rejects disabled, unversioned and caller-supplied owner work before secrets", async () => {
  const resolve = vi.fn(async () => "postgres://synthetic");
  for (const [env, event, arn] of [
    [
      { ...environment(), NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED: "false" },
      { schemaVersion: 1, action: "drain" },
      context.invokedFunctionArn,
    ],
    [
      environment(),
      { schemaVersion: 1, action: "drain" },
      context.invokedFunctionArn.replace(":7", ":$LATEST"),
    ],
    [
      environment(),
      { schemaVersion: 1, action: "drain", owner: "foreign" },
      context.invokedFunctionArn,
    ],
  ] as const)
    await expect(
      createNativeMaterialCleanupWorker({ environment: () => env, resolveDatabaseUrl: resolve })(
        event,
        { invokedFunctionArn: arn },
      ),
    ).rejects.toThrow("NativeMaterialCleanupWorkerUnavailable");
  expect(resolve).not.toHaveBeenCalled();
});
it("sanitizes worker and close failures", async () => {
  const close = vi.fn(async () => {
    throw Error("synthetic-private-close");
  });
  const handler = createNativeMaterialCleanupWorker({
    environment,
    resolveDatabaseUrl: async () => "postgres://synthetic",
    createRuntime: () => ({
      runOwnerCleanup: async () => {
        throw Error("synthetic-private-task");
      },
      close,
    }),
  });
  await expect(handler({ schemaVersion: 1, action: "drain" }, context)).rejects.toThrow(
    /^NativeMaterialCleanupWorkerUnavailable$/,
  );
  expect(close).toHaveBeenCalledOnce();
});
