import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import {
  D2_WORKLOAD_SESSION_PROFILE,
  D2_WORKLOAD_SESSION_SCOPES,
  startD2WorkloadSession,
} from "../lib/candidate-rights-session.mjs";
import { buildIdentityAttestation } from "../lib/candidate-rights-session-operator.mjs";

const config = {
  issuer: "https://workload.example.test/",
  audience: "ai-job-apply-api",
  clientId: "synthetic_workload_client_001",
  clientSecret: "SYNTHETIC_WORKLOAD_CLIENT_SECRET",
};
function http(path, cookie, form) {
  return new Promise((resolve, reject) => {
    const body = form && new URLSearchParams(form).toString();
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path,
        method: form ? "POST" : "GET",
        headers: {
          Host: "localhost:3000",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(form
            ? {
                Origin: "http://localhost:3000",
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const csrf = (response) => /name="csrf" value="([^"]+)"/u.exec(response.body)?.[1];
const jwt = (value) => `e30.${Buffer.from(JSON.stringify(value)).toString("base64url")}.c2ln`;

async function fixture(t, mutate = () => {}, proofChanges = {}) {
  const oldMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  let authorization;
  let claims;
  let confirmed;
  const diagnostics = [];
  const session = await startD2WorkloadSession({
    ...config,
    onDiagnostic: (code) => diagnostics.push(code),
    fetchImpl: async (_url, options) => {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("redirect_uri"), "http://localhost:3000/auth/callback");
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.ok(form.get("code_verifier"));
      const now = Math.floor(Date.now() / 1000);
      claims = {
        access: {
          iss: config.issuer,
          sub: "auth0|synthetic-workload",
          aud: config.audience,
          azp: config.clientId,
          exp: now + 3600,
          scope: D2_WORKLOAD_SESSION_SCOPES,
        },
        id: {
          iss: config.issuer,
          sub: "auth0|synthetic-workload",
          aud: config.clientId,
          azp: config.clientId,
          exp: now + 3600,
          iat: now,
          auth_time: now,
          amr: ["mfa"],
          nonce: authorization.searchParams.get("nonce"),
        },
      };
      const extras = {};
      mutate(claims, extras);
      return new Response(
        JSON.stringify({
          access_token: jwt(claims.access),
          id_token: jwt(claims.id),
          token_type: "Bearer",
          ...extras,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
    verifyTokens: async () => ({
      accessPrincipal: {
        issuer: claims.access.iss,
        subject: claims.access.sub,
        scopes: claims.access.scope.split(" "),
      },
      idProof: {
        issuer: claims.id.iss,
        subject: claims.id.sub,
        authenticatedAt: claims.id.auth_time,
        authenticationMethods: claims.id.amr,
        ...proofChanges,
      },
    }),
    onConfirmed: (bundle) => {
      confirmed = bundle;
    },
  });
  t.after(async () => {
    await session.close();
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
  });
  const initial = await http("/");
  const cookie = initial.headers["set-cookie"][0].split(";")[0];
  const redirect = await http("/authorize", cookie, { csrf: csrf(initial) });
  authorization = new URL(redirect.headers.location);
  return {
    session,
    diagnostics,
    initial,
    cookie,
    authorization,
    get confirmed() {
      return confirmed;
    },
    callback: () =>
      http(
        `/auth/callback?${new URLSearchParams({ code: "synthetic-code", state: authorization.searchParams.get("state") })}`,
        cookie,
      ),
  };
}

test("D2 has fixed minimal scopes, same PKCE/MFA callback, no refresh token and a distinct confirmation purpose", async (t) => {
  const f = await fixture(t);
  assert.equal(
    f.authorization.searchParams.get("scope"),
    "openid profile email jobs:read jobs:contribute profile:write",
  );
  assert.equal(
    f.authorization.searchParams.get("redirect_uri"),
    "http://localhost:3000/auth/callback",
  );
  assert.equal(f.authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(f.authorization.searchParams.get("prompt"), "login");
  assert.equal(f.authorization.searchParams.get("max_age"), "0");
  assert.match(f.authorization.searchParams.get("acr_values"), /multi-factor/u);
  assert.match(f.initial.body, /D2 disposable contribution workload/u);
  assert.equal((await f.callback()).status, 303);
  const confirmation = await http("/", f.cookie);
  assert.match(confirmation.body, /Backend Engineer/u);
  assert.match(confirmation.body, /4da2f7a2-3d5a-4652-bf01-aed59f4cb72b/u);
  assert.match(confirmation.body, /No publication or account deletion is authorized/u);
  assert.doesNotMatch(confirmation.body, /permanently deletes|rights test/u);
  assert.equal(
    (
      await http("/confirm", f.cookie, {
        csrf: csrf(confirmation),
        authorizedOwner: "Synthetic owner",
        disposable: "yes",
      })
    ).status,
    200,
  );
  await f.session.closed;
  assert.equal(f.confirmed.purpose, "d2_workload");
  assert.equal(f.confirmed.profile, D2_WORKLOAD_SESSION_PROFILE);
  assert.equal(Object.hasOwn(f.confirmed, "refreshToken"), false);
  assert.equal(Object.isFrozen(f.confirmed), true);
  assert.throws(
    () => buildIdentityAttestation(f.confirmed),
    /disposable_identity_expired_or_unconfirmed/u,
  );
});

for (const [name, mutate] of Object.entries({
  missingContribution: (c) => {
    c.access.scope = c.access.scope.replace("jobs:contribute", "");
  },
  missingRead: (c) => {
    c.access.scope = c.access.scope.replace("jobs:read", "");
  },
  missingProfileWrite: (c) => {
    c.access.scope = c.access.scope.replace("profile:write", "");
  },
  rightsScope: (c) => {
    c.access.scope += " documents:write";
  },
  offlineScope: (c) => {
    c.access.scope += " offline_access";
  },
  reviewerScope: (c) => {
    c.access.scope += " trust:case:decide";
  },
  shortAccess: (c) => {
    c.access.exp = Math.floor(Date.now() / 1000) + 1500;
  },
  shortId: (c) => {
    c.id.exp = Math.floor(Date.now() / 1000) + 1200;
  },
  missingMfa: (c) => {
    c.id.amr = ["pwd"];
  },
  invalidAuthTime: (c) => {
    c.id.auth_time = "PRIVATE_AUTH_TIME";
  },
  futureAuthTime: (c) => {
    c.id.auth_time = Math.floor(Date.now() / 1000) + 60;
  },
  staleAuthTime: (c) => {
    c.id.auth_time = Math.floor(Date.now() / 1000) - 901;
  },
  predatesAuthTime: (c) => {
    c.id.auth_time = Math.floor(Date.now() / 1000) - 60;
  },
  wrongNonce: (c) => {
    c.id.nonce = "wrong";
  },
  wrongAudience: (c) => {
    c.access.aud = "wrong";
  },
  wrongClient: (c) => {
    c.access.azp = "wrong";
  },
  unexpectedRefresh: (_c, extras) => {
    extras.refresh_token = "SYNTHETIC_REFRESH";
  },
})) {
  test(`D2 rejects ${name} before confirming`, async (t) => {
    const f = await fixture(t, mutate);
    const result = await f.callback();
    assert.equal(result.status, 400);
    const expected = name.startsWith("short")
      ? "token_lifetime_insufficient"
      : name === "missingMfa"
        ? "token_mfa_method_missing"
        : name === "invalidAuthTime"
          ? "token_auth_time_invalid"
          : name === "futureAuthTime"
            ? "token_auth_time_future"
            : name === "staleAuthTime"
              ? "token_auth_time_stale"
              : name === "predatesAuthTime"
                ? "token_auth_time_predates_session"
                : name === "unexpectedRefresh"
                  ? "token_response_rejected"
                  : name.startsWith("wrong")
                    ? "token_claims_rejected"
                    : "token_scopes_rejected";
    assert.match(result.body, new RegExp(`Diagnostic: ${expected}`, "u"));
    assert.deepEqual(f.diagnostics, [expected]);
    assert.doesNotMatch(result.body, /SYNTHETIC|PRIVATE_AUTH_TIME|auth0\|synthetic-workload/u);
    assert.equal(f.confirmed, undefined);
    await f.session.closed;
  });
}

test("accepts an authentication time within the bounded clock-skew tolerance", async (t) => {
  // A local clock a few seconds behind the identity provider must not refuse a fresh sign-in.
  const f = await fixture(t, (c) => {
    c.id.auth_time = Math.floor(Date.now() / 1000) + 5;
    c.id.iat = c.id.auth_time + 1;
  });
  const result = await f.callback();
  assert.deepEqual(f.diagnostics, []);
  assert.equal(result.status, 303);
});

test("verified MFA proof disagreement emits only the fixed mismatch diagnostic", async (t) => {
  const f = await fixture(t, () => {}, { authenticatedAt: 1 });
  const result = await f.callback();
  assert.equal(result.status, 400);
  assert.match(result.body, /Diagnostic: token_auth_time_mismatch/u);
  assert.deepEqual(f.diagnostics, ["token_auth_time_mismatch"]);
  assert.equal(f.confirmed, undefined);
  await f.session.closed;
});

test("D2 refuses caller-selected profile, purpose, scopes or callback", async () => {
  for (const key of ["profile", "purpose", "scope", "scopes", "callback", "redirectUri"]) {
    await assert.rejects(startD2WorkloadSession({ ...config, [key]: "arbitrary" }));
  }
});

test("D2 rechecks the 25-minute token budget at human confirmation", async (t) => {
  const f = await fixture(t, (c) => {
    c.access.exp = Math.floor(Date.now() / 1000) + 1560;
  });
  assert.equal((await f.callback()).status, 303);
  const confirmation = await http("/", f.cookie);
  const originalNow = Date.now;
  const later = originalNow() + 61_000;
  Date.now = () => later;
  try {
    assert.equal(
      (
        await http("/confirm", f.cookie, {
          csrf: csrf(confirmation),
          authorizedOwner: "Synthetic owner",
          disposable: "yes",
        })
      ).status,
      400,
    );
    assert.equal(f.confirmed, undefined);
  } finally {
    Date.now = originalNow;
  }
});

test("D2 initial probe can hand off to the human browser only before authorization", async (t) => {
  const session = await startD2WorkloadSession(config);
  t.after(() => session.close());
  const probe = await http("/");
  const probeCookie = probe.headers["set-cookie"][0].split(";")[0];
  const human = await http("/");
  const humanCookie = human.headers["set-cookie"][0].split(";")[0];
  assert.equal(human.status, 200);
  assert.notEqual(humanCookie, probeCookie);
  assert.notEqual(csrf(human), csrf(probe));
  const reload = await http("/", humanCookie);
  assert.equal(csrf(reload), csrf(human));
  assert.equal(reload.headers["set-cookie"][0].split(";")[0], humanCookie);
  assert.equal((await http("/authorize", probeCookie, { csrf: csrf(probe) })).status, 400);
  assert.equal((await http("/authorize", humanCookie, { csrf: csrf(probe) })).status, 400);
  assert.equal((await http("/authorize", humanCookie, { csrf: csrf(human) })).status, 303);
  const absent = await http("/");
  assert.equal(absent.status, 400);
  assert.match(absent.body, /root_cookie_missing/u);
  assert.equal(absent.headers["set-cookie"], undefined);
  const mismatch = await http("/", probeCookie);
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body, /root_cookie_mismatch/u);
  assert.equal((await http("/", humanCookie)).status, 200);
});
