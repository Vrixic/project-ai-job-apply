import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  CANDIDATE_RIGHTS_SESSION_CALLBACK,
  CANDIDATE_RIGHTS_SESSION_ORIGIN,
  CANDIDATE_RIGHTS_SESSION_SCOPES,
  CandidateRightsSessionError,
  parseCandidateRightsEnvironment,
  startCandidateRightsSession,
} from "../lib/candidate-rights-session.mjs";

// Entirely generated identities, credentials and provider responses; no external requests.
const issuer = "https://candidate-session.example.test/";
const audience = "ai-job-apply-api";
const clientId = "synthetic_candidate_client_000001";
const clientSecret = "SYNTHETIC_CLIENT_SECRET_NEVER_RENDER";
const refreshToken = "SYNTHETIC_REFRESH_TOKEN_NEVER_RENDER";
const subject = "auth0|synthetic-disposable-only";
const owner = "Synthetic test owner";
const failure = "Candidate rights sign-in could not be completed. Start a fresh session.";

for (const [name, overrides, expected] of [
  [
    "transport",
    {
      fetchResponse: () => {
        throw new Error("PRIVATE_PROVIDER_DETAIL");
      },
    },
    "token_transport_failed",
  ],
  [
    "response",
    { fetchResponse: () => new Response("PRIVATE_PROVIDER_DETAIL", { status: 503 }) },
    "token_response_rejected",
  ],
  [
    "verification",
    {
      options: {
        verifyTokens: () => {
          throw new Error("PRIVATE_PROVIDER_DETAIL");
        },
      },
    },
    "token_verification_failed",
  ],
  [
    "deadline",
    { fetchResponse: () => new Promise(() => {}), options: { tokenTimeoutMs: 25 } },
    "token_exchange_timeout",
  ],
]) {
  test(`callback ${name} exposes only a fixed diagnostic to browser and operator`, async (t) => {
    const diagnostics = [];
    const f = await fixture(t, {
      ...overrides,
      options: { ...overrides.options, onDiagnostic: (code) => diagnostics.push(code) },
    });
    await f.authorize();
    const response = await f.callback();
    assert.equal(response.status, 400);
    assert.match(response.body, new RegExp(`Diagnostic: ${expected}`, "u"));
    assert.doesNotMatch(response.body, /PRIVATE_PROVIDER_DETAIL|SYNTHETIC/u);
    assert.deepEqual(diagnostics, [expected]);
    assert.equal(f.results.length, 0);
    assert.deepEqual(await f.session.closed, { reason: "failed" });
  });
}
const syntheticEnvironment = [
  "AUTH0_DOMAIN=candidate-session.example.test",
  `AUTH0_AUDIENCE=${audience}`,
  `AUTH0_CLIENT_ID=${clientId}`,
  `AUTH0_CLIENT_SECRET=${clientSecret}`,
  "UNRELATED_SETTING=not-session-configuration",
].join("\r\n");

test("environment parsing accepts a single leading UTF-8 BOM without promoting unrelated settings", () => {
  const plain = parseCandidateRightsEnvironment(syntheticEnvironment);
  const withBom = parseCandidateRightsEnvironment(`\uFEFF${syntheticEnvironment}`);
  assert.deepEqual(withBom, plain);
  assert.deepEqual(plain, { issuer, audience, clientId, clientSecret });
  assert.equal(Object.isFrozen(plain), true);
});

