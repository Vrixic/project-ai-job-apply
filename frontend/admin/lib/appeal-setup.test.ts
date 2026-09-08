import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAppealSetupConfig,
  validateAppealAccessClaims,
  validateAppealSetupSession,
  verifyAppealSetup,
  type AppealSetupConfig,
  type AppealSetupDependencies,
} from "./appeal-setup";

vi.mock("server-only", () => ({}));

const NOW = Date.parse("2026-09-08T12:30:00.000Z");
const SECONDS = NOW / 1000;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };
let root: string;
let config: AppealSetupConfig;
let environment: Record<string, string | undefined>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  otherKeys = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: "synthetic", alg: "RS256" }] };
});
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "appeal-setup-test-"));
  await mkdir(path.join(root, ".tmp", "d2-reviewer"), { recursive: true });
  await mkdir(path.join(root, "frontend", "admin"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ai-job-apply" }));
  await writeFile(
    path.join(root, "frontend", "admin", "package.json"),
    JSON.stringify({ name: "@ai-job-apply/admin" }),
  );
  config = {
    schemaVersion: 1,
    issuer: "https://synthetic.example.test/",
    audience: "ai-job-apply-api",
    clientId: "synthetic-appeal-client",
    expectedSubject: "auth0|synthetic-human",
    startsAt: "2026-09-08T12:00:00.000Z",
    expiresAt: "2026-09-08T13:00:00.000Z",
    runId: "0123456789abcdef0123456789abcdef",
    resultPath: path.join(
      root,
      ".tmp",
      "d2-reviewer",
      "appeal-identity-0123456789abcdef0123456789abcdef.json",
    ),
  };
  environment = {
    ADMIN_AUTHORIZATION_PROFILE: "appeals",
    APP_BASE_URL: "http://localhost:3001",
    AUTH0_DOMAIN: "synthetic.example.test",
    AUTH0_CLIENT_ID: config.clientId,
    AUTH0_AUDIENCE: config.audience,
    ADMIN_APPEAL_SETUP_CONFIG: JSON.stringify(config),
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const requestHeaders = () =>
  new Headers({ origin: "http://localhost:3001", host: "localhost:3001" });
function claims(overrides: Record<string, unknown> = {}): JWTPayload {
  return {
    iss: config.issuer,
    sub: config.expectedSubject,
    aud: config.audience,
    azp: config.clientId,
    scope: "openid profile trust:review trust:appeal:resolve",
    iat: SECONDS - 60,
    exp: SECONDS + 600,
    ...overrides,
  };
}
function session(token: string, overrides: Record<string, unknown> = {}) {
  return {
    user: {
      iss: config.issuer,
      sub: config.expectedSubject,
      aud: config.clientId,
      amr: ["pwd", "mfa"],
      auth_time: SECONDS - 60,
      ...overrides,
    },
    tokenSet: { accessToken: token },
  };
}
async function dependencies(overrides: Record<string, unknown> = {}, signer = keys.privateKey) {
  const token = await new SignJWT(claims(overrides))
    .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
    .sign(signer);
  const deps: AppealSetupDependencies = {
    environment,
    now: () => NOW,
    getSession: vi.fn(async () => session(token)),
    fetch: vi.fn(async () => Response.json(jwks)),
  };
  return { deps, token };
}

describe("explicit local-only setup configuration", () => {
  it("accepts only an active bounded exact local configuration", () => {
    expect(getAppealSetupConfig(environment, NOW)).toEqual(config);
    expect(getAppealSetupConfig({}, NOW)).toBeUndefined();
  });
  it.each([
    { ADMIN_AUTHORIZATION_PROFILE: "standard" },
    { APP_BASE_URL: "http://127.0.0.1:3001" },
    { APP_BASE_URL: "https://host.example.test" },
    { VERCEL: "0" },
    { AUTH0_DOMAIN: "other.example.test" },
    { AUTH0_CLIENT_ID: "another-client" },
    { AUTH0_AUDIENCE: "other-api" },
    { ADMIN_APPEAL_SETUP_CONFIG: "{}" },
    { ADMIN_APPEAL_SETUP_CONFIG: "invalid-sensitive-json" },
  ])("refuses environment mismatch without reflecting configuration: %j", (changes) => {
    expect(getAppealSetupConfig({ ...environment, ...changes }, NOW)).toBeUndefined();
  });
  it.each([
    { expiresAt: "2026-09-08T12:30:00.000Z" },
    { startsAt: "2026-09-08T12:31:00.000Z" },
    { expiresAt: "2026-09-08T15:00:00.000Z" },
    { startsAt: "yesterday" },
    { expectedSubject: "machine@clients" },
    { issuer: "https://synthetic.example.test/extra" },
    { resultPath: "relative.json" },
    { unexpected: true },
    { schemaVersion: 2 },
  ])("refuses invalid setup shape or window: %j", (changes) => {
    environment.ADMIN_APPEAL_SETUP_CONFIG = JSON.stringify({ ...config, ...changes });
    expect(getAppealSetupConfig(environment, NOW)).toBeUndefined();
  });
  it("refuses outside-directory, traversal and mismatched-run paths", () => {
    for (const resultPath of [
      path.join(root, "elsewhere", path.basename(config.resultPath)),
      config.resultPath.replace(config.runId, "a".repeat(32)),
      path.dirname(config.resultPath) +
        path.sep +
        ".." +
        path.sep +
        path.basename(config.resultPath),
    ]) {
      environment.ADMIN_APPEAL_SETUP_CONFIG = JSON.stringify({ ...config, resultPath });
      expect(getAppealSetupConfig(environment, NOW)).toBeUndefined();
    }
  });
});

describe("validated session and access-token invariants", () => {
  it.each([
    { iss: "https://wrong.example.test/" },
    { sub: "auth0|other-human" },
    { aud: "other-client" },
    { aud: ["other-client", "synthetic-appeal-client"] },
    { amr: ["pwd"] },
    { amr: "mfa" },
    { auth_time: SECONDS - 901 },
    { auth_time: SECONDS + 1 },
    { auth_time: SECONDS - 0.5 },
    { auth_time: undefined },
  ])("rejects missing or mismatched MFA identity/session: %j", (changes) => {
    expect(
      validateAppealSetupSession(session("x".repeat(64), changes), config, NOW),
    ).toBeUndefined();
  });
  it.each([
    { scope: "trust:review" },
    { scope: "trust:review trust:appeal:resolve offline_access" },
    { scope: "trust:review trust:appeal:resolve trust:case:decide" },
    { scope: "trust:review trust:appeal:resolve trust:review" },
    { scope: " trust:review trust:appeal:resolve" },
    { scope: "trust:review trust:appeal:resolve email" },
    { aud: ["ai-job-apply-api", "https://other.example.test/userinfo"] },
    { aud: ["ai-job-apply-api", "ai-job-apply-api"] },
    { azp: "other-client" },
    { sub: "auth0|other-human" },
    { exp: SECONDS },
    { iat: SECONDS + 1 },
  ])("rejects unauthorized or malformed signed claims: %j", (changes) => {
    expect(validateAppealAccessClaims(claims(changes), config, NOW)).toBe(false);
  });
  it("allows only optional OIDC scopes and exact userinfo audience", () => {
    expect(
      validateAppealAccessClaims(
        claims({
          scope: "trust:review trust:appeal:resolve",
          aud: [config.audience, `${config.issuer}userinfo`],
        }),
        config,
        NOW,
      ),
    ).toBe(true);
  });
});

describe("one-shot managed identity check", () => {
  it("verifies a real generated signature and writes only a bounded aggregate", async () => {
    const { deps, token } = await dependencies();
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({ status: "verified" });
    const raw = await readFile(config.resultPath, "utf8");
    expect(JSON.parse(raw)).toEqual({
      profile: "d2_human_appeal_identity_v1",
      schemaVersion: 1,
      runId: config.runId,
      verifiedAt: new Date(NOW).toISOString(),
      expiresAt: config.expiresAt,
      subjectBindingSha256: createHash("sha256")
        .update(
          JSON.stringify([config.issuer, config.expectedSubject, config.clientId, config.audience]),
        )
        .digest("hex"),
      issuerAudienceSubjectClientMatched: true,
      mfaVerified: true,
      privilegedScopesValidated: 2,
      unexpectedScopes: 0,
      rolesDeployed: false,
      caseMutations: 0,
    });
    for (const sensitive of [token, config.issuer, config.expectedSubject, config.clientId])
      expect(raw).not.toContain(sensitive);
    expect(deps.fetch).toHaveBeenCalledExactlyOnceWith(
      `${config.issuer}.well-known/jwks.json`,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    { origin: "https://attacker.example.test", host: "localhost:3001" },
    { origin: "http://localhost:3001", host: "127.0.0.1:3001" },
    {},
  ])("refuses cross-origin or absent headers before session access: %j", async (headers) => {
    const { deps } = await dependencies();
    expect(await verifyAppealSetup(new Headers(headers), deps)).toEqual({ status: "unavailable" });
    expect(deps.getSession).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("refuses anonymous session without making a request", async () => {
    const { deps } = await dependencies();
    deps.getSession = async () => null;
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({ status: "sign_in_required" });
    expect(deps.fetch).not.toHaveBeenCalled();
    await expect(readFile(config.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each([
    { sub: "auth0|another-human" },
    { azp: "another-client" },
    { iss: "https://other.example.test/" },
    { aud: "another-api" },
    { exp: SECONDS - 1 },
    { iat: undefined },
    { scope: "trust:review" },
  ])("refuses signed but unauthorized tokens: %j", async (changes) => {
    const { deps } = await dependencies(changes);
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
    await expect(readFile(config.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects a token with the wrong signature", async () => {
    const { deps } = await dependencies({}, otherKeys.privateKey);
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
  });
  it("rejects a non-RS256 algorithm before fetching any keys", async () => {
    const { deps } = await dependencies();
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256" })
      .sign(new Uint8Array(32).fill(7));
    deps.getSession = async () => session(token);
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("rejects a JWKS response attributed to any other URL", async () => {
    const { deps } = await dependencies();
    deps.fetch = vi.fn(async () => {
      const response = Response.json(jwks);
      Object.defineProperty(response, "url", { value: "https://other.example.test/jwks.json" });
      return response;
    });
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
  });
  it.each(["redirect", "malformed", "oversized", "private-error"])(
    "fails closed without provider error disclosure for %s JWKS",
    async (mode) => {
      const { deps } = await dependencies();
      deps.fetch = vi.fn(async () => {
        if (mode === "private-error") throw new Error("raw-secret-or-claim");
        if (mode === "redirect")
          return new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example.test" },
          });
        return new Response(
          mode === "malformed" ? "private-invalid-json" : " ".repeat(256 * 1024 + 1),
          { headers: { "content-type": "application/json" } },
        );
      });
      expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
        status: "verification_failed",
      });
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not overwrite even an existing untrusted result", async () => {
    const { deps } = await dependencies();
    await writeFile(config.resultPath, "existing");
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({ status: "already_complete" });
    expect(await readFile(config.resultPath, "utf8")).toBe("existing");
  });
  it("refuses a repository-marker mismatch", async () => {
    const { deps } = await dependencies();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "another-repo" }));
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
  });
  it("refuses linked output directories without touching their target", async () => {
    const { deps } = await dependencies();
    const directory = path.dirname(config.resultPath);
    const target = path.join(root, "elsewhere");
    await mkdir(target);
    await rm(directory, { recursive: true });
    await symlink(target, directory, "junction");
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
    await expect(
      readFile(path.join(target, path.basename(config.resultPath))),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses if the window expires during verification", async () => {
    const { deps } = await dependencies();
    deps.fetch = vi.fn(async () => {
      deps.now = () => Date.parse(config.expiresAt);
      return Response.json(jwks);
    });
    expect(await verifyAppealSetup(requestHeaders(), deps)).toEqual({
      status: "verification_failed",
    });
    await expect(readFile(config.resultPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
