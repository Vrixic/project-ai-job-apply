import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeEvidenceBinding } from "./native-evidence-binding.js";
import { createNativeTaskCallerClient } from "./native-task-caller-client.js";
import {
  NATIVE_CALLER_CONTEXT_HEADER,
  NATIVE_CALLER_SIGNED_HEADERS,
  NATIVE_CALLER_STS_BODY,
  NATIVE_CALLER_STS_ORIGIN,
  nativeTaskCallerScope,
  validateNativeTaskCallerProof,
} from "./native-task-caller-contract.js";
import { createNativeTaskCallerVerifier } from "./native-task-caller-verifier.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const taskId = "a".repeat(32);
const targetArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-evidence:7";
const roleArn = "arn:aws:iam::123456789012:role/native/synthetic-material";
const requestSha256 = "b".repeat(64);
function binding(): NativeEvidenceBinding {
  return {
    scope: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      epochId: id(5),
    },
    allocation: {
      allocationId: id(1),
      ownerUserId: id(2),
      applicationId: id(3),
      generationId: id(4),
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${taskId}`,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
    original: {
      id: id(6),
      documentId: id(4),
      purpose: "provider_dispatch",
      requestSha256: "c".repeat(64),
    },
  };
}
const credentials = {
  accessKeyId: "ASIASYNTHETICEXAMPLE",
  secretAccessKey: "synthetic-secret-for-local-signing-only",
  sessionToken: "synthetic-token-for-local-signing-only",
};
const options = () => ({ binding: binding(), targetArn, enabled: () => true });
const proof = () =>
  createNativeTaskCallerClient({ ...options(), testCredentials: credentials }).proof(requestSha256);
function identityXml(overrides: { arn?: string; account?: string; userId?: string } = {}) {
  return `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>${overrides.arn ?? `arn:aws:sts::123456789012:assumed-role/synthetic-material/${taskId}`}</Arn><Account>${overrides.account ?? "123456789012"}</Account><UserId>${overrides.userId ?? `AROA12345678901234567:${taskId}`}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`;
}
const response = (xml = identityXml()) =>
  new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8" } });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("original native task caller proof", () => {
  it("uses only fixed task metadata credentials even when workstation credentials/profile are present", async () => {
    vi.stubEnv(
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "/v2/credentials/12345678-90ab-cdef-1234-567890abcdef",
    );
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAWORKSTATIONEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-workstation-secret-not-used");
    vi.stubEnv("AWS_PROFILE", "synthetic-workstation-profile-not-used");
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe("http://169.254.170.2/v2/credentials/12345678-90ab-cdef-1234-567890abcdef");
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      return Response.json({
        RoleArn: roleArn,
        AccessKeyId: credentials.accessKeyId,
        SecretAccessKey: "a".repeat(40),
        Token: credentials.sessionToken,
        Expiration: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      });
    });
    const signed = await createNativeTaskCallerClient(options()).proof(requestSha256);
    expect(signed.headers.authorization).toContain(credentials.accessKeyId);
    expect(signed.headers.authorization).not.toContain("WORKSTATION");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "absolute", "query", "traversal", "full-URI", "token-file"])(
    "refuses %s task credential source before I/O",
    async (kind) => {
      vi.stubEnv(
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        kind === "missing"
          ? undefined
          : kind === "absolute"
            ? "http://untrusted.invalid/credentials"
            : kind === "query"
              ? "/v2/credentials/12345678-90ab-cdef-1234-567890abcdef?token=synthetic"
              : kind === "traversal"
                ? "/v2/credentials/../synthetic"
                : "/v2/credentials/12345678-90ab-cdef-1234-567890abcdef",
      );
      if (kind === "full-URI")
        vi.stubEnv("AWS_CONTAINER_CREDENTIALS_FULL_URI", "http://untrusted.invalid/credentials");
      if (kind === "token-file")
        vi.stubEnv("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", "synthetic-token-file-not-read");
      const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("UnexpectedMetadata"));
      await expect(createNativeTaskCallerClient(options()).proof(requestSha256)).rejects.toThrow(
        "NativeTaskCallerUnavailable",
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    "account",
    "permanent-key",
    "bad-secret",
    "expired",
    "extra",
    "oversize",
    "denied",
    "exception",
  ])("refuses %s metadata credentials without fallback", async (kind) => {
    vi.stubEnv(
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "/v2/credentials/12345678-90ab-cdef-1234-567890abcdef",
    );
    const metadata: Record<string, unknown> = {
      RoleArn: roleArn,
      AccessKeyId: credentials.accessKeyId,
      SecretAccessKey: "a".repeat(40),
      Token: credentials.sessionToken,
      Expiration: new Date(Date.now() + 60_000).toISOString(),
    };
    if (kind === "account") metadata.RoleArn = roleArn.replace("123456789012", "222222222222");
    if (kind === "permanent-key") metadata.AccessKeyId = "AKIAWORKSTATIONEXAMPLE";
    if (kind === "bad-secret") metadata.SecretAccessKey = "synthetic-invalid-secret";
    if (kind === "expired") metadata.Expiration = new Date(Date.now() - 1000).toISOString();
    if (kind === "extra") metadata.Other = "synthetic-private-secret-not-logged";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (kind === "exception") throw Error("synthetic-private-secret-not-logged");
      if (kind === "denied")
        return new Response("synthetic-private-secret-not-logged", { status: 403 });
      if (kind === "oversize")
        return new Response("x".repeat(8193), { headers: { "content-type": "application/json" } });
      return Response.json(metadata);
    });
    await expect(createNativeTaskCallerClient(options()).proof(requestSha256)).rejects.toThrow(
      /^NativeTaskCallerUnavailable$/u,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("delegates signature authentication to AWS rather than accepting local shape checks", async () => {
    const signed = structuredClone(await proof());
    signed.headers.authorization =
      signed.headers.authorization?.replace(
        /Signature=[a-f0-9]{64}/u,
        `Signature=${"f".repeat(64)}`,
      ) ?? "";
    expect(
      validateNativeTaskCallerProof(
        signed,
        nativeTaskCallerScope(binding(), targetArn).digest(requestSha256),
        Date.now(),
      ),
    ).toBe(true);
    const testFetch = vi.fn(
      async () => new Response("SignatureDoesNotMatch", { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
        signed,
        requestSha256,
      ),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
    expect(testFetch).toHaveBeenCalledTimes(1);
  });
  it("has canonical detached scope independent of input property order", () => {
    const original = binding();
    const reversed = Object.fromEntries(
      Object.entries(original).reverse(),
    ) as unknown as NativeEvidenceBinding;
    expect(nativeTaskCallerScope(reversed, targetArn).digest(requestSha256)).toBe(
      nativeTaskCallerScope(original, targetArn).digest(requestSha256),
    );
  });
  it.each(["foreign-account", "foreign-region", "alias", "bad-role"])(
    "refuses %s configuration without network",
    (kind) => {
      if (kind === "bad-role")
        expect(() =>
          createNativeTaskCallerVerifier({
            ...options(),
            taskRoleArn: "arn:aws:iam::222222222222:role/material",
          }),
        ).toThrow("NativeTaskCallerUnavailable");
      else
        expect(() =>
          nativeTaskCallerScope(
            binding(),
            kind === "foreign-account"
              ? targetArn.replace("123456789012", "222222222222")
              : kind === "foreign-region"
                ? targetArn.replace("us-east-2", "us-west-2")
                : targetArn.replace(":7", ":development"),
          ),
        ).toThrow();
    },
  );
  it("rejects a proof which expires while the identity request is pending", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    const signed = await proof();
    const testFetch = vi.fn(async () => {
      vi.setSystemTime(new Date("2026-10-06T20:01:00.000Z"));
      return response();
    }) as unknown as typeof fetch;
    await expect(
      createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
        signed,
        requestSha256,
      ),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
  });
  it("rejects duplicate empty identity containers", async () => {
    const signed = await proof();
    const xml = identityXml().replace(
      "</GetCallerIdentityResponse>",
      "<GetCallerIdentityResult/></GetCallerIdentityResponse>",
    );
    await expect(
      createNativeTaskCallerVerifier({
        ...options(),
        taskRoleArn: roleArn,
        testFetch: vi.fn(async () => response(xml)) as unknown as typeof fetch,
      }).verify(signed, requestSha256),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
  });
  it("uses actual SDK SigV4 signing, exact private context and no network dispatch", async () => {
    const unexpected = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("UnexpectedNetwork"));
    const signed = await proof();
    const scope = nativeTaskCallerScope(binding(), targetArn);
    expect(validateNativeTaskCallerProof(signed, scope.digest(requestSha256), Date.now())).toBe(
      true,
    );
    expect(signed.headers.authorization).toContain(
      `SignedHeaders=${NATIVE_CALLER_SIGNED_HEADERS.join(";")}`,
    );
    expect(Object.keys(signed.headers).sort()).toEqual(
      [...NATIVE_CALLER_SIGNED_HEADERS, "authorization"].sort(),
    );
    expect(signed.headers[NATIVE_CALLER_CONTEXT_HEADER]).toBe(scope.digest(requestSha256));
    expect(Object.isFrozen(signed) && Object.isFrozen(signed.headers)).toBe(true);
    expect(unexpected).not.toHaveBeenCalled();
  });
  it("defaults off before credential/signing or verification I/O", async () => {
    const testFetch = vi.fn();
    await expect(
      createNativeTaskCallerClient({
        binding: binding(),
        targetArn,
        testCredentials: credentials,
      }).proof(requestSha256),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
    await expect(
      createNativeTaskCallerVerifier({
        binding: binding(),
        targetArn,
        taskRoleArn: roleArn,
        testFetch,
      }).verify({}, requestSha256),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
    expect(testFetch).not.toHaveBeenCalled();
  });
  it("forwards only fixed STS identity action and clears its own headers after exact-role/task acceptance", async () => {
    const signed = await proof();
    let ownedHeaders: HeadersInit | undefined;
    const testFetch = vi.fn(async (url, init) => {
      expect(url).toBe(`${NATIVE_CALLER_STS_ORIGIN}/`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(NATIVE_CALLER_STS_BODY);
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toEqual(signed.headers);
      ownedHeaders = init?.headers;
      return response();
    }) as unknown as typeof fetch;
    await createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
      signed,
      requestSha256,
    );
    expect(Object.values(ownedHeaders ?? {})).toEqual(Array(8).fill(""));
    expect(signed.headers.authorization).toMatch(/^AWS4-HMAC-SHA256/u);
  });
  it.each(["account", "role", "task", "userId", "IAM-user"])(
    "refuses authenticated AWS identity with wrong %s",
    async (kind) => {
      const signed = await proof();
      const altered =
        kind === "account"
          ? { account: "222222222222" }
          : kind === "userId"
            ? { userId: `AROA12345678901234567:${"b".repeat(32)}` }
            : {
                arn:
                  kind === "IAM-user"
                    ? "arn:aws:iam::123456789012:user/operator"
                    : `arn:aws:sts::123456789012:assumed-role/${kind === "role" ? "wrong-role" : "synthetic-material"}/${kind === "task" ? "b".repeat(32) : taskId}`,
              };
      await expect(
        createNativeTaskCallerVerifier({
          ...options(),
          taskRoleArn: roleArn,
          testFetch: vi.fn(async () => response(identityXml(altered))) as unknown as typeof fetch,
        }).verify(signed, requestSha256),
      ).rejects.toThrow(/^NativeTaskCallerUnavailable$/u);
    },
  );
  it.each(["request", "target", "generation", "epoch", "task"])(
    "binds signed context to original %s before AWS I/O",
    async (kind) => {
      const signed = await proof();
      const fixed = binding();
      if (kind === "generation") {
        fixed.scope.generationId = id(8);
        fixed.allocation.generationId = id(8);
        fixed.original.documentId = id(8);
      }
      if (kind === "epoch") fixed.scope.epochId = id(8);
      if (kind === "task")
        fixed.allocation.taskArn = `arn:aws:ecs:us-east-2:123456789012:task/native/${"b".repeat(32)}`;
      const testFetch = vi.fn();
      const verifier = createNativeTaskCallerVerifier({
        ...options(),
        binding: fixed,
        targetArn: kind === "target" ? targetArn.replace(":7", ":8") : targetArn,
        taskRoleArn: roleArn,
        testFetch,
      });
      await expect(
        verifier.verify(signed, kind === "request" ? "a".repeat(64) : requestSha256),
      ).rejects.toThrow("NativeTaskCallerUnavailable");
      expect(testFetch).not.toHaveBeenCalled();
    },
  );
  it("is fresh only for its fixed 60-second window and never changes the original input binding", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    const original = binding();
    const client = createNativeTaskCallerClient({
      binding: original,
      targetArn,
      enabled: () => true,
      testCredentials: credentials,
    });
    original.scope.epochId = id(8);
    const signed = await client.proof(requestSha256);
    const digest = nativeTaskCallerScope(binding(), targetArn).digest(requestSha256);
    expect(validateNativeTaskCallerProof(signed, digest, Date.now() + 59_999)).toBe(true);
    expect(validateNativeTaskCallerProof(signed, digest, Date.now() + 60_000)).toBe(false);
    expect(validateNativeTaskCallerProof(signed, digest, Date.now() - 2001)).toBe(false);
    expect(validateNativeTaskCallerProof(signed, digest, NaN)).toBe(false);
  });
  it.each([
    "extra-url",
    "extra-header",
    "unsigned-context",
    "new-service",
    "wrong-body-hash",
    "bad-date",
    "new-version",
    "getter",
  ])("refuses %s proof before network", async (kind) => {
    const signed = structuredClone(await proof()) as Record<string, unknown> & {
      headers: Record<string, string>;
    };
    if (kind === "extra-url") signed.url = "https://untrusted.invalid";
    if (kind === "extra-header") signed.headers["x-extra"] = "synthetic";
    if (kind === "unsigned-context")
      signed.headers.authorization =
        signed.headers.authorization?.replace(`;${NATIVE_CALLER_CONTEXT_HEADER}`, "") ?? "";
    if (kind === "new-service")
      signed.headers.authorization = signed.headers.authorization?.replace("/sts/", "/s3/") ?? "";
    if (kind === "wrong-body-hash") signed.headers["x-amz-content-sha256"] = "f".repeat(64);
    if (kind === "bad-date") signed.headers["x-amz-date"] = "20261399T299999Z";
    if (kind === "new-version") signed.schemaVersion = 2;
    if (kind === "getter")
      Object.defineProperty(signed.headers, "host", {
        get() {
          throw Error("synthetic-private-secret-not-logged");
        },
        enumerable: true,
      });
    const testFetch = vi.fn();
    await expect(
      createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
        signed,
        requestSha256,
      ),
    ).rejects.toThrow("NativeTaskCallerUnavailable");
    expect(testFetch).not.toHaveBeenCalled();
  });
  it.each([
    "denied",
    "redirect",
    "wrong-media",
    "oversize",
    "DTD",
    "duplicate",
    "unknown",
    "wrong-namespace",
    "invalid-UTF8",
    "exception",
  ])("refuses %s STS reply with value-free error", async (kind) => {
    const signed = await proof();
    const testFetch = vi.fn(async () => {
      if (kind === "exception") throw Error("synthetic-private-secret-not-logged");
      if (kind === "denied")
        return new Response("synthetic-private-secret-not-logged", { status: 403 });
      if (kind === "redirect")
        return new Response("", {
          status: 302,
          headers: { location: "https://untrusted.invalid" },
        });
      if (kind === "wrong-media")
        return new Response(identityXml(), { headers: { "content-type": "application/json" } });
      if (kind === "oversize") return response("x".repeat(8193));
      if (kind === "invalid-UTF8")
        return new Response(new Uint8Array([0xff]), { headers: { "content-type": "text/xml" } });
      const xml =
        kind === "DTD"
          ? `<!DOCTYPE x [<!ENTITY p "synthetic-private-secret-not-logged">]>${identityXml()}`
          : kind === "duplicate"
            ? identityXml().replace("</Account>", "</Account><Account>123456789012</Account>")
            : kind === "unknown"
              ? identityXml().replace(
                  "</GetCallerIdentityResult>",
                  "<Other>synthetic-private-secret-not-logged</Other></GetCallerIdentityResult>",
                )
              : identityXml().replace(
                  "https://sts.amazonaws.com/doc/2011-06-15/",
                  "https://untrusted.invalid/",
                );
      return response(xml);
    }) as unknown as typeof fetch;
    await expect(
      createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
        signed,
        requestSha256,
      ),
    ).rejects.toThrow(/^NativeTaskCallerUnavailable$/u);
  });
  it("retains admission through an unresolved fetch and refuses late timed-out acceptance", async () => {
    const signed = await proof();
    let resolve!: (response: Response) => void;
    const testFetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ) as unknown as typeof fetch;
    const verifier = createNativeTaskCallerVerifier({
      ...options(),
      taskRoleArn: roleArn,
      testFetch,
      timeoutMs: 10,
    });
    const pending = verifier.verify(signed, requestSha256);
    const failure = expect(pending).rejects.toThrow("NativeTaskCallerUnavailable");
    await new Promise((done) => setTimeout(done, 25));
    await expect(verifier.verify(signed, requestSha256)).rejects.toThrow(
      "NativeTaskCallerUnavailable",
    );
    expect(testFetch).toHaveBeenCalledTimes(1);
    resolve(response());
    await failure;
  });
  it("refuses test credentials and verifier ports outside test", async () => {
    const signed = await proof();
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        createNativeTaskCallerClient({ ...options(), testCredentials: credentials }).proof(
          requestSha256,
        ),
      ).rejects.toThrow("NativeTaskCallerUnavailable");
      const testFetch = vi.fn();
      await expect(
        createNativeTaskCallerVerifier({ ...options(), taskRoleArn: roleArn, testFetch }).verify(
          signed,
          requestSha256,
        ),
      ).rejects.toThrow("NativeTaskCallerUnavailable");
      expect(testFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
