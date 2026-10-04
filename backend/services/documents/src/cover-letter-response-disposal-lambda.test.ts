import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoverLetterResponseDisposalLambda,
  handler,
} from "./cover-letter-response-disposal-lambda.js";

const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const input = { schemaVersion: 1 as const, action: "read" as const, reference };
const response = {
  schemaVersion: 1 as const,
  responseId: "resp_syntheticOriginal",
  createdAt: 1791064800,
};
const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-disposal:3";
const secretId = "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-database-ABCDEF";
const inventory = { reference, state: "acknowledged" as const, response };
const cleanup = {
  kind: "response_deleted" as const,
  reference: response,
  terminalStatus: "cancelled" as const,
};
const unavailable = { ...input, outcome: "unavailable", inventory: null };

function setup() {
  const env: Record<string, string | undefined> = {
    COVER_LETTER_RESPONSE_DISPOSAL_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-disposal",
    AWS_LAMBDA_FUNCTION_VERSION: "3",
    DATABASE_SECRET_ID: secretId,
    AWS_SESSION_TOKEN: "synthetic-session-token",
  };
  const responses = {
    read: vi.fn(async () => structuredClone(inventory)),
    recordDisposal: vi.fn(async () => undefined),
  };
  const resolve = vi.fn(async () => "postgres://synthetic:local_only@localhost/synthetic");
  const createResponses = vi.fn((_url: string, enabled: () => boolean) => {
    expect(enabled()).toBe(true);
    return responses;
  });
  const run = createCoverLetterResponseDisposalLambda({
    environment: () => env,
    resolveDatabaseUrl: resolve,
    createResponses,
  });
  return {
    env,
    responses,
    resolve,
    createResponses,
    run,
    call: () => run(input, { invokedFunctionArn: target }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("source-only private response-disposal Lambda bootstrap", () => {
  it("exports a default-off lazy handler", async () => {
    vi.stubEnv("COVER_LETTER_RESPONSE_DISPOSAL_ENABLED", undefined);
    expect(await handler(input, { invokedFunctionArn: target })).toEqual(unavailable);
  });
  it.each([undefined, "false", "TRUE", "1", " true"])(
    "refuses gate %s before I/O",
    async (flag) => {
      const f = setup();
      f.env.COVER_LETTER_RESPONSE_DISPOSAL_ENABLED = flag;
      f.env.COVER_LETTER_PROVIDER_CONTROL_ENABLED = "true";
      expect(await f.call()).toEqual(unavailable);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.createResponses).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "$LATEST", "alias", "0", "03"])(
    "refuses version %s before I/O",
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
  ])("refuses a foreign invoked target %s", async (invokedFunctionArn) => {
    const f = setup();
    expect(await f.run(input, { invokedFunctionArn })).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it.each([
    "synthetic-database",
    secretId.replace("123456789012", "123456789013"),
    secretId.replace("us-east-2", "us-east-1"),
    `${secretId}\n`,
  ])("refuses an unqualified/foreign secret %s", async (secret) => {
    const f = setup();
    f.env.DATABASE_SECRET_ID = secret;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("refuses an embedded URL or absent session context", async () => {
    const f = setup();
    f.env.DATABASE_URL = "postgres://synthetic:local_only@localhost/synthetic";
    expect(await f.call()).toEqual(unavailable);
    delete f.env.DATABASE_URL;
    delete f.env.AWS_SESSION_TOKEN;
    expect(await f.call()).toEqual(unavailable);
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("validates the unchanged closed envelope before bootstrap", async () => {
    const f = setup();
    await expect(
      f.run({ ...input, text: "synthetic-private-value" }, { invokedFunctionArn: target }),
    ).rejects.toThrow("CoverLetterResponseDisposalUnavailable");
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it("snapshots original identifiers before one bounded managed-secret read", async () => {
    const f = setup();
    const mutable = structuredClone(input);
    f.resolve.mockImplementation(async () => {
      mutable.reference.documentId = reference.id;
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    expect(await f.run(mutable, { invokedFunctionArn: target })).toEqual({
      ...input,
      outcome: "read",
      inventory,
    });
    expect(f.responses.read).toHaveBeenCalledWith(reference);
    expect(f.resolve).toHaveBeenCalledWith(
      { DATABASE_SECRET_ID: secretId },
      {
        sessionToken: "synthetic-session-token",
        requestTimeoutMilliseconds: 3000,
        retryDelaysMilliseconds: [],
      },
    );
  });
  it("single-flights initialization but never retries original ledger effects", async () => {
    const f = setup();
    await Promise.all(Array.from({ length: 8 }, () => f.call()));
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.createResponses).toHaveBeenCalledOnce();
    expect(f.responses.read).toHaveBeenCalledTimes(8);
  });
  it("does not create a pool after gate withdrawal during secret retrieval", async () => {
    const f = setup();
    f.resolve.mockImplementation(async () => {
      f.env.COVER_LETTER_RESPONSE_DISPOSAL_ENABLED = "false";
      return "postgres://synthetic:local_only@localhost/synthetic";
    });
    expect(await f.call()).toEqual(unavailable);
    expect(f.createResponses).not.toHaveBeenCalled();
  });
  it("retries only failed read-only initialization on a later invocation", async () => {
    const f = setup();
    f.resolve.mockRejectedValueOnce(Error("SyntheticPrivateSecretDiagnostic"));
    expect(await f.call()).toEqual(unavailable);
    expect(f.createResponses).not.toHaveBeenCalled();
    expect(await f.call()).toMatchObject({ outcome: "read" });
    expect(f.resolve).toHaveBeenCalledTimes(2);
  });
  it.each(["name", "version", "secret"] as const)(
    "cannot rebind a valid warm %s",
    async (field) => {
      const f = setup();
      await f.call();
      if (field === "name") f.env.AWS_LAMBDA_FUNCTION_NAME = "synthetic-disposal-two";
      if (field === "version") f.env.AWS_LAMBDA_FUNCTION_VERSION = "4";
      if (field === "secret")
        f.env.DATABASE_SECRET_ID = secretId.replace("synthetic-database", "synthetic-other");
      const invokedFunctionArn = `arn:aws:lambda:us-east-2:123456789012:function:${f.env.AWS_LAMBDA_FUNCTION_NAME}:${f.env.AWS_LAMBDA_FUNCTION_VERSION}`;
      expect(await f.run(input, { invokedFunctionArn })).toEqual(unavailable);
      expect(f.resolve).toHaveBeenCalledOnce();
      expect(f.responses.read).toHaveBeenCalledOnce();
    },
  );
  it("preserves lost inventory-read ACK without disposal or repeat attempt", async () => {
    const f = setup();
    f.responses.read.mockRejectedValueOnce(Error("SyntheticLostReadAck"));
    expect(await f.call()).toEqual(unavailable);
    expect(f.responses.read).toHaveBeenCalledOnce();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("routes original disposal receipt without inventory read or work settlement", async () => {
    const f = setup();
    const disposal = { schemaVersion: 1, action: "record_disposal", reference, cleanup };
    expect(await f.run(disposal, { invokedFunctionArn: target })).toEqual({
      ...disposal,
      outcome: "recorded",
    });
    expect(f.responses.recordDisposal).toHaveBeenCalledWith(reference, cleanup);
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it("does not acknowledge a lost original disposal ACK", async () => {
    const f = setup();
    f.responses.recordDisposal.mockRejectedValueOnce(Error("SyntheticLostDisposalAck"));
    const disposal = { schemaVersion: 1, action: "record_disposal", reference, cleanup };
    expect(await f.run(disposal, { invokedFunctionArn: target })).toEqual({
      ...disposal,
      outcome: "unavailable",
    });
    expect(f.responses.recordDisposal).toHaveBeenCalledOnce();
  });
});
