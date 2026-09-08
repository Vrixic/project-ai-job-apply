import "server-only";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";

const LOCAL_ORIGIN = "http://localhost:3001";
const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_JWKS_BYTES = 256 * 1024;
const CONFIG_KEYS = [
  "schemaVersion",
  "issuer",
  "audience",
  "clientId",
  "expectedSubject",
  "startsAt",
  "expiresAt",
  "resultPath",
  "runId",
];

type Environment = Record<string, string | undefined>;
export interface AppealSetupConfig {
  schemaVersion: 1;
  issuer: string;
  audience: "ai-job-apply-api";
  clientId: string;
  expectedSubject: string;
  startsAt: string;
  expiresAt: string;
  resultPath: string;
  runId: string;
}

export type AppealSetupResult = {
  status:
    | "verified"
    | "unavailable"
    | "sign_in_required"
    | "verification_failed"
    | "already_complete";
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/** Only trusted, process-local configuration can enable this one-shot setup check. */
export function getAppealSetupConfig(
  environment: Environment = process.env,
  now = Date.now(),
): AppealSetupConfig | undefined {
  if (
    environment.ADMIN_AUTHORIZATION_PROFILE !== "appeals" ||
    environment.APP_BASE_URL !== LOCAL_ORIGIN ||
    environment.VERCEL !== undefined ||
    !Number.isFinite(now)
  )
    return undefined;
  try {
    const raw = environment.ADMIN_APPEAL_SETUP_CONFIG;
    if (!raw || raw.length > 8192) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      Object.keys(value).length !== CONFIG_KEYS.length ||
      CONFIG_KEYS.some((key) => !Object.hasOwn(value, key)) ||
      value.schemaVersion !== 1 ||
      value.audience !== "ai-job-apply-api" ||
      typeof value.issuer !== "string" ||
      typeof value.clientId !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.clientId) ||
      typeof value.expectedSubject !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}\|[A-Za-z0-9_-]{1,191}$/.test(value.expectedSubject) ||
      typeof value.runId !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.runId) ||
      typeof value.resultPath !== "string" ||
      !path.isAbsolute(value.resultPath) ||
      path.resolve(value.resultPath) !== value.resultPath ||
      path.basename(value.resultPath) !== `appeal-identity-${value.runId}.json` ||
      path.basename(path.dirname(value.resultPath)) !== "d2-reviewer" ||
      path.basename(path.dirname(path.dirname(value.resultPath))) !== ".tmp" ||
      !exactDate(value.startsAt) ||
      !exactDate(value.expiresAt)
    )
      return undefined;
    const issuer = new URL(value.issuer);
    if (
      issuer.protocol !== "https:" ||
      `${issuer.origin}/` !== value.issuer ||
      issuer.hostname !== environment.AUTH0_DOMAIN ||
      value.clientId !== environment.AUTH0_CLIENT_ID ||
      (environment.AUTH0_AUDIENCE ?? "ai-job-apply-api") !== value.audience ||
      !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
        issuer.hostname,
      ) ||
      issuer.port !== "" ||
      issuer.hostname.endsWith(".")
    )
      return undefined;
    const start = Date.parse(value.startsAt);
    const end = Date.parse(value.expiresAt);
    if (start > now || end <= now || end <= start || end - start > MAX_WINDOW_MS) return undefined;
    return value as unknown as AppealSetupConfig;
  } catch {
    return undefined;
  }
}

function exactAudience(value: unknown, required: string, optional?: string): boolean {
  if (value === required) return true;
  return (
    Array.isArray(value) &&
    value.includes(required) &&
    new Set(value).size === value.length &&
    value.every((entry) => entry === required || (optional !== undefined && entry === optional))
  );
}

/** Claims here come only from the SDK's validated, server-held session. */
export function validateAppealSetupSession(
  session: unknown,
  config: AppealSetupConfig,
  now: number,
): string | undefined {
  if (!record(session) || !record(session.user) || !record(session.tokenSet)) return undefined;
  const user = session.user;
  const seconds = Math.floor(now / 1000);
  if (
    user.iss !== config.issuer ||
    user.sub !== config.expectedSubject ||
    !exactAudience(user.aud, config.clientId) ||
    !Array.isArray(user.amr) ||
    !user.amr.includes("mfa") ||
    typeof user.auth_time !== "number" ||
    !Number.isSafeInteger(user.auth_time) ||
    user.auth_time > seconds ||
    user.auth_time < seconds - 900 ||
    typeof session.tokenSet.accessToken !== "string" ||
    session.tokenSet.accessToken.length < 32 ||
    session.tokenSet.accessToken.length > 16 * 1024
  ) {
    return undefined;
  }
  return session.tokenSet.accessToken;
}

/** Called only after RS256 signature, issuer, audience and required-time-claim verification. */
export function validateAppealAccessClaims(
  payload: JWTPayload,
  config: AppealSetupConfig,
  now: number,
): boolean {
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  const allowed = ["openid", "profile", "trust:review", "trust:appeal:resolve"];
  const seconds = Math.floor(now / 1000);
  return (
    payload.iss === config.issuer &&
    payload.sub === config.expectedSubject &&
    payload.azp === config.clientId &&
    exactAudience(payload.aud, config.audience, `${config.issuer}userinfo`) &&
    Number.isSafeInteger(payload.iat) &&
    (payload.iat as number) <= seconds &&
    Number.isSafeInteger(payload.exp) &&
    (payload.exp as number) > seconds &&
    (payload.exp as number) > (payload.iat as number) &&
    scopes.includes("trust:review") &&
    scopes.includes("trust:appeal:resolve") &&
    new Set(scopes).size === scopes.length &&
    scopes.every((scope) => allowed.includes(scope))
  );
}

