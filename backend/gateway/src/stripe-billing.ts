import { Readable } from "node:stream";
import {
  type ApplyEntitlementChangeInput,
  type ApplyEntitlementChangeResult,
  type EntitlementReader,
  handleStripeWebhook,
  loadStripeConfig,
  reconcileStripeSubscription,
  StripeBillingService,
  StripeClient,
} from "@ai-job-apply/billing-service";
import { PayloadTooLargeException } from "@nestjs/common";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Gateway composition for Stripe billing (D6-005). Billing is off unless the Stripe environment is
 * complete: without it no checkout, portal or webhook route is registered. The webhook is the only
 * public route and authenticates itself with the signed raw body.
 */

export const stripeWebhookPath = "/v1/billing/webhooks/stripe";
/** Stripe events are small; anything larger is not a Stripe event. */
export const maximumStripeWebhookBytes = 256 * 1024;

export interface StripeBillingGateway {
  startCheckout(userId: string): Promise<{ url: string }>;
  openPortal(userId: string): Promise<{ url: string }>;
  /** Pulls the candidate's subscription from Stripe; true when the entitlement changed. */
  syncSubscription(userId: string): Promise<{ changed: boolean }>;
  handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void>;
}

export interface StripeBillingComposition {
  env: Readonly<Record<string, string | undefined>>;
  reader: EntitlementReader;
  writer: {
    applyEntitlementChange(
      input: ApplyEntitlementChangeInput,
    ): Promise<ApplyEntitlementChangeResult>;
  };
  clock?: () => Date;
  fetch?: typeof fetch;
  onWebhookOutcome?: (outcome: { outcome: string; eventType: string }) => void;
}

export function createStripeBillingGateway(
  composition: StripeBillingComposition,
): StripeBillingGateway | undefined {
  const config = loadStripeConfig(composition.env);
  if (!config) return undefined;
  const api = new StripeClient({
    secretKey: config.secretKey,
    ...(config.apiVersion ? { apiVersion: config.apiVersion } : {}),
    ...(composition.fetch ? { fetch: composition.fetch } : {}),
  });
  const service = new StripeBillingService({
    api,
    priceId: config.priceId,
    appBaseUrl: config.appBaseUrl,
    ...(composition.clock ? { clock: composition.clock } : {}),
  });
  return {
    startCheckout: (userId) => service.startCheckout(userId),
    openPortal: (userId) => service.openPortal(userId),
    async syncSubscription(userId) {
      const outcome = await reconcileStripeSubscription(
        {
          api,
          billing: {
            readEntitlement: (id) => composition.reader.readEntitlement(id),
            applyEntitlementChange: (input) => composition.writer.applyEntitlementChange(input),
          },
          ...(composition.clock ? { clock: composition.clock } : {}),
          ...(config.graceSeconds !== undefined ? { graceSeconds: config.graceSeconds } : {}),
        },
        userId,
      );
      return { changed: outcome === "applied" };
    },
    async handleWebhook(rawBody, signature) {
      await handleStripeWebhook(
        {
          api,
          billing: {
            readEntitlement: (userId) => composition.reader.readEntitlement(userId),
            applyEntitlementChange: (input) => composition.writer.applyEntitlementChange(input),
          },
          webhookSecrets: config.webhookSecrets,
          ...(composition.clock ? { clock: composition.clock } : {}),
          ...(config.graceSeconds !== undefined ? { graceSeconds: config.graceSeconds } : {}),
          ...(composition.onWebhookOutcome ? { onOutcome: composition.onWebhookOutcome } : {}),
        },
        { rawBody, signature },
      );
    },
  };
}

export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * Keeps the exact bytes of the Stripe webhook body for signature verification. Only that one route
 * is touched: every other route keeps the framework's normal body handling.
 */
export function installStripeWebhookRawBody(fastify: FastifyInstance): void {
  fastify.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST" || request.routeOptions.url !== stripeWebhookPath) {
      return payload;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += buffer.byteLength;
      if (size > maximumStripeWebhookBytes) {
        throw new PayloadTooLargeException();
      }
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks);
    (request as RawBodyRequest).rawBody = raw;
    return Readable.from([raw]);
  });
}
