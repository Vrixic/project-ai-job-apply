import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { parseEnv } from "node:util";

export const CANDIDATE_RIGHTS_SESSION_ORIGIN = "http://localhost:3000";
export const CANDIDATE_RIGHTS_SESSION_CALLBACK = `${CANDIDATE_RIGHTS_SESSION_ORIGIN}/auth/callback`;
export const CANDIDATE_RIGHTS_SESSION_SCOPES =
  "openid profile email offline_access documents:read documents:write jobs:read jobs:write profile:read profile:write";
export const D2_WORKLOAD_SESSION_SCOPES =
  "openid profile email jobs:read jobs:contribute profile:write";
export const D2_WORKLOAD_SESSION_PROFILE = "d2_disposable_contribution_workload_v1";
const RIGHTS_PROFILE = Object.freeze({
  scopes: CANDIDATE_RIGHTS_SESSION_SCOPES,
  minimumLifetimeSeconds: 120,
  refreshRequired: true,
});
const WORKLOAD_PROFILE = Object.freeze({
  scopes: D2_WORKLOAD_SESSION_SCOPES,
  minimumLifetimeSeconds: 25 * 60,
  refreshRequired: false,
});
export const CANDIDATE_RIGHTS_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const CANDIDATE_RIGHTS_TOKEN_TIMEOUT_MS = 10_000;
export const CANDIDATE_RIGHTS_TOKEN_MAXIMUM_BYTES = 65_536;
const COOKIE_NAME = "candidate_rights_operator_transaction";
const MFA_ACR = "http://schemas.openid.net/pape/policies/2007/06/multi-factor";
const ERROR_MESSAGE = "Candidate rights sign-in could not be completed. Start a fresh session.";
const REQUEST_DIAGNOSTICS = new Set([
  "request_rejected",
  "request_boundary_rejected",
  "root_cookie_missing",
  "root_cookie_mismatch",
  "unexpected_local_error",
]);

export class CandidateRightsSessionError extends Error {
  constructor(diagnostic = "request_rejected") {
    super(ERROR_MESSAGE);
    this.name = "CandidateRightsSessionError";
    this.diagnostic = REQUEST_DIAGNOSTICS.has(diagnostic) ? diagnostic : "request_rejected";
  }
}

function reject(diagnostic) {
  throw new CandidateRightsSessionError(diagnostic);
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new CandidateRightsSessionError());
  return new Promise((resolve, rejectAbort) => {
    const abort = () => rejectAbort(new CandidateRightsSessionError());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, () => rejectAbort(new CandidateRightsSessionError()))
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasControlCharacters(value, includeSpace = false) {
  return (
    /\p{Cf}/u.test(value) ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || (includeSpace && code === 32) || (code >= 127 && code <= 159);
    })
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
  });
}

function validateConfiguration({ issuer, audience, clientId, clientSecret }) {
  let parsed;
  try {
    parsed = new URL(issuer);
  } catch {
    reject();
  }
  if (
    typeof issuer !== "string" ||
    parsed.protocol !== "https:" ||
    `${parsed.origin}/` !== issuer ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(
      parsed.hostname,
    ) ||
    audience !== "ai-job-apply-api" ||
    typeof clientId !== "string" ||
    !/^[A-Za-z0-9_-]{16,256}$/u.test(clientId) ||
    typeof clientSecret !== "string" ||
    clientSecret.length < 16 ||
    clientSecret.length > 4096 ||
    hasControlCharacters(clientSecret, true)
  ) {
    reject();
  }
}

export function parseCandidateRightsEnvironment(text) {
  if (typeof text !== "string") reject();
  try {
    // A Windows UTF-8 file may begin with a BOM. Do not normalize embedded markers or values.
    const settings = parseEnv(text.startsWith("\uFEFF") ? text.slice(1) : text);
    const configuration = {
      issuer: `https://${settings.AUTH0_DOMAIN}/`,
      audience: settings.AUTH0_AUDIENCE,
      clientId: settings.AUTH0_CLIENT_ID,
      clientSecret: settings.AUTH0_CLIENT_SECRET,
    };
    validateConfiguration(configuration);
    return Object.freeze(configuration);
  } catch {
    reject();
  }
}