test("environment parsing preserves strict configuration validation and fixed safe errors", () => {
  const invalid = [
    undefined,
    {},
    "",
    `\uFEFF\uFEFF${syntheticEnvironment}`,
    syntheticEnvironment.replace(
      "candidate-session.example.test",
      "https://candidate-session.example.test",
    ),
    syntheticEnvironment.replace(
      "candidate-session.example.test",
      "candidate-session.example.test/path",
    ),
    syntheticEnvironment.replace(
      "candidate-session.example.test",
      "candidate-session.\uFEFFexample.test",
    ),
    `# Synthetic settings\r\n\uFEFF${syntheticEnvironment}`,
    syntheticEnvironment.replace(audience, "unrelated-api"),
    syntheticEnvironment.replace(clientId, "short"),
    syntheticEnvironment.replace(clientSecret, "short"),
  ];
  for (const environment of invalid) {
    assert.throws(
      () => parseCandidateRightsEnvironment(environment),
      (error) => {
        assert.equal(error instanceof CandidateRightsSessionError, true);
        assert.equal(error.message, failure);
        assert.equal(error.message.includes(clientSecret), false);
        return true;
      },
    );
  }
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "synthetic-session-key",
  alg: "RS256",
  use: "sig",
};

function jwt(claims, header = { alg: "RS256", kid: jwk.kid, typ: "JWT" }) {
  const input = [header, claims]
    .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
    .join(".");
  return `${input}.${createSign("RSA-SHA256").update(input).sign(privateKey).toString("base64url")}`;
}

function claims(nonce) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access: {
      iss: issuer,
      sub: subject,
      aud: audience,
      exp: now + 600,
      iat: now,
      azp: clientId,
      scope: CANDIDATE_RIGHTS_SESSION_SCOPES,
    },
    id: {
      iss: issuer,
      sub: subject,
      aud: clientId,
      exp: now + 600,
      iat: now,
      auth_time: now,
      amr: ["pwd", "mfa"],
      nonce,
      azp: clientId,
      email: "synthetic-candidate@example.test",
    },
  };
}

