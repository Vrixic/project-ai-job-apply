import {
  type DeliveryOutcomeCode,
  DeliveryProviderError,
  type EmailProvider,
  maxDeliveryAttempts,
  notificationEmail,
  retryDelayMilliseconds,
} from "./delivery.js";
import type { ClaimedAttempt, PostgresDeliveryStore } from "./delivery-store.js";
import { quietHoursEnd } from "./routing.js";

export interface DispatchSummary {
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  deferred: number;
}

type Store = Pick<
  PostgresDeliveryStore,
  "suppressEmail" | "claimDue" | "loadContext" | "finishAttempt" | "rescheduleAttempt"
>;

export interface DispatcherOptions {
  store: Store;
  email: EmailProvider;
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
 * Sends due notification emails. Every decision is re-read at send time, so a resolved item, a
 * channel the candidate turned off or a missing destination ends the attempt without a send. Nothing here changes an inbox item or a source fact.
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
      sent: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
    };
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

  private async deliver(attempt: ClaimedAttempt): Promise<Settled> {
    const now = this.now();
    let emailAddress: string | undefined;
    try {
      const context = await this.options.store.loadContext(attempt);
      if (!context) return { kind: "skipped", code: "item_resolved" };
      if (context.itemState !== "unread" || context.itemExpiresAt.getTime() <= now.getTime())
        return { kind: "skipped", code: "item_resolved" };
      if (!context.emailEnabled) return { kind: "skipped", code: "channel_off" };
      if (context.urgency !== "high") {
        const until = quietHoursEnd(context.quietHours, now);
        if (until) return { kind: "deferred", until };
      }
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
