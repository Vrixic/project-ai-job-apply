import {
  DeliveryProviderError,
  type DispatchSummary,
  type EmailMessage,
  type EmailProvider,
  NotificationDispatcher,
  PostgresDeliveryStore,
  PostgresNotificationsStore,
  type PushProvider,
  type PushResult,
} from "@ai-job-apply/notifications-service";
import { SesEmailProvider, WebPushProvider } from "@ai-job-apply/notifications-service/providers";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";

/** What one scheduled run reports. Counts only: no address, endpoint, code or item detail. */
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
    return { schemaVersion: 1, expired, ...summary };
  };
}

export interface NotificationsVapidSecret {
  publicKey: string;
  privateKeyPem: string;
  subject: string;
}

type Fetch = typeof fetch;

/**
 * Reads the VAPID identity through the Lambda Parameters and Secrets extension, the same local
 * path the candidate-rights Auth0 secret uses. Exact shape, bounded size, no logging of values.
 */
export async function readNotificationsVapidSecret(
  secretId: string | undefined,
  options: { sessionToken?: string; fetchImplementation?: Fetch } = {},
): Promise<NotificationsVapidSecret> {
  if (!secretId || !options.sessionToken) {
    throw new Error("NotificationsVapidSecretContextUnavailable");
  }
  const endpoint = new URL("http://localhost:2773/secretsmanager/get");
  endpoint.searchParams.set("secretId", secretId);
  const response = await (options.fetchImplementation ?? fetch)(endpoint, {
    headers: { "X-Aws-Parameters-Secrets-Token": options.sessionToken },
    signal: AbortSignal.timeout(3_000),
  }).catch(() => undefined);
  if (!response?.ok) throw new Error("NotificationsVapidSecretUnavailable");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 16 * 1024)) {
    throw new Error("NotificationsVapidSecretInvalid");
  }
  let secret: unknown;
  try {
    const envelope = JSON.parse(await response.text()) as { SecretString?: unknown };
    if (typeof envelope.SecretString !== "string" || envelope.SecretString.length > 16 * 1024) {
      throw new Error();
    }
    secret = JSON.parse(envelope.SecretString);
  } catch {
    throw new Error("NotificationsVapidSecretInvalid");
  }
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) {
    throw new Error("NotificationsVapidSecretInvalid");
  }
  const record = secret as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "privateKeyPem,publicKey,subject" ||
    typeof record.publicKey !== "string" ||
    typeof record.privateKeyPem !== "string" ||
    typeof record.subject !== "string"
  ) {
    throw new Error("NotificationsVapidSecretInvalid");
  }
  return {
    publicKey: record.publicKey,
    privateKeyPem: record.privateKeyPem,
    subject: record.subject,
  };
}

/** A provider that is not configured fails transiently, so nothing is lost or expired. */
class UnavailableEmail implements EmailProvider {
  async send(_message: EmailMessage): Promise<{ reference: string }> {
    throw new DeliveryProviderError(false, "email_not_configured");
  }
}
class UnavailablePush implements PushProvider {
  async send(_endpoint: string): Promise<PushResult> {
    throw new DeliveryProviderError(false, "push_not_configured");
  }
}

const SES_ADDRESS =
  /^[^\s<>@"]{1,64}@[a-z0-9.-]{1,255}$|^[^<>"\r\n]{1,100} <[^\s<>@"]{1,64}@[a-z0-9.-]{1,255}>$/iu;

/** Builds the scheduled dispatcher from the Lambda environment. */
export async function createRuntimeNotificationsDispatcher(
  environment: NodeJS.ProcessEnv,
  database: DatabaseHandle,
  options: { fetchImplementation?: Fetch } = {},
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
  let push: PushProvider = new UnavailablePush();
  if (environment.NOTIFICATIONS_VAPID_SECRET_ID) {
    const secret = await readNotificationsVapidSecret(environment.NOTIFICATIONS_VAPID_SECRET_ID, {
      ...(environment.AWS_SESSION_TOKEN ? { sessionToken: environment.AWS_SESSION_TOKEN } : {}),
      ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {}),
    });
    push = new WebPushProvider(secret);
  }
  const store = new PostgresDeliveryStore(database.client);
  return {
    dispatcher: new NotificationDispatcher({ store, email, push, webBaseUrl }),
    expireDue: () => new PostgresNotificationsStore(database.client).expireDue(new Date()),
  };
}