function http(
  path = "/",
  { method = "GET", cookie, origin, form, host = "localhost:3000", headers = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const body =
      form === undefined
        ? undefined
        : typeof form === "string"
          ? form
          : new URLSearchParams(form).toString();
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path,
        method,
        headers: {
          Host: host,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(origin ? { Origin: origin } : {}),
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
              }),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function csrf(response) {
  return /name="csrf" value="([A-Za-z0-9_-]+)"/u.exec(response.body)?.[1];
}

async function fixture(t, overrides = {}) {
  const oldMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const results = [];
  const requests = [];
  const responses = [];
  let authorization;
  let tokenClaims;
  let issued;
  const makeResponse = () => {
    tokenClaims = claims(authorization.searchParams.get("nonce"));
    overrides.mutateClaims?.(tokenClaims);
    issued = {
      access_token: jwt(tokenClaims.access),
      id_token: jwt(tokenClaims.id),
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 600,
    };
    overrides.mutateTokens?.(issued);
    return new Response(JSON.stringify(issued), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const session = await startCandidateRightsSession({
    issuer,
    audience,
    clientId,
    clientSecret,
    verifyTokens: async () => ({
      accessPrincipal: {
        issuer: tokenClaims.access.iss,
        subject: tokenClaims.access.sub,
        scopes: tokenClaims.access.scope?.split(" "),
      },
      idProof: {
        issuer: tokenClaims.id.iss,
        subject: tokenClaims.id.sub,
        authenticatedAt: tokenClaims.id.auth_time,
        authenticationMethods: tokenClaims.id.amr,
      },
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return overrides.fetchResponse
        ? overrides.fetchResponse({ url, options, makeResponse })
        : makeResponse();
    },
    onConfirmed: async (bundle) => {
      results.push(bundle);
      await overrides.onConfirmed?.(bundle);
    },
    ...overrides.options,
  });
  t.after(async () => {
    await session.close();
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
  });
  const call = async (path, options) => {
    const response = await http(path, options);
    responses.push(response);
    return response;
  };
  const initial = await call("/");
  const cookie = initial.headers["set-cookie"][0].split(";")[0];
  const authorize = async () => {
    const response = await call("/authorize", {
      method: "POST",
      cookie,
      origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
      form: { csrf: csrf(initial) },
    });
    assert.equal(response.status, 303);
    authorization = new URL(response.headers.location);
    return authorization;
  };
  const callback = async (query) =>
    call(
      `/auth/callback?${query ?? new URLSearchParams({ code: "synthetic-code", state: authorization.searchParams.get("state") })}`,
      { cookie },
    );
  const ready = async () => {
    await authorize();
    assert.equal((await callback()).status, 303);
    return call("/", { cookie });
  };
  const confirm = async (response, extras = {}) =>
    call("/confirm", {
      method: "POST",
      cookie,
      origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
      form: { csrf: csrf(response), authorizedOwner: owner, disposable: "yes", ...extras },
    });
  return {
    session,
    initial,
    cookie,
    authorize,
    callback,
    ready,
    confirm,
    call,
    results,
    requests,
    responses,
    get issued() {
      return issued;
    },
  };
}

test("requested scopes exactly match the candidate web source, without contribution or reviewer expansion", () => {
  const source = readFileSync(new URL("../../frontend/web/lib/auth0.ts", import.meta.url), "utf8");
  assert.equal(
    /requestedAuthScopes\s*=\s*"([^"]+)"/u.exec(source)?.[1],
    CANDIDATE_RIGHTS_SESSION_SCOPES,
  );
  assert.equal(CANDIDATE_RIGHTS_SESSION_SCOPES.includes("jobs:contribute"), false);
  assert.equal(CANDIDATE_RIGHTS_SESSION_SCOPES.includes("trust:"), false);
});

test("local rejection diagnostics identify root binding without reflecting private input", async (t) => {
  const diagnostics = [];
  const f = await fixture(t, { options: { onDiagnostic: (code) => diagnostics.push(code) } });
  await f.authorize();
  for (const [options, code] of [
    [{}, "root_cookie_missing"],
    [{ cookie: `candidate_rights_operator_transaction=${clientSecret}` }, "root_cookie_mismatch"],
    [{ host: "wrong.example.test" }, "request_boundary_rejected"],
  ]) {
    const response = await f.call("/", options);
    assert.equal(response.status, 400);
    assert.equal(response.body.includes(code), true);
    assert.equal(response.body.includes(clientSecret), false);
    assert.equal(diagnostics.at(-1), code);
  }
  assert.equal(new CandidateRightsSessionError(clientSecret).diagnostic, "request_rejected");
  assert.equal(f.requests.length, 0);
  assert.equal(f.results.length, 0);
  assert.equal((await f.call("/", { cookie: f.cookie })).status, 200);
});

test("ready root rebinds a new browser, rotates old form credentials and preserves same-browser reload", async (t) => {
  const f = await fixture(t);
  const replacement = await f.call("/");
  assert.equal(replacement.status, 200);
  const replacementCookie = replacement.headers["set-cookie"][0].split(";")[0];
  assert.notEqual(replacementCookie, f.cookie);
  assert.notEqual(csrf(replacement), csrf(f.initial));
  const reload = await f.call("/", { cookie: replacementCookie });
  assert.equal(csrf(reload), csrf(replacement));
  assert.equal(reload.headers["set-cookie"][0].split(";")[0], replacementCookie);
  for (const [cookie, formToken] of [
    [f.cookie, csrf(f.initial)],
    [replacementCookie, csrf(f.initial)],
  ]) {
    assert.equal(
      (
        await f.call("/authorize", {
          method: "POST",
          cookie,
          origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
          form: { csrf: formToken },
        })
      ).status,
      400,
    );
  }
  const mismatch = await f.call("/", { cookie: "candidate_rights_operator_transaction=stale" });
  assert.equal(mismatch.status, 200);
  const latestCookie = mismatch.headers["set-cookie"][0].split(";")[0];
  assert.notEqual(latestCookie, replacementCookie);
  assert.notEqual(csrf(mismatch), csrf(replacement));
  assert.equal(
    (
      await f.call("/authorize", {
        method: "POST",
        cookie: latestCookie,
        origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
        form: { csrf: csrf(mismatch) },
      })
    ).status,
    303,
  );
  assert.equal((await f.call("/")).status, 400);
  assert.equal((await f.call("/", { cookie: replacementCookie })).status, 400);
  assert.equal((await f.call("/", { cookie: latestCookie })).status, 200);
  assert.equal(f.requests.length, 0);
  assert.equal(f.results.length, 0);
});

test("rights confirmation retains verified ID expiry separately from access admission", async (t) => {
  const f = await fixture(t, {
    mutateClaims: ({ access, id }) => {
      id.exp = access.exp + 35_400;
    },
  });
  assert.equal((await f.confirm(await f.ready())).status, 200);
  const access = JSON.parse(Buffer.from(f.issued.access_token.split(".")[1], "base64url"));
  const id = JSON.parse(Buffer.from(f.issued.id_token.split(".")[1], "base64url"));
  assert.equal(Date.parse(f.results[0].expiresAt), access.exp * 1000);
  assert.equal(Date.parse(f.results[0].idTokenExpiresAt), id.exp * 1000);
  assert.equal(id.exp - access.exp, 35_400);
});

test("normal S256 OAuth code exchange resolves only after same-browser explicit disposable confirmation", async (t) => {
  const f = await fixture(t);
  const auth = await f.authorize();
  assert.equal(f.session.url, CANDIDATE_RIGHTS_SESSION_ORIGIN);
  assert.equal(auth.origin, new URL(issuer).origin);
  assert.equal(auth.pathname, "/authorize");
  assert.equal(auth.searchParams.get("redirect_uri"), CANDIDATE_RIGHTS_SESSION_CALLBACK);
  assert.equal(auth.searchParams.get("scope"), CANDIDATE_RIGHTS_SESSION_SCOPES);
  for (const [key, value] of Object.entries({
    response_type: "code",
    prompt: "login",
    max_age: "0",
    code_challenge_method: "S256",
  }))
    assert.equal(auth.searchParams.get(key), value);
  assert.match(auth.searchParams.get("acr_values"), /multi-factor$/u);
  for (const name of ["state", "nonce", "code_challenge"])
    assert.match(auth.searchParams.get(name), /^[A-Za-z0-9_-]{43}$/u);
  assert.equal((await f.callback()).status, 303);
  const preview = await f.call("/", { cookie: f.cookie });
  assert.equal(f.results.length, 0);
  assert.match(preview.body, /permanently deletes this account/u);
  assert.match(preview.body, /synthetic-candidate@example\.test/u);
  assert.equal(f.initial.headers["content-security-policy"].includes(new URL(issuer).origin), true);
  assert.equal(preview.headers["content-security-policy"].includes(new URL(issuer).origin), false);
  const exchange = f.requests[0];
  assert.equal(exchange.url, `${issuer}oauth/token`);
  assert.equal(exchange.options.redirect, "error");
  const form = new URLSearchParams(exchange.options.body);
  assert.equal(form.get("client_secret"), clientSecret);
  assert.equal(form.get("redirect_uri"), CANDIDATE_RIGHTS_SESSION_CALLBACK);
  assert.equal(
    createHash("sha256").update(form.get("code_verifier")).digest("base64url"),
    auth.searchParams.get("code_challenge"),
  );
  assert.equal((await f.confirm(preview)).status, 200);
  assert.equal((await f.session.closed).reason, "confirmed");
  assert.equal(f.results.length, 1);
  assert.equal(f.results[0].subject, subject);
  assert.equal(f.results[0].issuer, issuer);
  assert.equal(f.results[0].authorizedOwner, owner);
  assert.equal(f.results[0].refreshToken, refreshToken);
  assert.equal(Object.hasOwn(f.results[0], "clientSecret"), false);
  assert.equal(Object.hasOwn(f.results[0], "label"), false);
  for (const response of f.responses) {
    const rendered = JSON.stringify(response);
    for (const secret of [clientSecret, refreshToken, f.issued.access_token, f.issued.id_token])
      assert.equal(rendered.includes(secret), false);
    assert.match(response.headers["cache-control"], /no-store/u);
    assert.equal(
      response.headers["referrer-policy"],
      response.body.includes('<form method="post"') ? "same-origin" : "no-referrer",
    );
    assert.match(response.headers["content-security-policy"], /frame-ancestors 'none'/u);
  }
});

test("wrong callback state, duplicate state/code, wrong cookie and callback replay never exchange again", async (t) => {
  const f = await fixture(t);
  const auth = await f.authorize();
  const state = auth.searchParams.get("state");
  for (const query of [
    `code=x&state=wrong`,
    `code=x&state=${state}&state=${state}`,
    `code=x&code=y&state=${state}`,
    `code=x&state=${state}&unknown=y`,
  ])
    assert.equal((await f.callback(query)).status, 400);
  assert.equal((await f.call(`/auth/callback?code=x&state=${state}`)).status, 400);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.callback()).status, 303);
  assert.equal((await f.callback()).status, 400);
  assert.equal(f.requests.length, 1);
  assert.equal(f.results.length, 0);
});