function decodeVerifiedClaims(token) {
  if (typeof token !== "string" || token.length > 32_768) reject();
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part))) reject();
  try {
    const bytes = Buffer.from(parts[1], "base64url");
    if (bytes.toString("base64url") !== parts[1]) reject();
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) reject();
    return value;
  } catch {
    reject();
  }
}

async function defaultTokenVerifier({ issuer, audience, clientId, accessToken, idToken }) {
  const { createOidcVerifier, createOidcIdTokenVerifier } = await import(
    "../../packages/auth/dist/index.js"
  );
  const [accessPrincipal, idProof] = await Promise.all([
    createOidcVerifier({ issuer, audience }).verify(accessToken),
    createOidcIdTokenVerifier({ issuer, audience: clientId }).verify(idToken),
  ]);
  return { accessPrincipal, idProof };
}

/** Decode only the exact JWTs already checked by the shared signature/issuer/audience verifiers. */
function validateVerifiedTokens(tokens, verified, expected, profile) {
  const { accessPrincipal, idProof } = verified ?? {};
  if (!accessPrincipal || !idProof) reject();
  const access = decodeVerifiedClaims(tokens.access_token);
  const id = decodeVerifiedClaims(tokens.id_token);
  const now = Math.floor(Date.now() / 1000);
  const subject = idProof.subject;
  const apiAudiences = Array.isArray(access.aud) ? access.aud : [access.aud];
  const idAudiences = Array.isArray(id.aud) ? id.aud : [id.aud];
  if (
    typeof subject !== "string" ||
    subject.length === 0 ||
    subject.length > 256 ||
    hasControlCharacters(subject) ||
    accessPrincipal.subject !== subject ||
    access.sub !== subject ||
    id.sub !== subject ||
    accessPrincipal.issuer !== expected.issuer ||
    idProof.issuer !== expected.issuer ||
    access.iss !== expected.issuer ||
    id.iss !== expected.issuer ||
    !apiAudiences.includes(expected.audience) ||
    idAudiences.length !== 1 ||
    idAudiences[0] !== expected.clientId ||
    !equalSecret(id.nonce, expected.nonce) ||
    (id.azp !== undefined && id.azp !== expected.clientId) ||
    (access.azp !== undefined && access.azp !== expected.clientId) ||
    !Number.isSafeInteger(access.exp) ||
    !Number.isSafeInteger(id.exp) ||
    access.exp <= now + profile.minimumLifetimeSeconds ||
    id.exp <= now + profile.minimumLifetimeSeconds ||
    !Number.isSafeInteger(id.iat) ||
    id.iat > now + 5 ||
    !Number.isSafeInteger(id.auth_time) ||
    id.auth_time > now ||
    id.auth_time < Math.floor(expected.startedAt / 1000) - 5 ||
    now - id.auth_time > 900 ||
    idProof.authenticatedAt !== id.auth_time ||
    !Array.isArray(id.amr) ||
    !id.amr.includes("mfa") ||
    !idProof.authenticationMethods?.includes("mfa") ||
    !Array.isArray(accessPrincipal.scopes) ||
    !accessPrincipal.scopes.includes("profile:write") ||
    accessPrincipal.scopes.some((scope) => !profile.scopes.split(" ").includes(scope)) ||
    typeof access.scope !== "string" ||
    !access.scope.split(" ").includes("profile:write")
  ) {
    reject();
  }
  if (profile === WORKLOAD_PROFILE) {
    const required = ["jobs:read", "jobs:contribute", "profile:write"];
    const scopes = access.scope.split(" ");
    if (
      required.some(
        (scope) => !accessPrincipal.scopes.includes(scope) || !scopes.includes(scope),
      ) ||
      scopes.some((scope) => !profile.scopes.split(" ").includes(scope))
    )
      reject();
  }
  // The label is shown only in the no-store local confirmation response; it is never logged.
  const label =
    typeof id.email === "string" && id.email.length > 0 && id.email.length <= 320
      ? id.email
      : subject;
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    ...(profile.refreshRequired
      ? { refreshToken: tokens.refresh_token }
      : {
          purpose: "d2_workload",
          profile: D2_WORKLOAD_SESSION_PROFILE,
        }),
    subject,
    issuer: expected.issuer,
    expiresAt: new Date(Math.min(access.exp, id.exp) * 1000).toISOString(),
    authTime: new Date(id.auth_time * 1000).toISOString(),
    label,
  };
}

