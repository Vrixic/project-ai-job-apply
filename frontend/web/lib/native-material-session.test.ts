import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeMaterialSession, nativeMaterialConfiguration } from "./native-material-session";

const sdk = vi.hoisted(() => ({
  options: vi.fn(),
  popup: vi.fn(),
  claims: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@auth0/auth0-spa-js", () => ({
  Auth0Client: class {
    constructor(options: unknown) {
      sdk.options(options);
    }
    getTokenWithPopup = sdk.popup;
    getIdTokenClaims = sdk.claims;
    logout = sdk.logout;
  },
}));
const configuration = {
  domain: "identity.example.test",
  clientId: "synthetic-client",
  baseHost: "materials.example.test",
};
const url = new URL(
  "https://00000000-0000-7000-8000-000000000005.materials.example.test:8443/v1/applications/00000000-0000-7000-8000-000000000001/resume",
);
let session: NativeMaterialSession;
beforeEach(() => {
  vi.clearAllMocks();
  sdk.popup.mockResolvedValue("synthetic-public-client-token");
  sdk.claims.mockResolvedValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
  sdk.logout.mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    location: { protocol: "https:", origin: "https://app.example.test" },
    open: vi.fn(() => ({ close: vi.fn() })),
  });
  session = new NativeMaterialSession(configuration);
});
afterEach(() => {
  session.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("defaults off and rejects incomplete public configuration", () => {
  vi.stubEnv("NEXT_PUBLIC_NATIVE_MATERIAL_UI", "disabled");
  expect(nativeMaterialConfiguration()).toBeUndefined();
  vi.stubEnv("NEXT_PUBLIC_NATIVE_MATERIAL_UI", "enabled");
  vi.stubEnv("NEXT_PUBLIC_NATIVE_AUTH0_DOMAIN", "https://bad.example.test/");
  expect(nativeMaterialConfiguration()).toBeUndefined();
});
it("opens synchronously and uses an explicit memory-only popup client without renewal", async () => {
  const promise = session.signIn();
  expect(window.open).toHaveBeenCalledOnce();
  await promise;
  expect(sdk.options).toHaveBeenCalledWith(
    expect.objectContaining({
      cacheLocation: "memory",
      useRefreshTokens: false,
      useRefreshTokensFallback: false,
      useCookiesForTransactions: false,
      authorizationParams: {
        audience: "ai-job-apply-api",
        scope: "openid applications:read",
        redirect_uri: "https://app.example.test",
      },
    }),
  );
  expect(sdk.popup).toHaveBeenCalledWith(
    { authorizationParams: { prompt: "select_account" } },
    expect.objectContaining({ timeoutInSeconds: 60 }),
  );
  expect(session.ready).toBe(true);
});
it.each([
  "http://materials.example.test",
  "https://evil.example.test:8443",
  "https://00000000-0000-7000-8000-000000000005.materials.example.test:8443/other",
])("never forwards the token to %s", async (target) => {
  await session.signIn();
  const send = vi.fn();
  await expect(session.read(new URL(target), new AbortController().signal, send)).rejects.toThrow(
    "MaterialReadUnavailable",
  );
  expect(send).not.toHaveBeenCalled();
});
it("omits cookies, rejects redirects and aborts a held native read on disconnect", async () => {
  await session.signIn();
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  const controller = new AbortController();
  await session.read(url, controller.signal, send);
  const init = send.mock.calls[0]?.[1];
  expect(init).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: { authorization: "Bearer synthetic-public-client-token" },
  });
  session.clear();
  expect(init?.signal?.aborted).toBe(true);
  controller.abort();
  expect(session.ready).toBe(false);
});
it("a late popup after disconnect cannot restore a token", async () => {
  let resolve!: (token: string) => void;
  sdk.popup.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const pending = session.signIn();
  await vi.waitFor(() => expect(sdk.popup).toHaveBeenCalledOnce());
  session.clear();
  resolve("synthetic-late-token");
  await expect(pending).rejects.toThrow("MaterialSignInUnavailable");
  expect(session.ready).toBe(false);
  expect(sdk.logout).toHaveBeenCalled();
});
it("expires access at ten minutes without renewing", async () => {
  vi.useFakeTimers();
  await session.signIn();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(session.ready).toBe(false);
  expect(sdk.popup).toHaveBeenCalledOnce();
});

it("refuses insecure origins and blocked popups before creating credentials", async () => {
  Reflect.set(window.location, "protocol", "http:");
  await expect(session.signIn()).rejects.toThrow("MaterialSignInUnavailable");
  expect(window.open).not.toHaveBeenCalled();
  Reflect.set(window.location, "protocol", "https:");
  vi.mocked(window.open).mockReturnValue(null);
  await expect(session.signIn()).rejects.toThrow("MaterialSignInUnavailable");
  expect(sdk.options).not.toHaveBeenCalled();
});

it("bounds held popup authorization and refuses its late completion", async () => {
  vi.useFakeTimers();
  let resolve!: (token: string) => void;
  sdk.popup.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const pending = session.signIn();
  const result = expect(pending).rejects.toThrow("MaterialSignInUnavailable");
  await vi.advanceTimersByTimeAsync(65_000);
  await result;
  resolve("synthetic-late-timeout-token");
  await vi.advanceTimersByTimeAsync(1);
  expect(session.ready).toBe(false);
});