test("form pages preserve same-origin POSTs while null origins still fail closed", async (t) => {
  const f = await fixture(t);
  assert.equal(f.initial.headers["referrer-policy"], "same-origin");
  const rejected = await f.call("/authorize", {
    method: "POST",
    cookie: f.cookie,
    origin: "null",
    form: { csrf: csrf(f.initial) },
  });
  assert.equal(rejected.status, 400);
  assert.equal(f.requests.length, 0);
  const preview = await f.ready();
  assert.equal(preview.headers["referrer-policy"], "same-origin");
  assert.equal(
    (
      await f.call("/confirm", {
        method: "POST",
        cookie: f.cookie,
        origin: "null",
        form: { csrf: csrf(preview), authorizedOwner: owner, disposable: "yes" },
      })
    ).status,
    400,
  );
  assert.equal(f.results.length, 0);
  assert.equal((await f.confirm(preview)).status, 200);
});

test("no confirmation before sign-in, from another origin/browser, or with a stale/missing CSRF", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/", { cookie: f.cookie })).status, 200);
  assert.equal((await f.confirm(f.initial)).status, 400);
  const preview = await f.ready();
  assert.equal((await f.call("/")).status, 400);
  const form = { csrf: csrf(preview), authorizedOwner: owner, disposable: "yes" };
  for (const opts of [
    {},
    { cookie: "wrong=x", origin: CANDIDATE_RIGHTS_SESSION_ORIGIN },
    { cookie: f.cookie, origin: "https://attacker.example.test" },
    { cookie: f.cookie },
  ])
    assert.equal((await f.call("/confirm", { method: "POST", form, ...opts })).status, 400);
  for (const value of ["", "wrong", csrf(f.initial)])
    assert.equal((await f.confirm(preview, { csrf: value })).status, 400);
  assert.equal(f.results.length, 0);
});

