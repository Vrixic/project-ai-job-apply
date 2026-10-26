import {
  DeliveryProviderError,
  type DispatchSummary,
  type EmailMessage,
  type EmailProvider,
  NotificationDispatcher,
  PostgresDeliveryStore,
  PostgresNotificationsStore,
} from "@ai-job-apply/notifications-service";
import { SesEmailProvider } from "@ai-job-apply/notifications-service/providers";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";

/** What one scheduled run reports. Counts only: no address or item detail. */
export interface NotificationsDispatchResult extends DispatchSummary {
  schemaVersion: 1;
  expired: number;
}

const RULE_ARN =
  /^arn:(aws|aws-us-gov|aws-cn):events:([a-z]{2}(?:-[a-z]+)+-[0-9]):([0-9]{12}):rule\/[A-Za-z0-9._/-]+$/u;

/** The exact EventBridge scheduled event of the dispatch rule, nothing else. */
export function isNotificationsDispatchEvent(value: unknown, expectedRuleArn: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const rule = RULE_ARN.exec(expectedRuleArn);
  return (
    rule !== null &&
    event.account === rule[3] &&
    event.region === rule[2] &&
    event.source === "aws.events" &&
    event["detail-type"] === "Scheduled Event" &&
    Array.isArray(event.resources) &&
    event.resources.length === 1 &&
    event.resources[0] === expectedRuleArn &&
    !!event.detail &&
    typeof event.detail === "object" &&
    !Array.isArray(event.detail) &&
    Object.keys(event.detail as object).length === 0
  );
}

export function createNotificationsDispatchHandler(options: {
  dispatcher: { run(): Promise<DispatchSummary> };
  expireDue: () => Promise<number>;
  expectedRuleArn: string;
  log?: (entry: Record<string, string | number>) => void;
}): (event: unknown) => Promise<NotificationsDispatchResult> {
  if (!RULE_ARN.test(options.expectedRuleArn)) {
    throw new Error("NotificationsDispatchConfigurationInvalid");
  }
  return async (event) => {
    if (!isNotificationsDispatchEvent(event, options.expectedRuleArn)) {
      throw new Error("NotificationsDispatchEventRejected");
    }
    // Expiry never blocks delivery, and delivery never blocks expiry; any failure is raised after
    // both ran so the Lambda error and rule dead-letter alarms fire.
    let expired = 0;
    let expiryFailure: unknown;
    try {
      expired = await options.expireDue();
    } catch (error) {
      expiryFailure = error;
    }
    let summary: DispatchSummary | undefined;
    let dispatchFailure: unknown;
    try {
      summary = await options.dispatcher.run();
    } catch (error) {
      dispatchFailure = error;
    }
    if (dispatchFailure !== undefined) throw dispatchFailure;
    if (expiryFailure !== undefined) throw expiryFailure;
    if (!summary) throw new Error("NotificationsDispatchResultMissing");
    // Quiet runs stay quiet: the rule fires every minute.
    if (summary.sent + summary.skipped + summary.failed + summary.retried + summary.deferred > 0) {
      options.log?.({ event: "notifications_dispatched", expired, ...summary });
    }
    return { schemaVersion: 1, expired, ...summary };
  };
}

/** A provider that is not configured fails transiently, so nothing is lost. */
class UnavailableEmail implements EmailProvider {
  async send(_message: EmailMessage): Promise<{ reference: string }> {
    throw new DeliveryProviderError(false, "email_not_configured");
  }
}

const SES_ADDRESS =
  /^[^\s<>@"]{1,64}@[a-z0-9.-]{1,255}$|^[^<>"\r\n]{1,100} <[^\s<>@"]{1,64}@[a-z0-9.-]{1,255}>$/iu;

/** Builds the scheduled dispatcher from the Lambda environment. */
export async function createRuntimeNotificationsDispatcher(
  environment: NodeJS.ProcessEnv,
  database: DatabaseHandle,
): Promise<{ dispatcher: NotificationDispatcher; expireDue: () => Promise<number> }> {
  const webBaseUrl = environment.NOTIFICATIONS_WEB_BASE_URL;
  if (!webBaseUrl || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?\/?$/iu.test(webBaseUrl)) {
    throw new Error("NotificationsDispatchConfigurationInvalid");
  }
  const from = environment.NOTIFICATIONS_EMAIL_FROM;
  if (from !== undefined && from !== "" && !SES_ADDRESS.test(from)) {
    throw new Error("NotificationsDispatchConfigurationInvalid");
  }
  const email: EmailProvider = from
    ? new SesEmailProvider({
        fromAddress: from,
        ...(environment.NOTIFICATIONS_SES_CONFIGURATION_SET
          ? { configurationSetName: environment.NOTIFICATIONS_SES_CONFIGURATION_SET }
          : {}),
        ...(environment.AWS_REGION ? { region: environment.AWS_REGION } : {}),
      })
    : new UnavailableEmail();
  const store = new PostgresDeliveryStore(database.client);
  return {
    dispatcher: new NotificationDispatcher({
      store,
      email,
      webBaseUrl,
      log: (entry) => console.error(entry),
    }),
    expireDue: () => new PostgresNotificationsStore(database.client).expireDue(new Date()),
  };
}
