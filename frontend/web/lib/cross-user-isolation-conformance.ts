import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const CROSS_USER_PROBE_COOKIE_NAME = "applydash_cross_user_probe";

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const probeLifetimeSeconds = 15 * 60;
const platformRequestTimeoutMilliseconds = 10_000;

interface ProbeSession {
  user?: {
    sub?: unknown;
  };
}

interface ProbeAuth {
  getAccessToken(): Promise<{ token: string }>;
  getSession(): Promise<ProbeSession | null>;
}

interface ProbeCookieOptions {
  httpOnly: boolean;
  maxAge: number;
  path: string;
  sameSite: "strict";
  secure: boolean;
}

interface ProbeCookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: ProbeCookieOptions): void;
}

interface ProbeDependencies {
  appBaseUrl: string;
  auth0: ProbeAuth;
  baseUrl: string;
  cookieStore: ProbeCookieStore;
  enabled: boolean;
  fetch: typeof globalThis.fetch;
  issuer: string;
  now?: () => number;
  secret: string;
}

interface IsolationProbe {
  expiresAt: number;
  operationId: string;
  ownerFingerprint: string;
  version: 1;
}

function result(status: number, state: string, message: string): Response {
  return Response.json(
    { state, message },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

function expectedOrigin(appBaseUrl: string): string | null {
  try {
    const url = new URL(appBaseUrl);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function platformBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function probeKey(secret: string): Buffer | null {
  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    return null;
  }
  return createHash("sha256")
    .update("applydash:cross-user-isolation-probe:v1\0")
    .update(Buffer.from(secret, "hex"))
    .digest();
}

function identityFingerprint(issuer: string, subject: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update("applydash:cross-user-isolation-owner:v1\0")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("base64url");
}

function sameFingerprint(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sealProbe(probe: IsolationProbe, key: Buffer): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(probe), "utf8"), cipher.final()]);
  return [
    "v1",
    initializationVector.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function openProbe(value: string, key: Buffer): IsolationProbe | null {
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag || extra) {
      return null;
    }
    const iv = Buffer.from(encodedIv, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const probe = JSON.parse(plaintext) as Partial<IsolationProbe>;
    if (
      probe.version !== 1 ||
      typeof probe.expiresAt !== "number" ||
      typeof probe.operationId !== "string" ||
      !operationIdPattern.test(probe.operationId) ||
      typeof probe.ownerFingerprint !== "string" ||
      probe.ownerFingerprint.length < 32
    ) {
      return null;
    }
    return probe as IsolationProbe;
  } catch {
    return null;
  }
}

function setProbeCookie(dependencies: ProbeDependencies, value: string, maxAge: number): void {
  const origin = expectedOrigin(dependencies.appBaseUrl);
  dependencies.cookieStore.set(CROSS_USER_PROBE_COOKIE_NAME, value, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict",
    secure: origin?.startsWith("https://") ?? true,
  });
}

function clearProbeCookie(dependencies: ProbeDependencies): void {
  setProbeCookie(dependencies, "", 0);
}

async function fetchOperation(
  operationId: string,
  token: string,
  dependencies: ProbeDependencies,
): Promise<Response | null> {
  const baseUrl = platformBaseUrl(dependencies.baseUrl);
  if (!baseUrl) {
    return null;
  }
  try {
    return await dependencies.fetch(
      new URL(`/v1/operations/${encodeURIComponent(operationId)}`, baseUrl),
      {
        method: "GET",
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(platformRequestTimeoutMilliseconds),
      },
    );
  } catch {
    return null;
  }
}

function discardResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // The status alone is authoritative for this probe; response bodies are intentionally ignored.
  }
}

function validRequest(request: Request, dependencies: ProbeDependencies): Response | undefined {
  if (!dependencies.enabled) {
    return result(404, "unavailable", "Not found");
  }
  const origin = expectedOrigin(dependencies.appBaseUrl);
  if (!origin || request.headers.get("origin") !== origin) {
    return result(403, "origin_rejected", "The request origin was rejected");
  }
  return undefined;
}

async function currentIdentity(
  dependencies: ProbeDependencies,
): Promise<{ fingerprint: string; token: string } | null> {
  const key = probeKey(dependencies.secret);
  if (!key) {
    return null;
  }
  const session = await dependencies.auth0.getSession();
  const subject = session?.user?.sub;
  let issuer: URL;
  try {
    issuer = new URL(dependencies.issuer);
  } catch {
    return null;
  }
  if (
    typeof subject !== "string" ||
    !subject ||
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    return null;
  }
  try {
    const { token } = await dependencies.auth0.getAccessToken();
    return {
      fingerprint: identityFingerprint(issuer.toString(), subject, key),
      token,
    };
  } catch {
    return null;
  }
}

export function isCrossUserIsolationConformanceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.NODE_ENV === "development";
}

export async function armCrossUserIsolationProbe(
  request: Request,
  dependencies: ProbeDependencies,
): Promise<Response> {
  const invalid = validRequest(request, dependencies);
  if (invalid) {
    return invalid;
  }
  const key = probeKey(dependencies.secret);
  if (!key) {
    return result(503, "configuration_unavailable", "The conformance probe is unavailable");
  }

  let operationId: string | undefined;
  try {
    const body = (await request.json()) as { operationId?: unknown };
    if (typeof body.operationId === "string" && operationIdPattern.test(body.operationId)) {
      operationId = body.operationId;
    }
  } catch {
    // Return the same sanitized input result for malformed and invalid bodies.
  }
  if (!operationId) {
    return result(400, "invalid_operation", "A completed operation is required");
  }

  const identity = await currentIdentity(dependencies);
  if (!identity) {
    return result(401, "reauthentication_required", "Sign in again to continue");
  }
  const operationResponse = await fetchOperation(operationId, identity.token, dependencies);
  if (!operationResponse) {
    return result(503, "platform_unavailable", "The platform API is unavailable");
  }
  let operationSucceeded = false;
  if (operationResponse.status === 200) {
    try {
      const operation = (await operationResponse.json()) as { state?: unknown };
      operationSucceeded = operation.state === "succeeded";
    } catch {
      operationSucceeded = false;
    }
  } else {
    discardResponseBody(operationResponse);
  }
  if (!operationSucceeded) {
    return result(409, "operation_unavailable", "The completed operation could not be verified");
  }

  const now = dependencies.now?.() ?? Date.now();
  const probe: IsolationProbe = {
    expiresAt: now + probeLifetimeSeconds * 1_000,
    operationId,
    ownerFingerprint: identity.fingerprint,
    version: 1,
  };
  setProbeCookie(dependencies, sealProbe(probe, key), probeLifetimeSeconds);
  return result(
    200,
    "armed",
    "Probe armed. Log out and sign in with a different synthetic account.",
  );
}

export async function runCrossUserIsolationProbe(
  request: Request,
  dependencies: ProbeDependencies,
): Promise<Response> {
  const invalid = validRequest(request, dependencies);
  if (invalid) {
    return invalid;
  }
  const key = probeKey(dependencies.secret);
  if (!key) {
    return result(503, "configuration_unavailable", "The conformance probe is unavailable");
  }
  const sealedProbe = dependencies.cookieStore.get(CROSS_USER_PROBE_COOKIE_NAME)?.value;
  const probe = sealedProbe ? openProbe(sealedProbe, key) : null;
  const now = dependencies.now?.() ?? Date.now();
  if (!probe || probe.expiresAt <= now) {
    clearProbeCookie(dependencies);
    return result(409, "probe_unavailable", "Arm a new probe before running this check");
  }

  const identity = await currentIdentity(dependencies);
  if (!identity) {
    return result(401, "reauthentication_required", "Sign in again to continue");
  }
  if (sameFingerprint(identity.fingerprint, probe.ownerFingerprint)) {
    return result(
      409,
      "different_account_required",
      "Sign in with a different synthetic account to run this check",
    );
  }

  const operationResponse = await fetchOperation(probe.operationId, identity.token, dependencies);
  if (!operationResponse) {
    return result(503, "platform_unavailable", "The platform API is unavailable");
  }
  const status = operationResponse.status;
  discardResponseBody(operationResponse);
  if (status === 404) {
    clearProbeCookie(dependencies);
    return result(
      200,
      "isolation_passed",
      "Cross-user isolation passed: the second account could not read the operation.",
    );
  }
  if (status === 200) {
    clearProbeCookie(dependencies);
    return result(
      409,
      "isolation_failed",
      "Cross-user isolation failed; stop deployed acceptance and investigate.",
    );
  }
  if (status === 401) {
    return result(401, "reauthentication_required", "Sign in again to continue");
  }
  return result(503, "check_inconclusive", "The isolation check could not be completed");
}