async function readBounded(stream, maximumBytes, signal) {
  const reader = stream?.getReader();
  if (!reader) reject();
  const chunks = [];
  let total = 0;
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) reject();
      const { done, value } = await reader.read();
      if (signal.aborted) reject();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) reject();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
  }
}

function tokenResponse(bytes, profile) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    reject();
  }
  const allowed = [
    "access_token",
    "id_token",
    "refresh_token",
    "token_type",
    "expires_in",
    "scope",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    value.token_type !== "Bearer" ||
    (profile === WORKLOAD_PROFILE && Object.hasOwn(value, "refresh_token")) ||
    !(
      profile.refreshRequired
        ? ["access_token", "id_token", "refresh_token"]
        : ["access_token", "id_token"]
    ).every(
      (key) =>
        typeof value[key] === "string" &&
        value[key].length > 0 &&
        value[key].length <= 32_768 &&
        !hasControlCharacters(value[key], true),
    )
  ) {
    reject();
  }
  return value;
}

function cookieValue(request) {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  return entries.length === 1 ? entries[0].slice(COOKIE_NAME.length + 1) : undefined;
}

function exactFields(params, names) {
  return (
    [...params.keys()].length === names.length &&
    names.every((name) => params.getAll(name).length === 1)
  );
}

async function readForm(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2048) reject();
    chunks.push(chunk);
  }
  return new URLSearchParams(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)),
  );
}

function renderPage(body, title = "Disposable candidate rights test") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

function writeResponse(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    Connection: "close",
    ...extraHeaders,
  });
  response.end(body);
}

/**
 * Human-only OAuth handoff. No browser automation, stored-session reading, or platform writes.
 * Test transport/verifier overrides are refused unless NODE_ENV=test.
 * onConfirmed owns its in-memory bundle; this module never writes it or invokes an operator.
 * closed/close() resolve {reason: confirmed|cancelled|timeout|failed|closed}. onClosed is notified
 * after close settles and is not awaited, so caller cleanup may safely call close() again.
 */
export async function startCandidateRightsSession(options) {
  return startSession(options, RIGHTS_PROFILE);
}

/** Separate fixed-purpose handoff; it cannot authorize candidate-rights account deletion. */
export async function startD2WorkloadSession(options) {
  if (
    !options ||
    ["profile", "purpose", "scopes", "scope", "callback", "redirectUri"].some((key) =>
      Object.hasOwn(options, key),
    )
  )
    reject();
  return startSession(options, WORKLOAD_PROFILE);
}

