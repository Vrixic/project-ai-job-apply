import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoverLetterProviderControlLambda,
  handler,
} from "./cover-letter-provider-control-lambda.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

const documentId = "019a4000-0000-7000-8000-000000000001";
const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId,
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const input = {
  schemaVersion: 1 as const,
  action: "claim" as const,
  documentId,
  requestSha256: reference.requestSha256,
  consentExpiresAt: "2026-10-03T23:00:00.000Z",
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:3";
const secretId = "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF";
const unavailable = { schemaVersion: 1, action: "claim", documentId, outcome: "unavailable" };

function setup() {
  const env: Record<string, string | undefined> = {
    COVER_LETTER_PROVIDER_CONTROL_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-control",
    AWS_LAMBDA_FUNCTION_VERSION: "3",
    DATABASE_SECRET_ID: secretId,
    AWS_SESSION_TOKEN: "synthetic-session-token",
  };
  const work = {
    claimProviderDispatch: vi.fn<PostgresCoverLetterWorkStore["claimProviderDispatch"]>(
      async () => ({ kind: "claimed", reference: structuredClone(reference) }),
    ),
    settleProviderDispatch: vi.fn<PostgresCoverLetterWorkStore["settleProviderDispatch"]>(
      async () => undefined,
    ),
    settleRejectedProviderDispatch: vi.fn<
      PostgresCoverLetterWorkStore["settleRejectedProviderDispatch"]
    >(async () => undefined),
    settleUndispatchedProviderDispatch: vi.fn<
      PostgresCoverLetterWorkStore["settleUndispatchedProviderDispatch"]
    >(async () => undefined),
  };
  const resolve = vi.fn(
    async () => "postgres://synthetic:local_only@127.0.0.1:64256/work_ledger_bootstrap",
  );
  const createWork = vi.fn((_url: string, enabled: () => boolean) => {
    expect(enabled()).toBe(true);
    return work;
  });
  const run = createCoverLetterProviderControlLambda({
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createWork,
  });
  return {
    env,
    work,
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

describe("terminal settlement bootstrap compatibility", () => {
  const terminal = {
    schemaVersion: 1 as const,
    documentId,
    reference,
    action: "settle_terminal" as const,
    termination: {
      kind: "terminal_no_content" as const,
      reference: { schemaVersion: 1 as const, responseId: "resp_original1", createdAt: 1791028800 },
      terminalStatus: "failed" as const,
    },
  };
  it("default-off terminal request refuses before managed secret", async () => {
    const f = setup();
    f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = "false";
    await expect(f.run(terminal, { invokedFunctionArn: target })).resolves.toEqual({
      ...terminal,
      outcome: "unavailable",
    });
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("legacy composed work refuses without ordinary settlement", async () => {
    const f = setup();
    await expect(f.run(terminal, { invokedFunctionArn: target })).resolves.toMatchObject({
      outcome: "unavailable",
      action: "settle_terminal",
    });
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
  });
  it("qualified bootstrap routes explicit terminal port and echoes original receipt", async () => {
    const f = setup();
    const settleTerminalProviderDispatch = vi.fn(async () => undefined);
    f.createWork.mockReturnValue({ ...f.work, settleTerminalProviderDispatch } as ReturnType<
      typeof f.createWork
    >);
    await expect(f.run(terminal, { invokedFunctionArn: target })).resolves.toEqual({
      ...terminal,
      outcome: "settled",
    });
    expect(settleTerminalProviderDispatch).toHaveBeenCalledWith(reference, terminal.termination);
    expect(f.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("source-only private provider-control Lambda bootstrap", () => {
  it("composes the production one-connection pool and real ledger without a fake work factory", async () => {
    const f = setup();
    const client = vi.fn(async (_parts: TemplateStringsArray, ..._values: unknown[]) => []);
    const database = vi.fn(
      (_url: string, _options: { max: 1; idle_timeout: 20; connect_timeout: 10 }) =>
        client as unknown as postgres.Sql,
    );
    const actual = createCoverLetterProviderControlLambda({
      environment: () => f.env,
      resolveDatabaseUrl: f.resolve,
      createPool: database,
    });
    expect(await actual(input, { invokedFunctionArn: target })).toEqual(unavailable);
    expect(database).toHaveBeenCalledWith(expect.stringMatching(/^postgres:/u), {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[0]?.[0].join("")).toBe("");
    expect(client.mock.calls[1]?.[0].join("")).toContain("SELECT id, document_id");
    expect(f.createWork).not.toHaveBeenCalled();
  });
  it("exports a default-off lazy handler", async () => {
    vi.stubEnv("COVER_LETTER_PROVIDER_CONTROL_ENABLED", undefined);
    expect(await handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
  });
  it.each([undefined, "false", "TRUE", "1", " true"])(
    "refuses gate %s before secret or SQL I/O",
    async (flag) => {
      const f = setup();
      f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = flag;
      expect(await f.call()).toEqual(unavailable);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.createWork).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "$LATEST", "latest", "alias", "0", "03"])(
    "refuses nonnumeric version %s before I/O",
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
  ])("refuses another invoked target %s before I/O", async (invokedFunctionArn) => {
    const f = setup();
    expect(await f.run(input, { invokedFunctionArn })).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each([
    "synthetic-database",
    secretId.replace("123456789012", "123456789013"),
    secretId.replace("us-east-2", "us-east-1"),
    `${secretId}\n`,
  ])("refuses unqualified or foreign secret %s before I/O", async (secret) => {
    const f = setup();
    f.env.DATABASE_SECRET_ID = secret;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("refuses an embedded database URL and missing session context", async () => {
    const f = setup();
    f.env.DATABASE_URL = "postgres://synthetic:local_only@localhost/synthetic";
    expect(await f.call()).toEqual(unavailable);
    delete f.env.DATABASE_URL;
    delete f.env.AWS_SESSION_TOKEN;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("validates input before bootstrap and never reflects unknown fields", async () => {
    const f = setup();
    await expect(
      f.run({ ...input, text: "synthetic-private-value" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("CoverLetterProviderControlUnavailable");
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("snapshots identifiers before awaited initialization and resolves only a managed secret", async () => {
    const f = setup();
    const mutable = structuredClone(input);
    f.resolve.mockImplementation(async () => {
      mutable.documentId = reference.id;
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    const result = await f.run(mutable, { invokedFunctionArn: target });
    expect(result).toEqual({ ...unavailable, outcome: "claimed", reference });
    expect(f.resolve).toHaveBeenCalledWith(
      { DATABASE_SECRET_ID: secretId },
      {
        sessionToken: "synthetic-session-token",
        requestTimeoutMilliseconds: 3000,
        retryDelaysMilliseconds: [],
      },
    );
    expect(f.work.claimProviderDispatch).toHaveBeenCalledWith({
      documentId,
      requestSha256: reference.requestSha256,
      consentExpiresAt: new Date(input.consentExpiresAt),
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-session-token");
  });
  it("single-flights concurrent bootstrap without retrying effect calls", async () => {
    const f = setup();
    await Promise.all(Array.from({ length: 8 }, () => f.call()));
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.createWork).toHaveBeenCalledOnce();
    expect(f.work.claimProviderDispatch).toHaveBeenCalledTimes(8);
    expect(await f.call()).toMatchObject({ outcome: "claimed" });
    expect(f.resolve).toHaveBeenCalledOnce();
  });
  it("does not create a SQL pool when activation is withdrawn during secret retrieval", async () => {
    const f = setup();
    f.resolve.mockImplementation(async () => {
      f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = "false";
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    expect(await f.call()).toEqual(unavailable);
    expect(f.createWork).not.toHaveBeenCalled();
  });
  it("fails closed on secret retrieval errors, then retries read-only initialization on a later invocation", async () => {
    const f = setup();
    f.resolve.mockRejectedValueOnce(Error("SyntheticPrivateSecretDiagnostic"));
    expect(await f.call()).toEqual(unavailable);
    expect(f.createWork).not.toHaveBeenCalled();
    expect(await f.call()).toMatchObject({ outcome: "claimed" });
    expect(f.resolve).toHaveBeenCalledTimes(2);
  });
  it.each([
    "AWS_REGION",
    "PLATFORM_AWS_ACCOUNT_ID",
    "AWS_LAMBDA_FUNCTION_NAME",
    "AWS_LAMBDA_FUNCTION_VERSION",
    "DATABASE_SECRET_ID",
  ] as const)("pins %s across warm calls without rebinding secret or work", async (field) => {
    const f = setup();
    expect(await f.call()).toMatchObject({ outcome: "claimed" });
    f.env[field] = "synthetic-changed";
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
  });
  it("does not retry a lost original control acknowledgement", async () => {
    const f = setup();
    f.work.claimProviderDispatch.mockRejectedValueOnce(Error("SyntheticLostControlAck"));
    expect(await f.call()).toEqual(unavailable);
    expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(f.resolve).toHaveBeenCalledOnce();
  });
  it.each(["name", "version", "secret"] as const)(
    "does not rebind a warm runtime to a different valid %s",
    async (field) => {
      const f = setup();
      expect(await f.call()).toMatchObject({ outcome: "claimed" });
      if (field === "name") f.env.AWS_LAMBDA_FUNCTION_NAME = "synthetic-control-two";
      if (field === "version") f.env.AWS_LAMBDA_FUNCTION_VERSION = "4";
      if (field === "secret")
        f.env.DATABASE_SECRET_ID = secretId.replace("synthetic-database", "synthetic-other");
      const invokedFunctionArn = `arn:aws:lambda:us-east-2:123456789012:function:${f.env.AWS_LAMBDA_FUNCTION_NAME}:${f.env.AWS_LAMBDA_FUNCTION_VERSION}`;
      expect(await f.run(input, { invokedFunctionArn })).toEqual(unavailable);
      expect(f.resolve).toHaveBeenCalledOnce();
      expect(f.createWork).toHaveBeenCalledOnce();
      expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
    },
  );
  it("does not acknowledge a claim after activation is withdrawn during the original control", async () => {
    const f = setup();
    f.work.claimProviderDispatch.mockImplementation(async () => {
      f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = "false";
      return { kind: "claimed", reference: structuredClone(reference) };
    });
    expect(await f.call()).toEqual(unavailable);
    expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
  });
  it.each(["settle", "settle_rejected", "settle_undispatched"] as const)(
    "routes existing %s only to its original fixed ledger control",
    async (action) => {
      const f = setup();
      const result = await f.run(
        { schemaVersion: 1, action, documentId, reference },
        { invokedFunctionArn: target },
      );
      expect(result).toEqual({
        schemaVersion: 1,
        action,
        documentId,
        outcome: "settled",
        reference,
      });
      expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleProviderDispatch).toHaveBeenCalledTimes(action === "settle" ? 1 : 0);
      expect(f.work.settleRejectedProviderDispatch).toHaveBeenCalledTimes(
        action === "settle_rejected" ? 1 : 0,
      );
      expect(f.work.settleUndispatchedProviderDispatch).toHaveBeenCalledTimes(
        action === "settle_undispatched" ? 1 : 0,
      );
    },
  );
});
