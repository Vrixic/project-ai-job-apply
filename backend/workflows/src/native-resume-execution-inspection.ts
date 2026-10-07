import {
  isPreparationFunctionArn,
  matchesPreparationExecutionArn,
} from "@ai-job-apply/applications-service";
import {
  nativeResumeExecutionName,
  type PostgresNativeResumeRequestStore,
} from "@ai-job-apply/applications-service/native-resume-request-store";
import {
  GetDurableExecutionCommand,
  type GetDurableExecutionCommandOutput,
} from "@aws-sdk/client-lambda";

export interface NativeResumeExecutionReader {
  send(
    command: GetDurableExecutionCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<Partial<GetDurableExecutionCommandOutput>>;
}
const unavailable = () => Error("NativeResumeExecutionInspectionUnavailable");
/** Read-only original receipt inspection. Two calls/page fit the private observer budget.
 * No invocation, status settlement, DNS mutation, task retirement or replacement work. */
export function createNativeResumeExecutionInspection(options: {
  requests: Pick<PostgresNativeResumeRequestStore, "executionReceipts">;
  client: NativeResumeExecutionReader;
  workflowArns: readonly string[];
  enabled?: () => boolean;
}) {
  const arns = [...options.workflowArns];
  const base = arns[0]?.slice(0, arns[0].lastIndexOf(":"));
  if (
    !arns.length ||
    arns.length > 8 ||
    new Set(arns).size !== arns.length ||
    arns.some(
      (arn) =>
        !isPreparationFunctionArn(arn) ||
        !arn.startsWith("arn:aws:lambda:us-east-2:") ||
        arn.slice(0, arn.lastIndexOf(":")) !== base,
    )
  )
    throw unavailable();
  const enabled = options.enabled ?? (() => false);
  let active = false;
  const check = () => {
    if (!enabled()) throw unavailable();
  };
  return async (workflowArn: string, afterEventId: string | null) => {
    check();
    if (active || !arns.includes(workflowArn)) throw unavailable();
    if (afterEventId !== null) nativeResumeExecutionName(afterEventId);
    active = true;
    try {
      const rows = structuredClone(
        await options.requests.executionReceipts(workflowArn, afterEventId, 2),
      );
      check();
      if (rows.length > 2) throw unavailable();
      let previous = afterEventId;
      for (const row of rows) {
        const name = nativeResumeExecutionName(row.eventId);
        if (
          row.workflowArn !== workflowArn ||
          (previous !== null && row.eventId <= previous) ||
          (row.dispatchResult === "started"
            ? !row.executionArn ||
              !matchesPreparationExecutionArn(row.executionArn, workflowArn, name)
            : ![null, "no_resume"].includes(row.dispatchResult) || row.executionArn !== null)
        )
          throw unavailable();
        previous = row.eventId;
      }
      const results: Array<{
        eventId: string;
        executionArn: string | null;
        status:
          | "unknown"
          | "no_resume"
          | "RUNNING"
          | "SUCCEEDED"
          | "FAILED"
          | "TIMED_OUT"
          | "STOPPED";
      }> = [];
      for (const row of rows) {
        check();
        let status: (typeof results)[number]["status"] =
          row.dispatchResult === "no_resume" ? "no_resume" : "unknown";
        if (row.executionArn) {
          try {
            const value = await options.client.send(
              new GetDurableExecutionCommand({
                DurableExecutionArn: row.executionArn,
                IncludeExecutionData: false,
              }),
              { abortSignal: AbortSignal.timeout(10_000) },
            );
            check();
            const split = workflowArn.lastIndexOf(":");
            if (
              value.ExecutionDataIncluded !== false ||
              value.DurableExecutionArn !== row.executionArn ||
              value.FunctionArn !== workflowArn.slice(0, split) ||
              value.Version !== workflowArn.slice(split + 1) ||
              value.DurableExecutionName !== nativeResumeExecutionName(row.eventId) ||
              value.InputPayload !== undefined ||
              value.Result !== undefined ||
              value.Error !== undefined ||
              !(value.StartTimestamp instanceof Date) ||
              !Number.isFinite(value.StartTimestamp.getTime())
            )
              throw unavailable();
            if (value.Status === "RUNNING") {
              if (value.EndTimestamp !== undefined) throw unavailable();
              status = "RUNNING";
            } else if (
              (value.Status === "SUCCEEDED" ||
                value.Status === "FAILED" ||
                value.Status === "TIMED_OUT" ||
                value.Status === "STOPPED") &&
              value.EndTimestamp instanceof Date &&
              Number.isFinite(value.EndTimestamp.getTime()) &&
              value.EndTimestamp >= value.StartTimestamp
            )
              status = value.Status;
            else throw unavailable();
          } catch {
            status = "unknown";
          }
        }
        check();
        results.push({ eventId: row.eventId, executionArn: row.executionArn, status });
      }
      return Object.freeze({
        schemaVersion: 1 as const,
        results,
        nextAfterEventId: rows.length === 2 ? (rows[1]?.eventId ?? null) : null,
      });
    } finally {
      active = false;
    }
  };
}
