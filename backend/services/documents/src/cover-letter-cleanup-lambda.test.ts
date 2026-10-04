import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverLetterCleanupLambda, handler } from "./cover-letter-cleanup-lambda.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

const reference: CoverLetterWorkReference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "private_slots",
  requestSha256: "a".repeat(64),
};
const input = {
  schemaVersion: 1 as const,
  action: "fence" as const,
  documentId: reference.documentId,
  reference,
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-cleanup:3";
const secretId = "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF";
const unavailable = { ...input, outcome: "unavailable" };

function setup() {
  const env: Record<string, string | undefined> = {
    COVER_LETTER_CLEANUP_CONTROL_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-cleanup",
    AWS_LAMBDA_FUNCTION_VERSION: "3",
    DATABASE_SECRET_ID: secretId,
    AWS_SESSION_TOKEN: "synthetic-session-token",
  };
  const fence = vi.fn(
    async (_reference: CoverLetterWorkReference): Promise<"pending" | "ledger_terminal"> =>
      "pending",
  );
  const resolve = vi.fn(async () => "postgres://synthetic:local_only@localhost/synthetic");
  const createWork = vi.fn((_url: string, enabled: () => boolean) => {
    expect(enabled()).toBe(true);
    return { fenceForCleanup: fence };
  });
  const run = createCoverLetterCleanupLambda({
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createWork,
  });
  return {
    env,
    fence,
    resolve,
    createWork,
    run,
    call: () => run(input, { invokedFunctionArn: target }),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("source-only private maintenance-fence Lambda bootstrap", () => {
  it("exports a default-off lazy entrypoint", async () => {
    vi.stubEnv("COVER_LETTER_CLEANUP_CONTROL_ENABLED", undefined);
    expect(await handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
  });
  it.each([undefined, "false", "TRUE", "1", " true"])(
    "requires its own exact gate %s",
    async (flag) => {
      const f = setup();
      f.env.COVER_LETTER_CLEANUP_CONTROL_ENABLED = flag;
      f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = "true";
      f.env.COVER_LETTER_RESPONSE_CAPTURE_ENABLED = "true";
      expect(await f.call()).toEqual(unavailable);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.createWork).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "$LATEST", "alias", "0", "03"])(
    "rejects version %s before I/O",
    async (version) => {
      const f = setup();
      f.env.AWS_LAMBDA_FUNCTION_VERSION = version;
      expect(await f.call()).toEqual(unavailable);
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    target.replace(":3", ":4"),
    target.replace("123456789012", "123456789013"),
    target.replace("us-east-2", "us-east-1"),
  ])("rejects foreign invoked target %s", async (invokedFunctionArn) => {
    const f = setup();
    expect(await f.run(input, { invokedFunctionArn })).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each([
    "synthetic-database",
    secretId.replace("123456789012", "123456789013"),
    secretId.replace("us-east-2", "us-east-1"),
  ])("rejects unqualified/foreign secret %s", async (secret) => {
    const f = setup();
    f.env.DATABASE_SECRET_ID = secret;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("rejects embedded credentials and absent runtime session", async () => {
    const f = setup();
    f.env.DATABASE_URL = "postgres://synthetic:local_only@localhost/synthetic";
    expect(await f.call()).toEqual(unavailable);
    delete f.env.DATABASE_URL;
    delete f.env.AWS_SESSION_TOKEN;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("rejects unknown fields and throwing reflection before I/O", async () => {
    const f = setup();
    await expect(
      f.run({ ...input, content: "synthetic-private-value" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("CoverLetterCleanupUnavailable");
    const broken = new Proxy(input, {
      ownKeys: () => {
        throw Error("SyntheticPrivateReflection");
      },
    });
    await expect(f.run(broken, { invokedFunctionArn: target })).rejects.toThrow(
      "CoverLetterCleanupUnavailable",
    );
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each(["pending", "ledger_terminal"] as const)(
    "returns only original %s outcome",
    async (outcome) => {
      const f = setup();
      f.fence.mockResolvedValueOnce(outcome);
      expect(await f.call()).toEqual({ ...input, outcome });
      expect(f.fence).toHaveBeenCalledWith(reference);
      expect(f.resolve).toHaveBeenCalledWith(
        { DATABASE_SECRET_ID: secretId },
        {
          sessionToken: "synthetic-session-token",
          requestTimeoutMilliseconds: 3000,
          retryDelaysMilliseconds: [],
        },
      );
    },
  );
  it("snapshots binding before awaited secret initialization", async () => {
    const f = setup();
    const mutable = structuredClone(input);
    f.resolve.mockImplementation(async () => {
      mutable.reference.id = reference.documentId;
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    expect(await f.run(mutable, { invokedFunctionArn: target })).toEqual({
      ...input,
      outcome: "pending",
    });
    expect(f.fence).toHaveBeenCalledWith(reference);
  });
  it("single-flights setup without retrying the eight original effects", async () => {
    const f = setup();
    await Promise.all(Array.from({ length: 8 }, () => f.call()));
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.createWork).toHaveBeenCalledOnce();
    expect(f.fence).toHaveBeenCalledTimes(8);
  });
  it("refuses pool creation after activation withdrawal during secret retrieval", async () => {
    const f = setup();
    f.resolve.mockImplementation(async () => {
      f.env.COVER_LETTER_CLEANUP_CONTROL_ENABLED = "false";
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    expect(await f.call()).toEqual(unavailable);
    expect(f.createWork).not.toHaveBeenCalled();
  });
  it("may retry failed read-only setup later, never a lost fence ACK", async () => {
    const f = setup();
    f.resolve.mockRejectedValueOnce(Error("SyntheticPrivateSecretDiagnostic"));
    expect(await f.call()).toEqual(unavailable);
    f.fence.mockRejectedValueOnce(Error("SyntheticLostFenceAck"));
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.fence).toHaveBeenCalledOnce();
  });
  it("cannot rebind a warm runtime to another valid secret", async () => {
    const f = setup();
    await f.call();
    f.env.DATABASE_SECRET_ID = secretId.replace("synthetic-database", "synthetic-other");
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.fence).toHaveBeenCalledOnce();
  });
  it("does not certify terminal work if activation is withdrawn during original fence", async () => {
    const f = setup();
    f.fence.mockImplementation(async () => {
      f.env.COVER_LETTER_CLEANUP_CONTROL_ENABLED = "false";
      return "ledger_terminal";
    });
    expect(await f.call()).toEqual(unavailable);
    expect(f.fence).toHaveBeenCalledOnce();
  });
});