test("confirmation requires an exact generated-only checkbox and a bounded non-prohibited owner", async (t) => {
  const f = await fixture(t);
  const preview = await f.ready();
  for (const authorizedOwner of [
    "",
    " ",
    "Zach Becker",
    "Ｚａｃｈ Ｂｅｃｋｅｒ",
    "Zach\tBecker",
    "Zach\u200b Becker",
    "x".repeat(101),
    "Synthetic\u0000owner",
  ])
    assert.equal((await f.confirm(preview, { authorizedOwner })).status, 400);
  assert.equal((await f.confirm(preview, { disposable: "no" })).status, 400);
  assert.equal((await f.confirm(preview, { unknown: "field" })).status, 400);
  assert.equal(f.results.length, 0);
});

test("exact Host, path, method, form origin and body size are enforced", async (t) => {
  const f = await fixture(t);
  for (const host of [
    "127.0.0.1:3000",
    "localhost:3000.attacker.test",
    "attacker.test",
    "localhost",
  ])
    assert.equal((await f.call("/", { host })).status, 400);
  for (const path of ["//attacker.test/", "http://attacker.test/", "/unknown", "/?arbitrary=1"])
    assert.equal((await f.call(path)).status, 400);
  assert.equal((await f.call("/authorize", { method: "GET" })).status, 400);
  assert.equal(
    (
      await f.call("/authorize", {
        method: "POST",
        cookie: f.cookie,
        origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
        form: `csrf=${csrf(f.initial)}&padding=${"x".repeat(2050)}`,
      })
    ).status,
    400,
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.results.length, 0);
});

for (const [name, mutateClaims] of Object.entries({
  nonce: ({ id }) => {
    id.nonce = "wrong";
  },
  missingNonce: ({ id }) => {
    delete id.nonce;
  },
  subject: ({ access }) => {
    access.sub = "auth0|different-synthetic";
  },
  issuer: ({ id }) => {
    id.iss = "https://wrong.example.test/";
  },
  audience: ({ id }) => {
    id.aud = [clientId, "other-client"];
  },
  accessAudience: ({ access }) => {
    access.aud = "wrong-api";
  },
  authorizedParty: ({ id }) => {
    id.azp = "other-client";
  },
  accessParty: ({ access }) => {
    access.azp = "other-client";
  },
  expired: ({ id }) => {
    id.exp = Math.floor(Date.now() / 1000) - 1;
  },
  accessExpiryMissing: ({ access }) => {
    delete access.exp;
  },
  missingMfa: ({ id }) => {
    id.amr = ["pwd"];
  },
  staleMfa: ({ id }) => {
    id.auth_time -= 1000;
  },
  priorTransactionMfa: ({ id }) => {
    id.auth_time -= 60;
  },
  futureMfa: ({ id }) => {
    id.auth_time += 60;
  },
  missingScope: ({ access }) => {
    access.scope = "openid";
  },
  extraReviewerScope: ({ access }) => {
    access.scope += " trust:appeal:resolve";
  },
})) {
  test(`rejects ${name} before any identity confirmation`, async (t) => {
    const f = await fixture(t, { mutateClaims });
    await f.authorize();
    const result = await f.callback();
    assert.equal(result.status, 400);
    assert.equal(result.body.includes(failure), true);
    assert.equal(f.results.length, 0);
    assert.equal((await f.session.closed).reason, "failed");
  });
}

