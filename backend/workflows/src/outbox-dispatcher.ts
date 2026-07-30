import { eventTypes, validateEventData } from "@ai-job-apply/event-contracts";
import { activeTraceparent, withTraceSpan } from "@ai-job-apply/observability";
import type { Logger } from "pino";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import type { Client } from "@temporalio/client";
import { profileReadinessWorkflow } from "./workflows.js";

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    private readonly store: ProfileStore,
    private readonly temporal: Client,
    private readonly taskQueue: string,
    private readonly logger: Logger,
  ) {}

  start(intervalMs = 1_000): void {
    this.timer = setInterval(() => void this.dispatchOnce(), intervalMs);
    this.timer.unref();
    void this.dispatchOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async dispatchOnce(): Promise<void> {
    if (this.dispatching) {
      return;
    }
    this.dispatching = true;
    try {
      const events = await this.store.getPendingOutboxEvents(25);
      for (const event of events) {
        if (event.type !== eventTypes.profilePreferencesUpdated) {
          continue;
        }
        if (!validateEventData(event.type, event.data)) {
          this.logger.error({ event_id: event.id, event_type: event.type }, "invalid outbox event");
          continue;
        }
        const data = event.data as {
          preferenceSetId: string;
          operationId: string;
        };
        try {
          await withTraceSpan("outbox.dispatch", event.traceparent, async () => {
            const traceparent = activeTraceparent();
            await this.temporal.workflow.start(profileReadinessWorkflow, {
              taskQueue: this.taskQueue,
              workflowId: `profile-readiness/${event.id}`,
              args: [
                {
                  preferenceSetId: data.preferenceSetId,
                  operationId: data.operationId,
                  ...(traceparent ? { traceparent } : {}),
                },
              ],
            });
            await this.store.markOutboxPublished(event.id);
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.name.includes("WorkflowExecutionAlreadyStarted")
          ) {
            throw error;
          }
          await this.store.markOutboxPublished(event.id);
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, "outbox dispatch failed");
    } finally {
      this.dispatching = false;
    }
  }
}
