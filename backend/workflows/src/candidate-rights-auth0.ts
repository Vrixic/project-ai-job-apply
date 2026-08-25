import type {
  CandidateExternalIdentity,
  CandidateIdentityProvider,
} from "./candidate-rights-activities.js";

export type Auth0CandidateRevocationMode =
  | "delete_user_only"
  | "revoke_sessions_refresh_tokens_then_delete";

export interface Auth0CandidateIdentityProviderOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  revocationMode: Auth0CandidateRevocationMode;
  fetch?: typeof globalThis.fetch;
  timeoutMilliseconds?: number;
  clock?: () => Date;
}

interface ManagementToken {
  token: string;
  expiresAt: number;
}

function exactIssuer(value: string): URL {
  const issuer = new URL(value);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    !issuer.pathname.endsWith("/")
  ) {
    throw new Error("CandidateIdentityProviderConfigurationInvalid");
  }
  return issuer;
}

async function boundedJson(response: Response, maximumBytes = 16 * 1024): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error("CandidateIdentityProviderResponseRejected");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error("CandidateIdentityProviderResponseRejected");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export class Auth0CandidateIdentityProvider implements CandidateIdentityProvider {
  private readonly issuer: URL;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMilliseconds: number;
  private readonly clock: () => Date;
  private token: ManagementToken | undefined;

  constructor(private readonly options: Auth0CandidateIdentityProviderOptions) {
    this.issuer = exactIssuer(options.issuer);
    if (
      !options.clientId ||
      !options.clientSecret ||
      !["delete_user_only", "revoke_sessions_refresh_tokens_then_delete"].includes(
        options.revocationMode,
      )
    ) {
      throw new Error("CandidateIdentityProviderConfigurationInvalid");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
    this.clock = options.clock ?? (() => new Date());
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      return await this.fetch(new URL(path, this.issuer), {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw Object.assign(new Error("CandidateIdentityProviderUnavailable"), {
        code: "ServiceUnavailable",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async managementToken(): Promise<string> {
    const now = this.clock().getTime();
    if (this.token && this.token.expiresAt - now >= 60_000) return this.token.token;
    const response = await this.request("oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        audience: new URL("api/v2/", this.issuer).href,
      }),
    });
    if (response.status !== 200) {
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        // No provider failure body is consumed or retained.
      }
      throw new Error("CandidateIdentityProviderAuthorizationRejected");
    }
    const value = await boundedJson(response);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof (value as { access_token?: unknown }).access_token !== "string" ||
      (value as { token_type?: unknown }).token_type !== "Bearer" ||
      !Number.isSafeInteger((value as { expires_in?: unknown }).expires_in) ||
      Number((value as { expires_in: number }).expires_in) < 60
    ) {
      throw new Error("CandidateIdentityProviderResponseRejected");
    }
    const token = (value as { access_token: string }).access_token;
    this.token = {
      token,
      expiresAt: now + Number((value as { expires_in: number }).expires_in) * 1_000,
    };
    return token;
  }

  private async deletion(path: string, token: string, accepted: readonly number[]): Promise<void> {
    const response = await this.request(path, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "x-correlation-id": crypto.randomUUID() },
    });
    if (!accepted.includes(response.status)) {
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        // No provider failure body is consumed or retained.
      }
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        throw Object.assign(new Error("CandidateIdentityProviderUnavailable"), {
          code: "ServiceUnavailable",
        });
      }
      throw new Error("CandidateIdentityProviderDeletionRejected");
    }
    try {
      void response.body?.cancel().catch(() => undefined);
    } catch {
      // Successful deletion responses are status-only.
    }
  }

  async revokeAndDelete(identities: readonly CandidateExternalIdentity[]): Promise<void> {
    const seen = new Set<string>();
    const distinct = identities
      .filter((identity) => {
        const key = `${identity.issuer}\0${identity.subject}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) =>
        `${left.issuer}\0${left.subject}`.localeCompare(`${right.issuer}\0${right.subject}`),
      );
    if (
      distinct.some(
        (identity) =>
          identity.issuer !== this.issuer.href ||
          !identity.subject ||
          identity.subject.length > 255,
      )
    ) {
      throw new Error("CandidateIdentityProviderIdentityRejected");
    }
    const token = await this.managementToken();
    for (const identity of distinct) {
      const userPath = `api/v2/users/${encodeURIComponent(identity.subject)}`;
      if (this.options.revocationMode === "revoke_sessions_refresh_tokens_then_delete") {
        await this.deletion(`${userPath}/sessions`, token, [204, 404]);
        await this.deletion(`${userPath}/refresh-tokens`, token, [204, 404]);
      }
      await this.deletion(userPath, token, [204]);
    }
  }
}
