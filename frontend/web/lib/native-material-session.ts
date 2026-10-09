import type { Auth0Client } from "@auth0/auth0-spa-js";

export interface NativeMaterialConfiguration {
  domain: string;
  clientId: string;
  baseHost: string;
}

const DNS = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

export function nativeMaterialConfiguration(): NativeMaterialConfiguration | undefined {
  if (process.env.NEXT_PUBLIC_NATIVE_MATERIAL_UI !== "enabled") return undefined;
  const domain = process.env.NEXT_PUBLIC_NATIVE_AUTH0_DOMAIN ?? "";
  const clientId = process.env.NEXT_PUBLIC_NATIVE_AUTH0_CLIENT_ID ?? "";
  const baseHost = process.env.NEXT_PUBLIC_NATIVE_MATERIAL_BASE_HOST ?? "";
  if (!DNS.test(domain) || !DNS.test(baseHost) || !/^[A-Za-z0-9_-]{8,128}$/u.test(clientId))
    return undefined;
  return { domain, clientId, baseHost };
}

/** One workspace owns one short-lived public-client credential. There is no token-returning BFF,
 * silent refresh, redirect transaction, refresh token, persistent cache or arbitrary URL fetch. */
export class NativeMaterialSession {
  private client: Auth0Client | undefined;
  private token: string | undefined;
  private deadline = 0;
  private epoch = 0;
  private popup: Window | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requests = new Set<AbortController>();

  constructor(readonly configuration: NativeMaterialConfiguration) {}

  get ready(): boolean {
    return Boolean(this.token) && Date.now() < this.deadline;
  }

  get expiresAt(): number | undefined {
    return this.deadline || undefined;
  }
  get revision(): number {
    return this.epoch;
  }

  async signIn(): Promise<void> {
    this.clear();
    const epoch = this.epoch;
    if (window.location.protocol !== "https:") throw Error("MaterialSignInUnavailable");
    // Open on the candidate's click, before loading the SDK chunk, to preserve popup activation.
    const popup = window.open("", "material-sign-in", "popup=yes,width=500,height=650");
    if (!popup) throw Error("MaterialSignInUnavailable");
    this.popup = popup;
    let rejectTimeout: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      rejectTimeout = () => reject(Error("MaterialSignInUnavailable"));
    });
    const timer = setTimeout(() => {
      if (epoch === this.epoch) this.clear();
      rejectTimeout?.();
    }, 65_000);
    let client: Auth0Client | undefined;
    try {
      const work = async () => {
        const { Auth0Client } = await import("@auth0/auth0-spa-js");
        if (epoch !== this.epoch) throw Error("MaterialSignInUnavailable");
        client = new Auth0Client({
          domain: this.configuration.domain,
          clientId: this.configuration.clientId,
          cacheLocation: "memory",
          useRefreshTokens: false,
          useRefreshTokensFallback: false,
          useCookiesForTransactions: false,
          legacySameSiteCookie: false,
          httpTimeoutInSeconds: 10,
          authorizationParams: {
            audience: "ai-job-apply-api",
            scope: "openid applications:read",
            redirect_uri: window.location.origin,
          },
        });
        this.client = client;
        const token = await client.getTokenWithPopup(
          { authorizationParams: { prompt: "select_account" } },
          { popup, timeoutInSeconds: 60 },
        );
        const claims = await client.getIdTokenClaims();
        if (epoch !== this.epoch) {
          await client.logout({ openUrl: false }).catch(() => undefined);
          throw Error("MaterialSignInUnavailable");
        }
        if (
          epoch !== this.epoch ||
          typeof token !== "string" ||
          !token ||
          token.length > 16_384 ||
          !claims ||
          typeof claims.exp !== "number" ||
          !Number.isFinite(claims.exp)
        )
          throw Error("MaterialSignInUnavailable");
        const deadline = Math.min(Date.now() + 600_000, claims.exp * 1000);
        if (Date.now() >= deadline) throw Error("MaterialSignInUnavailable");
        this.token = token;
        this.deadline = deadline;
        this.timer = setTimeout(() => this.clear(), deadline - Date.now());
      };
      await Promise.race([work(), timeout]);
    } catch {
      if (epoch === this.epoch) this.clear();
      void client?.logout({ openUrl: false }).catch(() => undefined);
      throw Error("MaterialSignInUnavailable");
    } finally {
      clearTimeout(timer);
      popup.close();
      if (this.popup === popup) this.popup = null;
    }
  }

  clear(): void {
    this.epoch += 1;
    this.token = undefined;
    this.deadline = 0;
    clearTimeout(this.timer);
    this.popup?.close();
    this.popup = null;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    const client = this.client;
    this.client = undefined;
    void client?.logout({ openUrl: false }).catch(() => undefined);
  }

  async read(url: URL, signal: AbortSignal, send: typeof fetch = fetch): Promise<Response> {
    const host = url.hostname;
    const generation = host.slice(0, -(this.configuration.baseHost.length + 1));
    if (
      !this.ready ||
      signal.aborted ||
      url.protocol !== "https:" ||
      url.port !== "8443" ||
      url.username ||
      url.password ||
      url.hash ||
      host !== `${generation}.${this.configuration.baseHost}` ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
        generation,
      ) ||
      !/^\/v1\/applications\/[a-f0-9-]{36}\/(resume|cover-letter)(\/file)?$/u.test(url.pathname) ||
      (url.search !== "" && !/^\?format=(pdf|docx)$/u.test(url.search))
    )
      throw Error("MaterialReadUnavailable");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.requests.add(controller);
    const epoch = this.epoch;
    try {
      const response = await send(url.href, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (epoch !== this.epoch || !this.ready || signal.aborted || controller.signal.aborted) {
        void response.body?.cancel().catch(() => undefined);
        throw Error("MaterialReadUnavailable");
      }
      // Caller owns the response body under its bounded signal; keep session abort linked until
      // that signal aborts (the native reader always aborts it in finally).
      return response;
    } finally {
      if (signal.aborted || epoch !== this.epoch) this.requests.delete(controller);
      // Retain the cancellation link for a held body; caller's abort releases it.
      const cleanup = () => {
        this.requests.delete(controller);
        signal.removeEventListener("abort", abort);
      };
      if (signal.aborted) cleanup();
      else signal.addEventListener("abort", cleanup, { once: true });
    }
  }
}
