import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { DeliveryProviderError, type EmailMessage, type EmailProvider } from "../delivery.js";

interface Sender {
  send(command: SendEmailCommand): Promise<{ MessageId?: string | undefined }>;
}

export interface SesEmailProviderOptions {
  /** A mailbox or domain identity verified in SES, for example "ApplyDash <no-reply@example.com>". */
  fromAddress: string;
  configurationSetName?: string;
  region?: string;
  /** Test seam. Production uses the default SES client. */
  client?: Sender;
}

/** Rejections that retrying cannot fix for this recipient. Everything else is retried. */
const permanentRejections = new Set(["MessageRejected"]);

export class SesEmailProvider implements EmailProvider {
  private readonly client: Sender;

  constructor(private readonly options: SesEmailProviderOptions) {
    this.client =
      options.client ?? new SESv2Client({ ...(options.region ? { region: options.region } : {}) });
  }

  async send(message: EmailMessage): Promise<{ reference: string }> {
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.options.fromAddress,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: { Text: { Data: message.text, Charset: "UTF-8" } },
            },
          },
          ...(this.options.configurationSetName
            ? { ConfigurationSetName: this.options.configurationSetName }
            : {}),
        }),
      );
      return { reference: result.MessageId ?? "unknown" };
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      throw new DeliveryProviderError(permanentRejections.has(name), `ses_${name}`.slice(0, 64));
    }
  }
}
