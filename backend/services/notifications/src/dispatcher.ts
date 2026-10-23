import {
  codeLifetimeMilliseconds,
  type DeliveryOutcomeCode,
  DeliveryProviderError,
  type EmailProvider,
  generateVerificationCode,
  hashVerificationCode,
  maxDeliveryAttempts,
  notificationEmail,
  type PushProvider,
  retryDelayMilliseconds,
  verificationEmail,
} from "./delivery.js";
import type {
  ClaimedAttempt,
  ClaimedCodeRequest,
  PostgresDeliveryStore,
} from "./delivery-store.js";
import { quietHoursEnd } from "./routing.js";

export interface DispatchSummary {
  codesSent: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  deferred: number;
}

type Store = Pick<
  PostgresDeliveryStore,
  | "claimCodeRequests"
  | "storeCode"
  | "restoreCodeRequest"
  | "suppressEmail"
  | "claimDue"
  | "loadContext"
  | "finishAttempt"
  | "rescheduleAttempt"
  | "expirePushSubscription"
  | "markPushSuccess"
>;

export interface DispatcherOptions {
  store: Store;
  email: EmailProvider;
  push: PushProvider;
  /** Public web origin used in links, for example https://app.example.com. */
  webBaseUrl: string;
  now?: () => Date;
  batchSize?: number;
}

type Settled =
  | { kind: "sent"; reference?: string }
  | { kind: "skipped"; code: DeliveryOutcomeCode }
  | { kind: "retry"; code: DeliveryOutcomeCode }
  | { kind: "failed"; code: DeliveryOutcomeCode; suppressAddress?: string }
  | { kind: "deferred"; until: Date };

/**
 * Sends due notifications and confirmation codes. Every decision is re-read at send time, so a
 * resolved item, a channel the candidate turned off or a removed destination ends the attempt
 * without a send. Nothing here changes an inbox item or a source fact.
 */
export class NotificationDispatcher {
  private readonly now: () => Date;
  private readonly batchSize: number;

  constructor(private readonly options: DispatcherOptions) {
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.batchSize ?? 25;
  }

  async run(): Promise<DispatchSummary> {
    const summary: DispatchSummary = {
      codesSent: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
    };
    for (const request of await this.options.store.claimCodeRequests(this.now(), this.batchSize)) {
      if (await this.serveCodeRequest(request)) summary.codesSent += 1;
    }
    for (const attempt of await this.options.store.claimDue(this.now(), this.batchSize)) {
      const settled = await this.deliver(attempt);
      await this.record(attempt, settled);
      if (settled.kind === "sent") summary.sent += 1;
      else if (settled.kind === "skipped") summary.skipped += 1;
      else if (settled.kind === "failed") summary.failed += 1;
      else if (settled.kind === "retry") summary.retried += 1;
      else summary.deferred += 1;
    }
    return summary;
  }

  private async serveCodeRequest(request: ClaimedCodeRequest): Promise<boolean> {
    const now = this.now();
    const code = generateVerificationCode();
    const stored = await this.options.store.storeCode(
      request,
      hashVerificationCode(request.ownerUserId, code),
      new Date(now.getTime() + codeLifetimeMilliseconds),
      now,
    );
    if (!stored) return false;
    try {
      await this.options.email.send(
        verificationEmail({
          to: request.address,
          code,
          webBaseUrl: this.options.webBaseUrl,
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof DeliveryProviderError && error.permanent) {
        await this.options.store.suppressEmail(
          request.ownerUserId,
          request.address,
          "permanent_failure",
          this.now(),
        );
      } else {
        await this.options.store.restoreCodeRequest(request, this.now());
      }
      return false;
    }
  }

  private async deliver(attempt: ClaimedAttempt): Promise<Settled> {
    const now = this.now();
    let emailAddress: string | undefined;
    try {
      const context = await this.options.store.loadContext(attempt);
      if (!context) return { kind: "skipped", code: "item_resolved" };
      if (context.itemState !== "unread" || context.itemExpiresAt.getTime() <= now.getTime())
        return { kind: "skipped", code: "item_resolved" };
      const enabled = attempt.channel === "email" ? context.emailEnabled : context.pushEnabled;
      if (!enabled) return { kind: "skipped", code: "channel_off" };
      if (context.urgency !== "high") {
        const until = quietHoursEnd(context.quietHours, now);
        if (until) return { kind: "deferred", until };
      }
      if (attempt.channel === "email") {
        if (context.email?.state !== "verified") return { kind: "skipped", code: "no_destination" };
        emailAddress = context.email.address;
        const sent = await this.options.email.send(
          notificationEmail({
            to: context.email.address,
            kind: context.kind,
            webBaseUrl: this.options.webBaseUrl,
          }),
        );
        return { kind: "sent", reference: sent.reference };
      }
      if (context.pushSubscriptions.length === 0)
        return { kind: "skipped", code: "no_destination" };
      let delivered = 0;
      let transient = 0;
      for (const subscription of context.pushSubscriptions) {
        try {
          const result = await this.options.push.send(subscription.endpoint);
          if (result === "delivered") {
            delivered += 1;
            await this.options.store.markPushSuccess(subscription.id, this.now());
          } else {
            await this.options.store.expirePushSubscription(subscription.id, this.now());
          }
        } catch (error) {
          if (error instanceof DeliveryProviderError && error.permanent) {
            await this.options.store.expirePushSubscription(subscription.id, this.now());
          } else {
            transient += 1;
          }
        }
      }
      if (delivered > 0) return { kind: "sent", reference: `subscriptions:${delivered}` };
      if (transient > 0) return { kind: "retry", code: "transient_error" };
      return { kind: "skipped", code: "no_destination" };
    } catch (error) {
      if (error instanceof DeliveryProviderError && error.permanent) {
        return {
          kind: "failed",
          code: "rejected_permanent",
          ...(emailAddress ? { suppressAddress: emailAddress } : {}),
        };
      }
      return { kind: "retry", code: "transient_error" };
    }
  }

  private async record(attempt: ClaimedAttempt, settled: Settled): Promise<void> {
    const now = this.now();
    const store = this.options.store;
    if (settled.kind === "sent")
      return store.finishAttempt(attempt.id, "sent", "delivered", now, settled.reference);
    if (settled.kind === "skipped")
      return store.finishAttempt(attempt.id, "skipped", settled.code, now);
    if (settled.kind === "failed") {
      await store.finishAttempt(attempt.id, "failed", settled.code, now);
      // After the attempt is recorded: suppression also closes the candidate's other pending mail.
      if (settled.suppressAddress)
        await store.suppressEmail(
          attempt.ownerUserId,
          settled.suppressAddress,
          "permanent_failure",
          now,
        );
      return;
    }
    if (settled.kind === "deferred")
      return store.rescheduleAttempt(attempt.id, settled.until, "deferred_quiet_hours", now, false);
    const delay =
      attempt.attemptCount >= maxDeliveryAttempts
        ? undefined
        : retryDelayMilliseconds(attempt.attemptCount);
    if (delay === undefined)
      return store.finishAttempt(attempt.id, "failed", "attempts_exhausted", now);
    return store.rescheduleAttempt(attempt.id, new Date(now.getTime() + delay), settled.code, now);
  }
}
