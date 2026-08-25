import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearerToken, createOidcVerifier } from "./index.js";
import { createTestTokenIssuer } from "./testing.js";

describe("authentication primitives", () => {
  it("requires a strict bearer header", () => {
    expect(bearerToken("Bearer token")).toBe("token");
    expect(() => bearerToken("Basic token")).toThrow();
  });

  it("verifies isolated test tokens", async () => {
    const issuer = await createTestTokenIssuer();
    const token = await issuer.issue("candidate-1", { email: "candidate@example.test" });
    const principal = await issuer.verifier.verify(token);
    expect(principal.subject).toBe("candidate-1");
    expect(principal.email).toBe("candidate@example.test");
  });
});

describe("managed OIDC verifier", () => {
  let server: Server;
  let issuer: string;
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let rotatedPrivateKey: CryptoKey;
  let ecPrivateKey: CryptoKey;
  let jwksAvailable = true;
  let publishedKeyIds = new Set(["primary", "rotated", "ec"]);
  let publishedKeys: JWK[] = [];

  beforeAll(async () => {
    const primary = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    const rotated = await generateKeyPair("RS256");
    const ec = await generateKeyPair("ES256");
    privateKey = primary.privateKey;
    otherPrivateKey = other.privateKey;
    rotatedPrivateKey = rotated.privateKey;
    ecPrivateKey = ec.privateKey;
    publishedKeys = [
      { ...(await exportJWK(primary.publicKey)), alg: "RS256", kid: "primary", use: "sig" },
      { ...(await exportJWK(rotated.publicKey)), alg: "RS256", kid: "rotated", use: "sig" },
      { ...(await exportJWK(ec.publicKey)), alg: "ES256", kid: "ec", use: "sig" },
    ];
    server = createServer((request, response) => {
      if (request.url === "/.well-known/jwks.json") {
        if (!jwksAvailable) {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "temporarily_unavailable" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            keys: publishedKeys.filter(
              (key) => typeof key.kid === "string" && publishedKeyIds.has(key.kid),
            ),
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("OIDC test server did not bind to a TCP port");
    }
    issuer = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function issue(options: {
    algorithm?: "RS256" | "ES256";
    audience?: string;
    authenticatedAt?: number;
    authenticationMethods?: unknown;
    expiresAt?: string;
    keyId?: string;
    signingKey?: CryptoKey;
    tokenIssuer?: string;
  }): Promise<string> {
    return new SignJWT({
      scope: "profile:read profile:write",
      ...(options.authenticatedAt ? { auth_time: options.authenticatedAt } : {}),
      ...(options.authenticationMethods ? { amr: options.authenticationMethods } : {}),
    })
      .setProtectedHeader({
        alg: options.algorithm ?? "RS256",
        kid: options.keyId ?? "primary",
      })
      .setIssuer(options.tokenIssuer ?? issuer)
      .setAudience(options.audience ?? "ai-job-apply-api")
      .setSubject("candidate-1")
      .setIssuedAt()
      .setExpirationTime(options.expiresAt ?? "5m")
      .sign(options.signingKey ?? privateKey);
  }

  it("accepts an exact RS256 issuer and audience", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    const principal = await verifier.verify(await issue({}));
    expect(principal.issuer).toBe(issuer);
    expect(principal.subject).toBe("candidate-1");
    expect(principal.scopes).toEqual(["profile:read", "profile:write"]);
  });

  it("projects only bounded standard recent-authentication evidence", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    const authenticatedAt = Math.floor(Date.now() / 1000) - 30;
    await expect(
      verifier.verify(
        await issue({ authenticatedAt, authenticationMethods: ["pwd", "mfa", "webauthn"] }),
      ),
    ).resolves.toMatchObject({
      authenticatedAt,
      authenticationMethods: ["pwd", "mfa", "webauthn"],
    });

    const malformed = await verifier.verify(
      await issue({ authenticatedAt, authenticationMethods: ["mfa", "not allowed"] }),
    );
    expect(malformed.authenticationMethods).toBeUndefined();
    const missing = await verifier.verify(await issue({}));
    expect(missing.authenticatedAt).toBeUndefined();
    expect(missing.authenticationMethods).toBeUndefined();
  });

  it("rejects wrong issuer, audience, expiry, and signature", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    await expect(
      verifier.verify(await issue({ tokenIssuer: "https://wrong.invalid/" })),
    ).rejects.toThrow();
    await expect(verifier.verify(await issue({ audience: "wrong-audience" }))).rejects.toThrow();
    await expect(verifier.verify(await issue({ expiresAt: "0s" }))).rejects.toThrow();
    await expect(verifier.verify(await issue({ signingKey: otherPrivateKey }))).rejects.toThrow();
  });

  it("rejects a token signed with an allowed-provider key but a disallowed algorithm", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    await expect(
      verifier.verify(
        await issue({
          algorithm: "ES256",
          keyId: "ec",
          signingKey: ecPrivateKey,
        }),
      ),
    ).rejects.toThrow();
  });

  it("continues through an overlapping signing-key rotation", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    await expect(verifier.verify(await issue({}))).resolves.toMatchObject({
      subject: "candidate-1",
    });

    publishedKeyIds = new Set(["rotated"]);
    await expect(
      verifier.verify(
        await issue({
          keyId: "rotated",
          signingKey: rotatedPrivateKey,
        }),
      ),
    ).resolves.toMatchObject({ subject: "candidate-1" });

    const restartedVerifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    await expect(
      restartedVerifier.verify(
        await issue({
          keyId: "rotated",
          signingKey: rotatedPrivateKey,
        }),
      ),
    ).resolves.toMatchObject({ subject: "candidate-1" });
    await expect(restartedVerifier.verify(await issue({}))).rejects.toThrow();

    publishedKeyIds = new Set(["primary", "rotated", "ec"]);
  });

  it("uses a cached signing key during a temporary JWKS outage and fails closed on cold start", async () => {
    const verifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    const token = await issue({});
    await expect(verifier.verify(token)).resolves.toMatchObject({ subject: "candidate-1" });

    jwksAvailable = false;
    await expect(verifier.verify(token)).resolves.toMatchObject({ subject: "candidate-1" });
    const coldVerifier = createOidcVerifier({ issuer, audience: "ai-job-apply-api" });
    await expect(coldVerifier.verify(token)).rejects.toThrow();
    jwksAvailable = true;
  });
});
