import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import {
  NATIVE_RESUME_SESSION_PROFILE,
  NATIVE_RESUME_SESSION_SCOPES,
  startNativeResumeSession,
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
  const session = await startNativeResumeSession({
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
          scope: NATIVE_RESUME_SESSION_SCOPES,
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

test("native sign-in binds Applications scopes, PKCE and MFA without rights or contribution authority", async (t) => {
  const f = await fixture(t);
  assert.equal(f.authorization.searchParams.get("scope"), NATIVE_RESUME_SESSION_SCOPES);
  assert.match(NATIVE_RESUME_SESSION_SCOPES, /applications:read applications:write/u);
  assert.doesNotMatch(NATIVE_RESUME_SESSION_SCOPES, /offline_access|jobs:contribute/u);
  assert.equal(f.authorization.searchParams.get("code_challenge_method"), "S256");
  assert.match(f.authorization.searchParams.get("acr_values"), /multi-factor/u);
  assert.match(f.initial.body, /Native resume development test/u);
  assert.equal((await f.callback()).status, 303);
  const confirmation = await http("/", f.cookie);
  assert.match(confirmation.body, /generated synthetic data only/u);
  assert.match(
    confirmation.body,
    /cannot authorize account deletion or submission to an employer/u,
  );
  assert.doesNotMatch(confirmation.body, /permanently deletes|Mintlify/u);
  assert.equal(
    (
      await http("/confirm", f.cookie, {
        csrf: csrf(confirmation),
        authorizedOwner: "Synthetic test owner",
        disposable: "yes",
      })
    ).status,
    200,
  );
  await f.session.closed;
  assert.equal(f.confirmed.purpose, "native_resume_workload");
  assert.equal(f.confirmed.profile, NATIVE_RESUME_SESSION_PROFILE);
  assert.equal(Object.hasOwn(f.confirmed, "refreshToken"), false);
  assert.equal(Object.isFrozen(f.confirmed), true);
  assert.throws(() => buildIdentityAttestation(f.confirmed));
});

for (const scope of [
  "documents:read",
  "documents:write",
  "jobs:read",
  "profile:read",
  "profile:write",
  "applications:read",
  "applications:write",
]) {
  test(`native sign-in rejects missing ${scope}`, async (t) => {
    const f = await fixture(t, (claims) => {
      claims.access.scope = claims.access.scope
        .split(" ")
        .filter((s) => s !== scope)
        .join(" ");
    });
    const result = await f.callback();
    assert.equal(result.status, 400);
    assert.deepEqual(f.diagnostics, ["token_scopes_rejected"]);
    assert.equal(f.confirmed, undefined);
    assert.doesNotMatch(result.body, /SYNTHETIC|auth0\|synthetic/u);
    await f.session.closed;
  });
}
for (const [name, mutate] of Object.entries({
  extraScope: (c) => {
    c.access.scope += " jobs:contribute";
  },
  offlineScope: (c) => {
    c.access.scope += " offline_access";
  },
  missingMfa: (c) => {
    c.id.amr = ["pwd"];
  },
  shortAccess: (c) => {
    c.access.exp = Math.floor(Date.now() / 1000) + 1500;
  },
  wrongNonce: (c) => {
    c.id.nonce = "wrong";
  },
  wrongSubject: (c) => {
    c.access.sub = "auth0|other";
  },
  wrongAudience: (c) => {
    c.access.aud = "other";
  },
  refreshToken: (_c, extra) => {
    extra.refresh_token = "SYNTHETIC_REFRESH";
  },
})) {
  test(`native sign-in rejects ${name} without credential disclosure`, async (t) => {
    const f = await fixture(t, mutate);
    const result = await f.callback();
    assert.equal(result.status, 400);
    assert.equal(f.confirmed, undefined);
    assert.doesNotMatch(result.body, /SYNTHETIC|auth0\|synthetic/u);
    await f.session.closed;
  });
}
test("native purpose cannot be replaced by caller supplied scopes or redirect", async () => {
  for (const key of ["profile", "purpose", "scope", "scopes", "callback", "redirectUri"]) {
    await assert.rejects(startNativeResumeSession({ ...config, [key]: "arbitrary" }));
  }
});
