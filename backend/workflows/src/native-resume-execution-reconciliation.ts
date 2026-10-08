import type {
  NativeResumeExecutionTerminalStatus,
  PostgresNativeResumeRequestStore,
} from "@ai-job-apply/applications-service/native-resume-request-store";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  createNativeResumeExecutionInspection,
  type NativeResumeExecutionReader,
} from "./native-resume-execution-inspection.js";

const unavailable = () => Error("NativeResumeExecutionReconciliationUnavailable");
/** At-least-once scalar failure notices. A lost queue ACK may duplicate a notice, never an
 * execution/task. The owning claim rotates through the full original receipt inventory. */
export function createNativeResumeExecutionReconciliation(options: {
  requests: Pick<
    PostgresNativeResumeRequestStore,
    "claimExecutionObservations" | "recordExecutionObservation"
  >;
  client: NativeResumeExecutionReader;
  workflowArns: readonly string[];
  queueArn: string;
  enabled: () => boolean;
  testQueue?: Pick<SQSClient, "send">;
}) {
  const arns = [...options.workflowArns];
  // Validate the immutable original-version allowlist before allocating transport.
  createNativeResumeExecutionInspection({
    requests: { executionReceipts: async () => [] },
    client: options.client,
    workflowArns: arns,
    enabled: options.enabled,
  });
  const account = arns[0]?.split(":")[4];
  const matched = new RegExp(`^arn:aws:sqs:us-east-2:${account}:([A-Za-z0-9_-]{1,80})$`, "u").exec(
    options.queueArn,
  );
  if (!matched || (options.testQueue && process.env.NODE_ENV !== "test")) throw unavailable();
  const queueUrl = `https://sqs.us-east-2.amazonaws.com/${account}/${matched[1]}`;
  const queue =
    options.testQueue ??
    new SQSClient({
      region: "us-east-2",
      endpoint: "https://sqs.us-east-2.amazonaws.com",
      maxAttempts: 1,
    });
  let active = false;
  const check = () => {
    if (!options.enabled() || (options.testQueue && process.env.NODE_ENV !== "test"))
      throw unavailable();
  };
  return async () => {
    check();
    if (active) throw unavailable();
    active = true;
    try {
      const claims = structuredClone(await options.requests.claimExecutionObservations(arns));
      check();
      if (claims.length > 2 || new Set(claims.map((x) => x.eventId)).size !== claims.length)
        throw unavailable();
      let notified = 0,
        unresolved = 0;
      for (const claim of claims) {
        check();
        if (!arns.includes(claim.workflowArn)) throw unavailable();
        let status: NativeResumeExecutionTerminalStatus | null = claim.terminalStatus;
        if (status === null) {
          const inspect = createNativeResumeExecutionInspection({
            requests: {
              executionReceipts: async () => [
                {
                  eventId: claim.eventId,
                  workflowArn: claim.workflowArn,
                  executionArn: claim.executionArn,
                  dispatchResult: "started",
                },
              ],
            },
            client: options.client,
            workflowArns: arns,
            enabled: options.enabled,
          });
          const observed = (await inspect(claim.workflowArn, null)).results[0]?.status;
          status =
            observed && ["SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"].includes(observed)
              ? (observed as NativeResumeExecutionTerminalStatus)
              : null;
        }
        check();
        if (!(await options.requests.recordExecutionObservation(claim, status))) {
          unresolved++;
          continue;
        }
        if (status === null) {
          unresolved++;
          continue;
        }
        if (status === "SUCCEEDED") continue;
        check();
        const reply = await queue.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              schemaVersion: 1,
              kind: "native_resume_terminal",
              executionArn: claim.executionArn,
              functionArn: claim.workflowArn.slice(0, claim.workflowArn.lastIndexOf(":")),
              status,
            }),
          }),
          { abortSignal: AbortSignal.timeout(5_000) },
        );
        check();
        if (!reply.MessageId || !/^[a-f0-9-]{36}$/u.test(reply.MessageId)) throw unavailable();
        if (await options.requests.recordExecutionObservation(claim, status, true)) notified++;
        else unresolved++;
      }
      check();
      return Object.freeze({
        schemaVersion: 1 as const,
        inspected: claims.length,
        notified,
        unresolved,
      });
    } finally {
      active = false;
    }
  };
}