async function startSession(options, profile) {
  const page = (body) =>
    renderPage(
      body,
      profile === WORKLOAD_PROFILE ? "D2 disposable contribution workload" : undefined,
    );
  const errorMessage =
    profile === WORKLOAD_PROFILE
      ? "D2 workload sign-in could not be completed. Start a fresh session."
      : ERROR_MESSAGE;
  if (!options || typeof options !== "object") reject();
  validateConfiguration(options);
  const { issuer, audience, clientId, onConfirmed, onClosed, onDiagnostic } = options;
  if (onConfirmed !== undefined && typeof onConfirmed !== "function") reject();
  if (onClosed !== undefined && typeof onClosed !== "function") reject();
  if (onDiagnostic !== undefined && typeof onDiagnostic !== "function") reject();
  if (
    (options.verifyTokens ||
      options.fetchImpl ||
      options.sessionTimeoutMs ||
      options.tokenTimeoutMs) &&
    process.env.NODE_ENV !== "test"
  ) {
    reject();
  }
  const timeoutMs = options.sessionTimeoutMs ?? CANDIDATE_RIGHTS_SESSION_TIMEOUT_MS;
  const tokenTimeoutMs = options.tokenTimeoutMs ?? CANDIDATE_RIGHTS_TOKEN_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CANDIDATE_RIGHTS_SESSION_TIMEOUT_MS ||
    !Number.isSafeInteger(tokenTimeoutMs) ||
    tokenTimeoutMs < 1 ||
    tokenTimeoutMs > CANDIDATE_RIGHTS_TOKEN_TIMEOUT_MS
  )
    reject();
  const fetchImpl = options.fetchImpl ?? fetch;
  const verifyTokens = options.verifyTokens ?? defaultTokenVerifier;
  const startedAt = Date.now();
  let phase = "ready";
  let browserBound = false;
  let secrets = {
    clientSecret: options.clientSecret,
    cookie: randomBytes(32).toString("base64url"),
    csrf: randomBytes(32).toString("base64url"),
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
  };
  options = undefined;
  let pending;
  let expiryTimer;
  let closePromise;
  const cancellation = new AbortController();
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      const diagnostic =
        error instanceof CandidateRightsSessionError && REQUEST_DIAGNOSTICS.has(error.diagnostic)
          ? error.diagnostic
          : "unexpected_local_error";
      // Fixed local codes only: never forward request headers, URLs or exception messages.
      void Promise.resolve()
        .then(() => onDiagnostic?.(diagnostic))
        .catch(() => {});
      if (!response.headersSent)
        writeResponse(
          response,
          400,
          page(`<p>${errorMessage}</p><p>Diagnostic: ${diagnostic}</p>`),
        );
      else response.end();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });

  function close(reason = "closed") {
    if (closePromise) return closePromise;
    if (!["confirmed", "cancelled", "timeout", "failed", "closed"].includes(reason))
      reason = "closed";
    phase = "closed";
    secrets = undefined;
    pending = undefined;
    cancellation.abort();
    clearTimeout(expiryTimer);
    closePromise = new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }).then(() => {
      const result = Object.freeze({ reason });
      resolveClosed(result);
      void Promise.resolve()
        .then(() => onClosed?.(result))
        .catch(() => {});
      return result;
    });
    return closePromise;
  }

  const transactionCookie = (value, maxAge = 900) =>
    `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  // Chromium applies form-action to the complete redirect chain. Allow only this issuer on the
  // page containing the sign-in form and its redirect, never on account confirmation pages.
  const authorizationCsp = `default-src 'none'; form-action 'self' ${new URL(issuer).origin}; base-uri 'none'; frame-ancestors 'none'`;

  async function exchange(code) {
    const tokenAbort = new AbortController();
    const signal = AbortSignal.any([cancellation.signal, tokenAbort.signal]);
    const timer = setTimeout(() => tokenAbort.abort(), tokenTimeoutMs);
    try {
      const response = await abortable(
        fetchImpl(new URL("oauth/token", issuer), {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: secrets.clientSecret,
            code,
            redirect_uri: CANDIDATE_RIGHTS_SESSION_CALLBACK,
            code_verifier: secrets.verifier,
          }).toString(),
        }),
        signal,
      );
      if (
        response.status !== 200 ||
        response.redirected ||
        !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")
      )
        reject();
      const tokens = tokenResponse(
        await readBounded(response.body, CANDIDATE_RIGHTS_TOKEN_MAXIMUM_BYTES, signal),
        profile,
      );
      const verified = await abortable(
        verifyTokens({
          issuer,
          audience,
          clientId,
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
        }),
        signal,
      );
      if (signal.aborted || !secrets || phase !== "exchanging") reject();
      return validateVerifiedTokens(
        tokens,
        verified,
        {
          issuer,
          audience,
          clientId,
          nonce: secrets.nonce,
          startedAt,
        },
        profile,
      );
    } finally {
      tokenAbort.abort();
      clearTimeout(timer);
    }
  }

  async function handle(request, response) {
    const hosts = request.rawHeaders.filter(
      (_value, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === "host",
    );
    if (
      hosts.length !== 1 ||
      request.headers.host !== "localhost:3000" ||
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress) ||
      !request.url ||
      request.url.length > 8192 ||
      !request.url.startsWith("/") ||
      request.url.startsWith("//")
    )
      reject("request_boundary_rejected");
    const url = new URL(request.url, CANDIDATE_RIGHTS_SESSION_ORIGIN);
    if (url.origin !== CANDIDATE_RIGHTS_SESSION_ORIGIN || url.hash) reject();
    if (!secrets || ["closed", "confirmed", "failed"].includes(phase)) {
      writeResponse(
        response,
        410,
        page("<p>This sign-in session is closed. Return to the operator.</p>"),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/" && !url.search) {
      if (browserBound && !equalSecret(cookieValue(request), secrets.cookie))
        reject(cookieValue(request) === undefined ? "root_cookie_missing" : "root_cookie_mismatch");
      if (phase !== "ready") {
        if (!equalSecret(cookieValue(request), secrets.cookie)) reject();
        if (phase === "confirm") {
          writeResponse(
            response,
            200,
            page(
              profile === WORKLOAD_PROFILE
                ? `<p>Verified account: <strong>${escapeHtml(pending.label)}</strong></p><p>Exact account ID: ${escapeHtml(pending.subject)}</p><p>One Mintlify workload: Backend Engineer, https://jobs.ashbyhq.com/Mintlify/4da2f7a2-3d5a-4652-bf01-aed59f4cb72b. The operator creates one contribution, withdraws it and revokes both contribution authorization grants used for its normal and conflicting-idempotency checks. No publication or account deletion is authorized. Never use your main or appeal/reviewer account.</p><form method="post" action="/confirm"><input type="hidden" name="csrf" value="${secrets.csrf}"><label>Your name as the authorized test owner <input name="authorizedOwner" required maxlength="100" autocomplete="off"></label><p><label><input type="checkbox" name="disposable" value="yes" required> I authorize this disposable account for this single Mintlify contribution workload, withdrawal and revocation of both test grants only, not account deletion or publication.</label></p><button type="submit">Use this disposable account</button></form><form method="post" action="/cancel"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Cancel without running tests</button></form>`
                : `<p>Verified account: <strong>${escapeHtml(pending.label)}</strong></p><p>Exact account ID: ${escapeHtml(pending.subject)}</p><p>This test permanently deletes this account and its candidate data. Never use your main account, a real candidate, or the appeal/reviewer account.</p><form method="post" action="/confirm"><input type="hidden" name="csrf" value="${secrets.csrf}"><label>Your name as the authorized test owner <input name="authorizedOwner" required maxlength="100" autocomplete="off"></label><p><label><input type="checkbox" name="disposable" value="yes" required> I authorize only this disposable account, containing generated synthetic data only, for the rights test and permanent deletion. It is not my main or appeal/reviewer account.</label></p><button type="submit">Use this disposable account</button></form><form method="post" action="/cancel"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Cancel without running tests</button></form>`,
            ),
            { "Referrer-Policy": "same-origin" },
          );
          return;
        }
        writeResponse(
          response,
          200,
          page("<p>Sign-in is in progress. Finish the Auth0 window or close this helper.</p>"),
        );
        return;
      }
      browserBound = true;
      writeResponse(
        response,
        200,
        page(
          profile === WORKLOAD_PROFILE
            ? `<p>Sign in yourself using the approved disposable candidate account for one Mintlify contribution workload, withdrawal and revocation of both test grants. No account deletion or publication is authorized. No test starts until you explicitly confirm the verified account.</p><form method="post" action="/authorize"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Sign in with fresh MFA</button></form><form method="post" action="/cancel"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Cancel</button></form>`
            : `<p>Sign in yourself using a disposable candidate account. No test data is created and nothing is deleted until you explicitly confirm the verified account.</p><form method="post" action="/authorize"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Sign in with fresh MFA</button></form><form method="post" action="/cancel"><input type="hidden" name="csrf" value="${secrets.csrf}"><button type="submit">Cancel</button></form>`,
        ),
        {
          "Set-Cookie": transactionCookie(secrets.cookie),
          "Content-Security-Policy": authorizationCsp,
          // no-referrer makes native form POST Origin null (Fetch Standard 3.2).
          // Preserve the exact-origin check; never send referrers cross-origin.
          "Referrer-Policy": "same-origin",
        },
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/callback") {
      if (
        phase !== "authorizing" ||
        !equalSecret(cookieValue(request), secrets.cookie) ||
        url.searchParams.getAll("state").length !== 1 ||
        !equalSecret(url.searchParams.get("state"), secrets.state)
      )
        reject();
      if (url.searchParams.has("error")) {
        const keys = [...url.searchParams.keys()];
        if (
          !keys.every((key) => ["error", "error_description", "state"].includes(key)) ||
          keys.some((key) => url.searchParams.getAll(key).length !== 1)
        )
          reject();
        phase = "failed";
        writeResponse(
          response,
          400,
          page("<p>Sign-in was cancelled or declined. No test was started.</p>"),
          { "Set-Cookie": transactionCookie("", 0) },
        );
        response.once("finish", () => {
          void close("cancelled");
        });
        return;
      }
      if (!exactFields(url.searchParams, ["code", "state"])) reject();
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || hasControlCharacters(code, true)) reject();
      phase = "exchanging";
      try {
        pending = await exchange(code);
        phase = "confirm";
        secrets.state = "";
        secrets.nonce = "";
        secrets.verifier = "";
        secrets.clientSecret = "";
        secrets.csrf = randomBytes(32).toString("base64url");
        writeResponse(response, 303, "", { Location: "/" });
      } catch {
        phase = "failed";
        pending = undefined;
        writeResponse(response, 400, page(`<p>${errorMessage}</p>`), {
          "Set-Cookie": transactionCookie("", 0),
        });
        response.once("finish", () => {
          void close("failed");
        });
      }
      return;
    }
    if (
      request.method !== "POST" ||
      url.search ||
      !["/authorize", "/confirm", "/cancel"].includes(url.pathname)
    )
      reject();
    if (
      request.headers.origin !== CANDIDATE_RIGHTS_SESSION_ORIGIN ||
      request.headers["content-type"] !== "application/x-www-form-urlencoded" ||
      !equalSecret(cookieValue(request), secrets.cookie)
    )
      reject();
    const form = await readForm(request);
    if (
      !secrets ||
      !equalSecret(form.get("csrf"), secrets.csrf) ||
      form.getAll("csrf").length !== 1
    )
      reject();
    if (url.pathname === "/cancel") {
      if (!exactFields(form, ["csrf"])) reject();
      phase = "failed";
      writeResponse(response, 200, page("<p>Cancelled. No test was started.</p>"), {
        "Set-Cookie": transactionCookie("", 0),
      });
      response.once("finish", () => {
        void close("cancelled");
      });
      return;
    }
    if (url.pathname === "/authorize") {
      if (phase !== "ready" || !exactFields(form, ["csrf"])) reject();
      phase = "authorizing";
      const target = new URL("authorize", issuer);
      target.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: CANDIDATE_RIGHTS_SESSION_CALLBACK,
        audience,
        scope: profile.scopes,
        state: secrets.state,
        nonce: secrets.nonce,
        code_challenge: createHash("sha256").update(secrets.verifier).digest("base64url"),
        code_challenge_method: "S256",
        prompt: "login",
        max_age: "0",
        acr_values: MFA_ACR,
      }).toString();
      secrets.csrf = randomBytes(32).toString("base64url");
      writeResponse(response, 303, "", {
        Location: target.href,
        "Content-Security-Policy": authorizationCsp,
      });
      return;
    }
    if (
      phase !== "confirm" ||
      !pending ||
      !exactFields(form, ["csrf", "authorizedOwner", "disposable"]) ||
      form.get("disposable") !== "yes"
    )
      reject();
    const owner = form.get("authorizedOwner").normalize("NFKC").trim();
    if (
      !owner ||
      owner.length > 100 ||
      hasControlCharacters(owner) ||
      /zach\s*becker/iu.test(owner) ||
      Date.parse(pending.expiresAt) <= Date.now() + profile.minimumLifetimeSeconds * 1000 ||
      Date.parse(pending.authTime) < Date.now() - 900_000
    )
      reject();
    const { label: _label, ...bundle } = pending;
    phase = "confirmed";
    pending = undefined;
    secrets = undefined;
    clearTimeout(expiryTimer);
    writeResponse(
      response,
      200,
      page(
        "<p>Disposable account confirmed. Return to the operator window. This sign-in helper has not created or deleted any candidate data.</p>",
      ),
      { "Set-Cookie": transactionCookie("", 0) },
    );
    response.once("finish", () => {
      void Promise.resolve()
        .then(() => onConfirmed?.(Object.freeze({ ...bundle, authorizedOwner: owner })))
        .then(
          () => close("confirmed"),
          () => close("failed"),
        );
    });
  }

  try {
    await new Promise((resolve, rejectListen) => {
      server.once("error", rejectListen);
      server.listen({ host: "127.0.0.1", port: 3000, exclusive: true }, resolve);
    });
  } catch {
    secrets = undefined;
    pending = undefined;
    cancellation.abort();
    reject();
  }
  server.on("error", () => {
    void close("failed");
  });
  expiryTimer = setTimeout(() => {
    void close("timeout");
  }, timeoutMs);
  return Object.freeze({ url: CANDIDATE_RIGHTS_SESSION_ORIGIN, close, closed });
}