test("missing refresh credentials fail before confirmation", async (t) => {
  const f = await fixture(t, {
    mutateTokens: (tokens) => {
      delete tokens.refresh_token;
    },
  });
  await f.authorize();
  assert.equal((await f.callback()).status, 400);
  assert.equal(f.results.length, 0);
});

test("private verified identity labels are HTML escaped", async (t) => {
  const f = await fixture(t, {
    mutateClaims: ({ id }) => {
      id.email = '<img src=x onerror="alert(1)">&';
    },
  });
  const preview = await f.ready();
  assert.equal(preview.body.includes("<img"), false);
  assert.match(preview.body, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;/u);
});

test("callback errors are fixed and non-reflecting; cancellation never calls onConfirmed", async (t) => {
  const f = await fixture(t);
  const auth = await f.authorize();
  const result = await f.callback(
    new URLSearchParams({
      state: auth.searchParams.get("state"),
      error: "access_denied",
      error_description: clientSecret,
    }).toString(),
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.includes(clientSecret), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.results.length, 0);
  assert.equal((await f.session.closed).reason, "cancelled");
});

test("explicit same-browser cancellation closes without exchange or confirmation", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("/cancel", {
        method: "POST",
        cookie: f.cookie,
        origin: CANDIDATE_RIGHTS_SESSION_ORIGIN,
        form: { csrf: csrf(f.initial) },
      })
    ).status,
    200,
  );
  assert.equal((await f.session.closed).reason, "cancelled");
  assert.equal(f.requests.length, 0);
  assert.equal(f.results.length, 0);
});

for (const [name, fetchResponse] of Object.entries({
  redirect: () =>
    new Response(null, { status: 302, headers: { Location: "https://attacker.example.test" } }),
  wrongContentType: () => new Response("{}", { status: 200 }),
  excessiveBody: () =>
    new Response("x".repeat(65_537), { headers: { "Content-Type": "application/json" } }),
  malformedJson: () => new Response("{", { headers: { "Content-Type": "application/json" } }),
  privateFailure: () => {
    throw new Error(clientSecret);
  },
})) {
  test(`bounded token transport refuses ${name}`, async (t) => {
    const f = await fixture(t, { fetchResponse });
    await f.authorize();
    const result = await f.callback();
    assert.equal(result.status, 400);
    assert.equal(result.body.includes(clientSecret), false);
    assert.equal(f.results.length, 0);
  });
}

test("whole token response deadline handles a transport that never resolves", async (t) => {
  const f = await fixture(t, {
    fetchResponse: () => new Promise(() => {}),
    options: { tokenTimeoutMs: 30 },
  });
  await f.authorize();
  assert.equal((await f.callback()).status, 400);
  assert.equal(f.results.length, 0);
});

test("whole token response deadline handles an endless body", async (t) => {
  const f = await fixture(t, {
    fetchResponse: () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      }),
    options: { tokenTimeoutMs: 30 },
  });
  await f.authorize();
  assert.equal((await f.callback()).status, 400);
  assert.equal(f.results.length, 0);
});

test("signature verification is covered by the same bounded deadline", async (t) => {
  const f = await fixture(t, {
    options: { tokenTimeoutMs: 30, verifyTokens: () => new Promise(() => {}) },
  });
  await f.authorize();
  assert.equal((await f.callback()).status, 400);
  assert.equal(f.results.length, 0);
});

