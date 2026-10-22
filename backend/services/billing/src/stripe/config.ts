/**
 * Stripe configuration. Billing through Stripe is off unless every required value is present, so
 * a deployment without keys exposes no checkout, portal or webhook behavior. A partial
 * configuration is an error rather than a silently disabled integration.
 */

export interface StripeConfig {
  secretKey: string;
  webhookSecrets: readonly string[];
  priceId: string;
  appBaseUrl: string;
  apiVersion?: string;
  graceSeconds?: number;
}

const NAMES = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecrets: "STRIPE_WEBHOOK_SECRETS",
  priceId: "STRIPE_PRO_PRICE_ID",
  appBaseUrl: "BILLING_APP_BASE_URL",
} as const;

export function loadStripeConfig(
  env: Readonly<Record<string, string | undefined>>,
): StripeConfig | undefined {
  const value = (name: string): string | undefined => {
    const raw = env[name]?.trim();
    return raw ? raw : undefined;
  };
  const secretKey = value(NAMES.secretKey);
  const secrets = (value(NAMES.webhookSecrets) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const priceId = value(NAMES.priceId);
  const appBaseUrl = value(NAMES.appBaseUrl);
  const present = [secretKey, secrets.length > 0 ? "x" : undefined, priceId, appBaseUrl].filter(
    Boolean,
  ).length;
  if (present === 0) return undefined;
  if (!secretKey || secrets.length === 0 || !priceId || !appBaseUrl) {
    throw new Error(
      `Stripe billing is partially configured: set ${Object.values(NAMES).join(", ")} together`,
    );
  }
  if (
    !/^sk_(test|live)_[A-Za-z0-9]+$/u.test(secretKey) &&
    !/^rk_(test|live)_[A-Za-z0-9]+$/u.test(secretKey)
  ) {
    throw new Error("STRIPE_SECRET_KEY is not a Stripe secret or restricted key");
  }
  if (!secrets.every((secret) => /^whsec_[A-Za-z0-9+/=_-]+$/u.test(secret))) {
    throw new Error("STRIPE_WEBHOOK_SECRETS must be comma-separated whsec_ signing secrets");
  }
  if (!/^price_[A-Za-z0-9]+$/u.test(priceId)) {
    throw new Error("STRIPE_PRO_PRICE_ID is not a Stripe price id");
  }
  let url: URL;
  try {
    url = new URL(appBaseUrl);
  } catch {
    throw new Error("BILLING_APP_BASE_URL is not a URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("BILLING_APP_BASE_URL must be https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("BILLING_APP_BASE_URL must be a plain origin");
  }
  return {
    secretKey,
    webhookSecrets: secrets,
    priceId,
    appBaseUrl: url.origin + url.pathname.replace(/\/+$/u, ""),
  };
}
