import { expect, it, vi } from "vitest";
import {
  createNativeReadAuthorizationClient,
  createNativeResumeReadAuthorizationClient,
} from "./native-read-authorization-client.js";

const ids = [
  "019d04cf-1f80-7000-8000-000000000001",
  "019d04cf-1f80-7000-8000-000000000002",
  "019d04cf-1f80-7000-8000-000000000003",
] as const;
const reference = () => ({
  schemaVersion: 1 as const,
  kind: "cover_letter" as const,
  ownerUserId: ids[0],
  applicationId: ids[1],
  generationId: String(ids[2]),
  version: 1,
  contentSha256: "a".repeat(64),
  completedAtMs: Date.now(),
  expiresAtMs: Date.now() + 1_800_000,
});
const header = { "cache-control": "no-store", "content-type": "application/json" };
const proof = (ref: ReturnType<typeof reference>) => {
  const { ownerUserId: _owner, applicationId: _app, ...metadata } = ref;
  return {
    schemaVersion: 1,
    packetId: ids[2],
    packetHash: "b".repeat(64),
    temporaryMaterial: metadata,
  };
};
const fixed = () => {
  const ref = reference();
  ref.expiresAtMs = ref.completedAtMs + 1_800_000;
  return ref;
};
const token = "synthetic.signed.token";

it("forwards only the current request token to the fixed scalar endpoint and returns the exact original proof", async () => {
  const ref = fixed();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(proof(ref)), { headers: header }));
  const read = createNativeReadAuthorizationClient({
    apiOrigin: "https://control.test.invalid",
    enabled: () => true,
    fetch: fetcher,
  });
  expect(
    await read(ref.ownerUserId, ref.applicationId, ref, new AbortController().signal, token),
  ).toMatchObject({ reference: ref, packetHash: "b".repeat(64) });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual([
    `https://control.test.invalid/v1/applications/${ref.applicationId}/cover-letter/authorization?generationId=${ref.generationId}`,
    expect.objectContaining({
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    }),
  ]);
});

it.each(["disabled", "aborted", "owner", "application", "expired", "token"])(
  "refuses %s before any metadata I/O",
  async (mode) => {
    const ref = fixed();
    const fetcher = vi.fn();
    const read = createNativeReadAuthorizationClient({
      apiOrigin: "https://control.test.invalid",
      ...(mode !== "disabled" ? { enabled: () => true } : {}),
      fetch: fetcher,
    });
    if (mode === "expired") {
      ref.completedAtMs = Date.now() - 1_800_001;
      ref.expiresAtMs = ref.completedAtMs + 1_800_000;
    }
    await expect(
      read(
        mode === "owner" ? ids[2] : ref.ownerUserId,
        mode === "application" ? ids[2] : ref.applicationId,
        ref,
        mode === "aborted" ? AbortSignal.abort() : new AbortController().signal,
        mode === "token" ? "invalid credential" : token,
      ),
    ).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each(["body", "wrapper", "generation", "expiry", "oversize", "cache", "status", "json"])(
  "refuses malformed or changed %s without redispatch",
  async (mode) => {
    const ref = fixed();
    const value = proof(ref);
    if (mode === "generation") value.temporaryMaterial.generationId = ids[1];
    if (mode === "expiry") value.temporaryMaterial.expiresAtMs++;
    const body =
      mode === "json"
        ? "{"
        : mode === "oversize"
          ? "x".repeat(4097)
          : JSON.stringify(
              mode === "wrapper"
                ? { data: value }
                : mode === "body"
                  ? { ...value, paragraphs: ["private synthetic text"] }
                  : value,
            );
    const fetcher = vi.fn(
      async () =>
        new Response(body, {
          headers: mode === "cache" ? { ...header, "cache-control": "public" } : header,
          status: mode === "status" ? 503 : 200,
        }),
    );
    const read = createNativeReadAuthorizationClient({
      apiOrigin: "https://control.test.invalid",
      enabled: () => true,
      fetch: fetcher,
    });
    await expect(
      read(ref.ownerUserId, ref.applicationId, ref, new AbortController().signal, token),
    ).rejects.toThrow("NativeReadAuthorizationUnavailable");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("returns a known conflict as negative authority, not a retry or new lifetime", async () => {
  const ref = fixed();
  const fetcher = vi.fn(async () => new Response("{}", { status: 409, headers: header }));
  const read = createNativeReadAuthorizationClient({
    apiOrigin: "https://control.test.invalid",
    enabled: () => true,
    fetch: fetcher,
  });
  expect(
    await read(ref.ownerUserId, ref.applicationId, ref, new AbortController().signal, token),
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("awaits the actual fetch promise after cancellation and does not expose its late proof", async () => {
  const ref = fixed();
  let complete: (value: Response) => void = () => {
    throw Error("SyntheticMissingPromise");
  };
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  const read = createNativeReadAuthorizationClient({
    apiOrigin: "https://control.test.invalid",
    enabled: () => true,
    fetch: fetcher,
  });
  const abort = new AbortController();
  let settled = false;
  const pending = read(ref.ownerUserId, ref.applicationId, ref, abort.signal, token).finally(() => {
    settled = true;
  });
  const rejection = expect(pending).rejects.toThrow("NativeReadAuthorizationUnavailable");
  abort.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  complete(new Response(JSON.stringify(proof(ref)), { headers: header }));
  await rejection;
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  "http://control.test.invalid",
  "https://user:secret@control.test.invalid",
  "https://control.test.invalid/path",
  "https://control.test.invalid?redirect=other",
])("refuses an untrusted origin shape", (apiOrigin) => {
  expect(() => createNativeReadAuthorizationClient({ apiOrigin })).toThrow(
    "NativeReadAuthorizationUnavailable",
  );
});

it("pins resume authorization to its route and rejects cross-kind proofs", async () => {
  const ref = { ...fixed(), kind: "tailored_resume" as const };
  const { ownerUserId: _owner, applicationId: _app, ...metadata } = ref;
  let wrongKind = false;
  const fetcher = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          packetId: ids[2],
          packetHash: "b".repeat(64),
          temporaryMaterial: { ...metadata, kind: wrongKind ? "cover_letter" : "tailored_resume" },
        }),
        { headers: header },
      ),
  );
  const read = createNativeResumeReadAuthorizationClient({
    apiOrigin: "https://control.test.invalid",
    enabled: () => true,
    fetch: fetcher,
  });
  await expect(
    read(ref.ownerUserId, ref.applicationId, ref, new AbortController().signal, token),
  ).resolves.toMatchObject({ reference: ref });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://control.test.invalid/v1/applications/${ref.applicationId}/resume/authorization?generationId=${ref.generationId}`,
  );
  wrongKind = true;
  await expect(
    read(ref.ownerUserId, ref.applicationId, ref, new AbortController().signal, token),
  ).rejects.toThrow("NativeReadAuthorizationUnavailable");
  fetcher.mockClear();
  await expect(
    read(ref.ownerUserId, ref.applicationId, fixed(), new AbortController().signal, token),
  ).rejects.toThrow("NativeReadAuthorizationUnavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