test("closing during exchange aborts the request and cannot later confirm", async (t) => {
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const f = await fixture(t, {
    fetchResponse: ({ options }) => {
      markStarted(options.signal);
      return new Promise(() => {});
    },
  });
  await f.authorize();
  const response = f.callback().catch(() => undefined);
  const signal = await started;
  await f.session.close();
  await response;
  assert.equal(signal.aborted, true);
  assert.equal(f.results.length, 0);
});

test("session expiry closes the listener and never confirms", async (t) => {
  const f = await fixture(t, { options: { sessionTimeoutMs: 50 } });
  assert.equal((await f.session.closed).reason, "timeout");
  assert.equal(f.results.length, 0);
  await assert.rejects(http("/"));
});

test("onClosed cleanup can call close again without a promise cycle", async (t) => {
  let session;
  let notified;
  const notification = new Promise((resolve) => {
    notified = resolve;
  });
  const f = await fixture(t, {
    options: {
      onClosed: async (result) => {
        await session.close();
        notified(result.reason);
      },
    },
  });
  session = f.session;
  await session.close();
  assert.equal(await notification, "closed");
  assert.equal((await session.closed).reason, "closed");
});

test("confirmation callback fires once even if a second confirmation is attempted", async (t) => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, { onConfirmed: () => waiting });
  const preview = await f.ready();
  assert.equal((await f.confirm(preview)).status, 200);
  assert.equal((await f.confirm(preview)).status, 410);
  assert.equal(f.results.length, 1);
  release();
  assert.equal((await f.session.closed).reason, "confirmed");
});

test("production refuses verifier/transport overrides", async () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      startCandidateRightsSession({
        issuer,
        audience,
        clientId,
        clientSecret,
        verifyTokens: async () => ({}),
      }),
      CandidateRightsSessionError,
    );
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});

test("occupied callback port fails without attaching to or stopping another listener", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(3000, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      startCandidateRightsSession({ issuer, audience, clientId, clientSecret }),
      CandidateRightsSessionError,
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("default verifier uses the actual shared RS256/JWKS implementation", async (t) => {
  const originalFetch = globalThis.fetch;
  let tokenFactory;
  globalThis.fetch = async (url) => {
    if (String(url) === `${issuer}.well-known/jwks.json`)
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    if (String(url) === `${issuer}oauth/token`) return tokenFactory();
    throw new Error("Unexpected synthetic network destination");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const f = await fixture(t, { options: { verifyTokens: undefined, fetchImpl: undefined } });
  const auth = await f.authorize();
  tokenFactory = () => {
    const value = claims(auth.searchParams.get("nonce"));
    return new Response(
      JSON.stringify({
        access_token: jwt(value.access),
        id_token: jwt(value.id),
        refresh_token: refreshToken,
        token_type: "Bearer",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  assert.equal((await f.callback()).status, 303);
  const preview = await f.call("/", { cookie: f.cookie });
  assert.equal((await f.confirm(preview)).status, 200);
  assert.equal((await f.session.closed).reason, "confirmed");
  assert.equal(f.results.length, 1);
});

for (const mode of ["signature", "algorithm"]) {
  test(`default shared verifier rejects invalid ${mode} before displaying identity`, async (t) => {
    const originalFetch = globalThis.fetch;
    let tokenFactory;
    globalThis.fetch = async (url) => {
      if (String(url) === `${issuer}.well-known/jwks.json`)
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "Content-Type": "application/json" },
        });
      if (String(url) === `${issuer}oauth/token`) return tokenFactory();
      throw new Error("Unexpected synthetic network destination");
    };
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    const f = await fixture(t, { options: { verifyTokens: undefined, fetchImpl: undefined } });
    const auth = await f.authorize();
    tokenFactory = () => {
      const value = claims(auth.searchParams.get("nonce"));
      let idToken = jwt(value.id);
      if (mode === "signature") {
        const parts = idToken.split(".");
        parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
        idToken = parts.join(".");
      } else idToken = jwt(value.id, { alg: "HS256", kid: jwk.kid });
      return new Response(
        JSON.stringify({
          access_token: jwt(value.access),
          id_token: idToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await f.callback();
    assert.equal(result.status, 400);
    assert.equal(result.body.includes(subject), false);
    assert.equal(f.results.length, 0);
    assert.equal((await f.session.closed).reason, "failed");
  });
}
