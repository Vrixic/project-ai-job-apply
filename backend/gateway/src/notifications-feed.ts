import type { ApplicationEventOutbox } from "@ai-job-apply/applications-service";
import type { NotificationsService } from "@ai-job-apply/notifications-service";
import type { NotificationsApi } from "./app.module.js";

const BATCH = 25;

/**
 * Feeds the candidate's inbox from the Applications event outbox, in process and with no new
 * infrastructure (ADR-055). Reading the first page of the inbox first takes that candidate's pending
 * events through the Applications-owned claim lifecycle and hands each to Notifications. A failure
 * here never fails the read; the events stay for the next one. Applications remains authoritative:
 * a missed or late item only means the inbox is behind.
 */
export function withApplicationEventFeed(options: {
  notifications: NotificationsService;
  events: Pick<ApplicationEventOutbox, "claimForOwner" | "markPublished" | "markFailed">;
  clock?: () => Date;
}): NotificationsApi {
  const clock = options.clock ?? (() => new Date());

  async function pump(ownerUserId: string): Promise<void> {
    try {
      const claimed = await options.events.claimForOwner(ownerUserId, BATCH, clock());
      for (const event of claimed) {
        try {
          const result = await options.notifications.ingestApplicationEvent({
            id: event.id,
            type: event.type,
            data: event.data,
          });
          // A rejected event is malformed or unsupported: it is retried a few times, then failed.
          if (result.outcome === "rejected") await options.events.markFailed(event, clock());
          else await options.events.markPublished(event, clock());
        } catch {
          await options.events.markFailed(event, clock()).catch(() => undefined);
          return;
        }
      }
    } catch {
      // The inbox read must not depend on the feed.
    }
  }

  return {
    acknowledge: (owner, id) => options.notifications.acknowledge(owner, id),
    dismiss: (owner, id) => options.notifications.dismiss(owner, id),
    getPreferences: (owner) => options.notifications.getPreferences(owner),
    updatePreferences: (owner, version, update) =>
      options.notifications.updatePreferences(owner, version, update),
    async listInbox(owner, listOptions) {
      if (!listOptions?.cursor) await pump(owner);
      return options.notifications.listInbox(owner, listOptions);
    },
  };
}