async function plainPath(target: string, directory: boolean): Promise<void> {
  const metadata = await lstat(target);
  if (
    metadata.isSymbolicLink() ||
    (directory ? !metadata.isDirectory() : !metadata.isFile()) ||
    path.resolve(await realpath(target)) !== path.resolve(target)
  )
    throw new Error("unsafe_path");
}

async function validateReceiptLocation(config: AppealSetupConfig): Promise<void> {
  const directory = path.dirname(config.resultPath);
  let ancestor = directory;
  while (true) {
    await plainPath(ancestor, true);
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const root = path.dirname(path.dirname(directory));
  const rootPackage = path.join(root, "package.json");
  const adminDirectory = path.join(root, "frontend", "admin");
  const adminPackage = path.join(adminDirectory, "package.json");
  await plainPath(path.join(root, "frontend"), true);
  await plainPath(adminDirectory, true);
  await plainPath(rootPackage, false);
  await plainPath(adminPackage, false);
  const rootMetadata: unknown = JSON.parse(await readFile(rootPackage, "utf8"));
  const adminMetadata: unknown = JSON.parse(await readFile(adminPackage, "utf8"));
  if (
    !record(rootMetadata) ||
    rootMetadata.name !== "ai-job-apply" ||
    !record(adminMetadata) ||
    adminMetadata.name !== "@ai-job-apply/admin"
  ) {
    throw new Error("unsafe_path");
  }
}

async function boundedJwksFetch(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal,
    headers: { accept: "application/json" },
  });
  if (
    response.status !== 200 ||
    (response.url && response.url !== url) ||
    !response.body ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    throw new Error("jwks_unavailable");
  }
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_JWKS_BYTES) throw new Error("jwks_unavailable");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return new Response(Buffer.concat(chunks), { headers: { "content-type": "application/json" } });
}

export interface AppealSetupDependencies {
  environment: Environment;
  now(): number;
  getSession(): Promise<unknown>;
  fetch: typeof fetch;
}

/** No provider grants, refresh, Gateway calls or case mutations occur in this action. */
export async function verifyAppealSetup(
  headers: Pick<Headers, "get">,
  dependencies: AppealSetupDependencies,
): Promise<AppealSetupResult> {
  const config = getAppealSetupConfig(dependencies.environment, dependencies.now());
  if (
    !config ||
    headers.get("origin") !== LOCAL_ORIGIN ||
    headers.get("host") !== "localhost:3001"
  ) {
    return { status: "unavailable" };
  }
  try {
    const session = await dependencies.getSession();
    const token = validateAppealSetupSession(session, config, dependencies.now());
    if (!token) return { status: "sign_in_required" };
    const jwksUrl = `${config.issuer}.well-known/jwks.json`;
    const jwks = createRemoteJWKSet(new URL(jwksUrl), {
      timeoutDuration: 5000,
      [customFetch]: async (url, options) => {
        if (url !== jwksUrl) throw new Error("jwks_unavailable");
        return boundedJwksFetch(
          url,
          AbortSignal.any([options.signal, AbortSignal.timeout(5000)]),
          dependencies.fetch,
        );
      },
    });
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["exp", "iat", "sub", "iss", "aud"],
      currentDate: new Date(dependencies.now()),
      clockTolerance: 0,
    });
    const verifiedAt = dependencies.now();
    if (
      !getAppealSetupConfig(dependencies.environment, verifiedAt) ||
      !validateAppealSetupSession(session, config, verifiedAt) ||
      !validateAppealAccessClaims(payload, config, verifiedAt)
    )
      return { status: "verification_failed" };
    await validateReceiptLocation(config);
    if (!getAppealSetupConfig(dependencies.environment, dependencies.now()))
      return { status: "unavailable" };
    // The launcher supplies a current-user-only directory. wx refuses files and links, including races.
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(config.resultPath, "wx", 0o600);
    } catch (error) {
      return {
        status:
          record(error) && error.code === "EEXIST" ? "already_complete" : "verification_failed",
      };
    }
    try {
      const receipt = {
        profile: "d2_human_appeal_identity_v1",
        schemaVersion: 1,
        runId: config.runId,
        verifiedAt: new Date(verifiedAt).toISOString(),
        expiresAt: config.expiresAt,
        subjectBindingSha256: createHash("sha256")
          .update(
            JSON.stringify([
              config.issuer,
              config.expectedSubject,
              config.clientId,
              config.audience,
            ]),
          )
          .digest("hex"),
        issuerAudienceSubjectClientMatched: true,
        mfaVerified: true,
        privilegedScopesValidated: 2,
        unexpectedScopes: 0,
        rolesDeployed: false,
        caseMutations: 0,
      };
      await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { status: "verified" };
  } catch {
    return { status: "verification_failed" };
  }
}
