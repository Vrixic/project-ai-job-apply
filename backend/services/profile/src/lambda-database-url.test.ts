import { describe, expect, it, vi } from "vitest";
import { resolveLambdaDatabaseUrl } from "./lambda-database-url.js";

describe("Lambda database secret resolution", () => {
  it("uses a direct PostgreSQL URL only for an explicitly configured local path", async () => {
    await expect(
      resolveLambdaDatabaseUrl({
        DATABASE_URL: "postgres://candidate:local@localhost:5432/ai_job_apply",
      }),
    ).resolves.toContain("postgres://");
  });

  it("retrieves the secret through the local AWS extension with the runtime token", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          SecretString: "postgres://candidate:managed@database.internal:5432/ai_job_apply",
        }),
        { status: 200 },
      ),
    );

    const result = await resolveLambdaDatabaseUrl(
      { DATABASE_SECRET_ID: "ai-job-apply/development/database-url" },
      { sessionToken: "runtime-session-token", fetchImplementation },
    );

    expect(result).toContain("database.internal");
    const [url, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toContain("secretId=ai-job-apply%2Fdevelopment%2Fdatabase-url");
    expect(request.headers).toEqual({
      "X-Aws-Parameters-Secrets-Token": "runtime-session-token",
    });
  });

  it("fails without printing or returning a malformed secret", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ SecretString: "https://not-a-database.example" }), {
        status: 200,
      }),
    );

    await expect(
      resolveLambdaDatabaseUrl(
        { DATABASE_SECRET_ID: "database-secret" },
        { sessionToken: "runtime-session-token", fetchImplementation },
      ),
    ).rejects.toThrow("not a PostgreSQL URL");
  });
});
