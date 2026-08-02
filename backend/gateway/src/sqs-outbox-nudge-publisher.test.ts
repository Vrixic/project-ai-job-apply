import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it, vi } from "vitest";
import { buildOutboxNudge } from "@ai-job-apply/profile-service";
import { SqsOutboxNudgePublisher } from "./sqs-outbox-nudge-publisher.js";

describe("SqsOutboxNudgePublisher", () => {
  it("sends only the versioned identifier-only nudge", async () => {
    const send = vi.fn(async (_command: SendMessageCommand) => ({ MessageId: "accepted" }));
    const publisher = new SqsOutboxNudgePublisher("https://sqs.us-east-2.amazonaws.com/queue", {
      send,
    });
    const nudge = buildOutboxNudge(
      "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      "profile.preferences.updated.v1",
    );

    await publisher.publish(nudge);

    const command = send.mock.calls[0]?.[0];
    expect(command?.input.QueueUrl).toContain("sqs.us-east-2.amazonaws.com");
    expect(JSON.parse(command?.input.MessageBody ?? "null")).toEqual(nudge);
    expect(command?.input.MessageBody).not.toContain("locations");
  });

  it("fails closed when SQS does not return an accepted message identity", async () => {
    const publisher = new SqsOutboxNudgePublisher("https://sqs.us-east-2.amazonaws.com/queue", {
      send: vi.fn(async () => ({})),
    });

    await expect(
      publisher.publish(
        buildOutboxNudge("019b4e12-7ea3-7c36-9357-aea35ab542ca", "profile.preferences.updated.v1"),
      ),
    ).rejects.toThrow("SqsMessageNotAccepted");
  });
});
