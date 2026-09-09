import { describe, expect, it, vi } from "vitest";
import type { CandidateDeletionRestoreConfiguration } from "./candidate-deletion-restore-contract.js";
import { resolveRestoredDatabaseUrl } from "./candidate-deletion-restore-database.js";

const configuration = {
  sourceIdentifier: "ai-job-apply-development",
  targetIdentifier: "ai-job-apply-development-restore-20260908200000",
  sourceHostname: "ai-job-apply-development.synthetic.us-east-2.rds.amazonaws.com",
  targetHostname:
    "ai-job-apply-development-restore-20260908200000.synthetic.us-east-2.rds.amazonaws.com",
  databaseName: "ai_job_apply",
  databasePort: 5432,
  accountId: "123456789012",
  region: "us-east-2",
} as CandidateDeletionRestoreConfiguration;
const secret = `postgres://platform:synthetic%21Password@${configuration.sourceHostname}:5432/ai_job_apply?sslmode=require`;
const environment = {
  DATABASE_SECRET_ID:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:ai-job-apply/development/database-url-Ab12Cd",
  AWS_SESSION_TOKEN: "synthetic-runtime-session-token",
};
const signal = () => new AbortController().signal;
const response = (value: unknown) => new Response(JSON.stringify(value));
const error = "CandidateDeletionRestoreDatabaseResolutionRejected";

