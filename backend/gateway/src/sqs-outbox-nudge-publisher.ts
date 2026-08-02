import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { OutboxNudgePublisher } from "@ai-job-apply/profile-service";

interface SqsSender {
  send(command: SendMessageCommand): Promise<{ MessageId?: string }>;
}

export class SqsOutboxNudgePublisher implements OutboxNudgePublisher {
  private readonly sender: SqsSender;

  constructor(
    private readonly queueUrl: string,
    sender: SqsSender = new SQSClient({}),
  ) {
    this.sender = sender;
  }

  async publish(nudge: Parameters<OutboxNudgePublisher["publish"]>[0]): Promise<void> {
    const result = await this.sender.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(nudge),
      }),
    );
    if (!result.MessageId) {
      throw new Error("SqsMessageNotAccepted");
    }
  }
}
