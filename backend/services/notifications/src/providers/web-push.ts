import { createPrivateKey, sign } from "node:crypto";
import {
  DeliveryProviderError,
  type PushProvider,
  type PushResult,
  validatePushEndpoint,
} from "../delivery.js";

export interface WebPushProviderOptions {
  /** PKCS#8 PEM of the VAPID P-256 private key. */
  privateKeyPem: string;
  /** The matching public key, uncompressed point, base64url (65 bytes). */
  publicKey: string;
  /** A mailto: or https: contact the push services can use, per RFC 8292. */
  subject: string;
  now?: () => Date;
  fetchImplementation?: typeof fetch;
}

const base64url = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

/**
 * Payload-less Web Push (RFC 8030) with VAPID (RFC 8292). Nothing about the candidate or an
 * application is sent: the service worker shows generic wording and opens the inbox.
 */
export class WebPushProvider implements PushProvider {
  private readonly now: () => Date;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: WebPushProviderOptions) {
    this.now = options.now ?? (() => new Date());
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    if (!/^(mailto:|https:\/\/)/.test(options.subject))
      throw new Error("The VAPID subject must be a mailto: or https: URL");
    if (Buffer.from(options.publicKey, "base64url").length !== 65)
      throw new Error("The VAPID public key must be an uncompressed P-256 point");
    createPrivateKey(options.privateKeyPem);
  }

  private token(audience: string): string {
    const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const payload = base64url(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(this.now().getTime() / 1000) + 12 * 60 * 60,
        sub: this.options.subject,
      }),
    );
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: createPrivateKey(this.options.privateKeyPem),
      dsaEncoding: "ieee-p1363",
    });
    return `${header}.${payload}.${base64url(signature)}`;
  }

  async send(endpoint: string): Promise<PushResult> {
    const checked = validatePushEndpoint(endpoint);
    if (!checked) return "gone";
    const url = new URL(checked);
    let response: Response;
    try {
      response = await this.fetchImplementation(checked, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `vapid t=${this.token(url.origin)}, k=${this.options.publicKey}`,
          TTL: "3600",
          Urgency: "normal",
          "Content-Length": "0",
        },
      });
    } catch {
      throw new DeliveryProviderError(false, "push_network_error");
    }
    if (response.status >= 200 && response.status < 300) return "delivered";
    if (response.status === 404 || response.status === 410) return "gone";
    // 400, 401 and 403 mean the platform's own VAPID identity was refused: retry, never expire.
    throw new DeliveryProviderError(false, `push_status_${response.status}`);
  }
}