describe("restore-only database secret resolver", () => {
  it("reads only the local extension and substitutes only the authenticated target hostname", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ SecretString: secret }));
    const result = await resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher);
    expect(result).toBe(secret.replace(configuration.sourceHostname, configuration.targetHostname));
    const [endpoint, options] = fetcher.mock.calls[0] ?? [];
    expect(String(endpoint)).toBe(
      `http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(environment.DATABASE_SECRET_ID)}`,
    );
    expect(options).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { "X-Aws-Parameters-Secrets-Token": environment.AWS_SESSION_TOKEN },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("validates optional extension metadata for the exact named current secret", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ARN: environment.DATABASE_SECRET_ID,
        Name: "ai-job-apply/development/database-url",
        VersionId: "a".repeat(32),
        VersionStages: ["AWSCURRENT"],
        CreatedDate: 1_780_000_000,
        SecretString: secret,
      }),
    );
    await expect(
      resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher),
    ).resolves.toContain(configuration.targetHostname);
  });

  it.each([
    "DATABASE_URL",
    "DATABASE_OTHER",
    "RESTORE_DATABASE_URL",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGOPTIONS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NODE_USE_ENV_PROXY",
    "NODE_TLS_REJECT_UNAUTHORIZED",
  ])("rejects ambient override %s without fetching", async (key) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      resolveRestoredDatabaseUrl(configuration, { ...environment, [key]: "" }, signal(), fetcher),
    ).rejects.toThrow(error);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    secret.replace("postgres:", "postgresql:"),
    secret.replace("postgres:", "https:"),
    secret.replace("platform:", "other:"),
    secret.replace("synthetic%21Password", ""),
    secret.replace(configuration.sourceHostname, configuration.targetHostname),
    secret.replace(configuration.sourceHostname, "other.internal"),
    secret.replace(":5432/", ":5433/"),
    secret.replace("/ai_job_apply?", "/another?"),
    secret.replace("?sslmode=require", "?sslmode=disable"),
    `${secret}&sslmode=require`,
    `${secret}&host=other.internal`,
    `${secret}#fragment`,
    `${secret}\n`,
    secret.replace("synthetic%21Password", "bad%00password"),
    secret.replace("synthetic%21Password", "bad%0apassword"),
    secret.replace("/ai_job_apply?", "/x/../ai_job_apply?"),
    JSON.stringify({ DATABASE_URL: secret }),
  ])("rejects a noncanonical or unbound connection secret", async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ SecretString: value }));
    await expect(
      resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher),
    ).rejects.toThrow(error);
  });

  it.each([
    {},
    [],
    { SecretString: { url: secret } },
    { SecretString: secret, SecretBinary: "not-allowed" },
    { SecretString: secret, ARN: "wrong-secret" },
    { SecretString: secret, Name: "another-secret" },
    { SecretString: secret, VersionStages: ["AWSPREVIOUS"] },
    { SecretString: secret, VersionStages: ["AWSCURRENT", "AWSCURRENT"] },
    { SecretString: secret, VersionId: "short" },
    { SecretString: secret, CreatedDate: -1 },
  ])("rejects ambiguous extension envelope", async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
    await expect(
      resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher),
    ).rejects.toThrow(error);
  });

  it.each([301, 302, 403, 500, 503])(
    "rejects status %i without retry or following redirects",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private upstream body", {
          status,
          headers: { location: "https://unrelated.invalid" },
        }),
      );
      await expect(
        resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher),
      ).rejects.toThrow(error);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it("rejects oversized declared and streamed bodies and malformed UTF-8", async () => {
    for (const body of [
      new Response("{}", { headers: { "content-length": "16385" } }),
      new Response("x".repeat(16_385)),
      new Response(new Uint8Array([0xc3, 0x28])),
    ]) {
      await expect(
        resolveRestoredDatabaseUrl(
          configuration,
          environment,
          signal(),
          vi.fn<typeof fetch>().mockResolvedValue(body),
        ),
      ).rejects.toThrow(error);
    }
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_192));
        controller.enqueue(new Uint8Array(8_193));
      },
      cancel,
    });
    await expect(
      resolveRestoredDatabaseUrl(
        configuration,
        environment,
        signal(),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      ),
    ).rejects.toThrow(error);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the ten-second deadline even when a fake fetch ignores abort", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      const pending = resolveRestoredDatabaseUrl(
        configuration,
        environment,
        signal(),
        vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
      );
      const failure = expect(pending).rejects.toThrow(error);
      controller.abort(new Error(`never expose ${secret}`));
      await failure;
      expect(timeout).toHaveBeenCalledWith(10_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it("rejects the first empty chunk instead of collecting unbounded empty chunks", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify({ SecretString: secret }));
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 100) controller.enqueue(new Uint8Array());
        else {
          controller.enqueue(bytes);
          controller.close();
        }
      },
      cancel,
    });
    await expect(
      resolveRestoredDatabaseUrl(
        configuration,
        environment,
        signal(),
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      ),
    ).rejects.toThrow(error);
    expect(pulls).toBeLessThanOrEqual(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([-1, 1])("rejects completed bodies with declared length offset %i", async (offset) => {
    const body = JSON.stringify({ SecretString: secret });
    const declared = new TextEncoder().encode(body).byteLength + offset;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { "content-length": String(declared) } }));
    await expect(
      resolveRestoredDatabaseUrl(configuration, environment, signal(), fetcher),
    ).rejects.toThrow(error);
  });

  it.each([16_384, 16_385])("bounds one-byte chunks at %i total bytes", async (length) => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ SecretString: secret }).padEnd(length, " "),
    );
    let position = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position === bytes.byteLength) {
          if (length === 16_384) controller.close();
          return;
        }
        controller.enqueue(bytes.slice(position, ++position));
      },
      cancel,
    });
    const headers = length === 16_384 ? { "content-length": String(length) } : undefined;
    const pending = resolveRestoredDatabaseUrl(
      configuration,
      environment,
      signal(),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body, headers ? { headers } : {})),
    );
    if (length === 16_384) await expect(pending).resolves.toContain(configuration.targetHostname);
    else await expect(pending).rejects.toThrow(error);
    expect(position).toBeLessThanOrEqual(16_385);
    if (length === 16_385) expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts stalled body reads and never propagates secret-bearing causes", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = resolveRestoredDatabaseUrl(
      configuration,
      environment,
      controller.signal,
      fetcher,
    );
    const failure = expect(pending).rejects.toMatchObject({ message: error });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error(secret));
    await failure;
    const failed = await resolveRestoredDatabaseUrl(
      configuration,
      environment,
      signal(),
      vi.fn<typeof fetch>().mockRejectedValue(new Error(secret)),
    ).catch((failure: unknown) => failure);
    expect(failed).toMatchObject({ message: error });
    expect(failed).not.toHaveProperty("cause");
  });

  it("rejects missing token, wrong secret authority and same source/target before fetch", async () => {
    for (const config of [
      configuration,
      { ...configuration, targetHostname: configuration.sourceHostname },
    ]) {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        resolveRestoredDatabaseUrl(
          config,
          { ...environment, AWS_SESSION_TOKEN: "" },
          signal(),
          fetcher,
        ),
      ).rejects.toThrow(error);
      expect(fetcher).not.toHaveBeenCalled();
    }
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      resolveRestoredDatabaseUrl(
        configuration,
        {
          ...environment,
          DATABASE_SECRET_ID: environment.DATABASE_SECRET_ID.replace(
            "123456789012",
            "999999999999",
          ),
        },
        signal(),
        fetcher,
      ),
    ).rejects.toThrow(error);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
