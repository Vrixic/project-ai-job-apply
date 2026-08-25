import {
  eventTypes,
  type OutboxNudgeV1,
  validateEventData,
  validateOutboxNudge,
} from "@ai-job-apply/event-contracts";
import {
  buildOutboxNudge,
  errorCodeFromUnknown,
  type OutboxNudgePublisher,
  type ServerlessOutboxStore,
  verifyOutboxNudgeIntegrity,
} from "@ai-job-apply/profile-service";

export interface DurableExecutionPayloadV1 {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  data: Record<string, unknown>;
  traceparent?: string;
}

export interface DurableExecutionClient {
  start(input: {
    executionName: string;
    payload: DurableExecutionPayloadV1;
  }): Promise<{ executionArn?: string }>;
}

export interface OutboxLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export class OutboxNudgeRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxNudgeRejectedError";
  }
}

export function durableExecutionName(eventId: string): string {
  return `outbox-${eventId}`;
}

export class ServerlessOutboxStarter {
  constructor(
    private readonly store: ServerlessOutboxStore,
    private readonly durable: DurableExecutionClient,
    private readonly logger: OutboxLogger,
  ) {}

  async process(value: unknown): Promise<void> {
    if (!validateOutboxNudge(value) || !verifyOutboxNudgeIntegrity(value)) {
      throw new OutboxNudgeRejectedError("The outbox nudge contract or integrity check failed");
    }
    const nudge: OutboxNudgeV1 = value;
    const event = await this.store.getDurableOutboxEvent(nudge.eventId);
    if (!event || event.type !== nudge.eventType) {
      throw new OutboxNudgeRejectedError("The authoritative outbox event was not found");
    }

    const executionName = durableExecutionName(event.id);
    if (event.publishedAt) {
      if (event.durableExecutionName !== executionName) {
        throw new OutboxNudgeRejectedError(
          "The outbox event has an inconsistent execution identity",
        );
      }
      return;
    }
    const supportedEventTypes: ReadonlySet<string> = new Set([
      eventTypes.profilePreferencesUpdated,
      eventTypes.profileDataExportRequested,
      eventTypes.profileAccountDeletionConfirmed,
    ]);
    if (!supportedEventTypes.has(event.type) || !validateEventData(event.type, event.data)) {
      throw new OutboxNudgeRejectedError(
        "The authoritative event is not a supported workflow input",
      );
    }

    const payload: DurableExecutionPayloadV1 = {
      schemaVersion: 1,
      eventId: event.id,
      eventType: event.type,
      data: event.data,
      ...(event.traceparent ? { traceparent: event.traceparent } : {}),
    };
    try {
      const accepted = await this.durable.start({ executionName, payload });
      await this.store.acknowledgeDurableOutboxStart(
        event.id,
        executionName,
        accepted.executionArn,
      );
      this.logger.info(
        { event_id: event.id, event_type: event.type, execution_name: executionName },
        "durable outbox start accepted",
      );
    } catch (error) {
      try {
        await this.store.recordDurableOutboxStartFailure(event.id, errorCodeFromUnknown(error));
      } catch {
        // SQS retry and the unacknowledged outbox row remain the recovery mechanism.
      }
      throw error;
    }
  }
}

export class ServerlessOutboxReconciler {
  constructor(
    private readonly store: ServerlessOutboxStore,
    private readonly publisher: OutboxNudgePublisher,
    private readonly logger: OutboxLogger,
    private readonly options: {
      batchSize?: number;
      claimLeaseSeconds?: number;
      retryDelaySeconds?: number;
      now?: () => Date;
    } = {},
  ) {}

  async reconcileOnce(): Promise<{ claimed: number; sent: number; failed: number }> {
    const now = (this.options.now ?? (() => new Date()))();
    const staleBefore = new Date(now.getTime() - (this.options.claimLeaseSeconds ?? 60) * 1_000);
    const nextAttemptAt = new Date(now.getTime() + (this.options.retryDelaySeconds ?? 300) * 1_000);
    const events = await this.store.claimOutboxNudges(this.options.batchSize ?? 25, staleBefore);
    let sent = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await this.publisher.publish(buildOutboxNudge(event.id, event.type, event.traceparent));
        await this.store.recordOutboxNudgeSucceeded(event.id, nextAttemptAt);
        sent += 1;
      } catch (error) {
        failed += 1;
        try {
          await this.store.recordOutboxNudgeFailed(
            event.id,
            errorCodeFromUnknown(error),
            nextAttemptAt,
          );
        } catch (recordingError) {
          try {
            await this.store.releaseOutboxNudgeClaim(event.id);
          } catch {
            // The bounded lease makes an abandoned claim recoverable.
          }
          this.logger.error(
            {
              event_id: event.id,
              event_type: event.type,
              error_code: errorCodeFromUnknown(recordingError),
            },
            "outbox nudge failure could not be recorded",
          );
        }
      }
    }
    this.logger.info({ claimed: events.length, sent, failed }, "outbox reconciliation completed");
    return { claimed: events.length, sent, failed };
  }
}
