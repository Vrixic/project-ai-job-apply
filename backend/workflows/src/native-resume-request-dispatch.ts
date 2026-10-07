import { isDeepStrictEqual } from "node:util";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  nativeResumeExecutionName,
  type PostgresNativeResumeRequestStore,
} from "@ai-job-apply/applications-service/native-resume-request-store";
import type {
  NativeResumeReservation,
  PostgresNativeResumeGenerationStore,
} from "@ai-job-apply/documents-service/native-resume-generation-store";
import { validateNativeResumePreparationControlInput } from "@ai-job-apply/documents-service/native-resume-preparation-control-contract";
import type { PreparationLambdaInvoker } from "./application-preparation-dispatch-aws.js";

/** Queue delivery uses an original named durable execution. SQL capture commits before AWS.
 * Ambiguous delivery keeps its lease and original reservation for a later identical dispatch. */
export function createNativeResumeRequestDispatcher(options: {
  requests: Pick<PostgresNativeResumeRequestStore, "claim" | "started" | "withoutResume">;
  generations: Pick<PostgresNativeResumeGenerationStore, "reserveRequest">;
  jobContext(application: NativeResumeReservation["application"]): Promise<string>;
  deployment: NativeResumeReservation["deployment"];
  workflowArn: string;
  invoker: PreparationLambdaInvoker;
  enabled?: () => boolean;
}) {
  const enabled = options.enabled ?? (() => false);
  const deployment = structuredClone(options.deployment),
    target = options.workflowArn;
  const check = () => {
    if (!enabled()) throw Error("NativeResumeDispatchUnavailable");
  };
  return async (eventId: string): Promise<"started" | "unavailable" | "no_resume"> => {
    check();
    const claim = await options.requests.claim(eventId, target);
    check();
    if (!claim) return "unavailable";
    const context = await options.jobContext(claim.application);
    check();
    const original = await options.generations.reserveRequest({
      generationId: claim.eventId,
      application: claim.application,
      jobContextSha256: context,
      deployment,
    });
    check();
    if (!original) {
      if (!(await options.requests.withoutResume(claim)))
        throw Error("NativeResumeDispatchUnavailable");
      return "no_resume";
    }
    const payload = {
      schemaVersion: 1 as const,
      action: "start" as const,
      reservation: original.reservation,
    };
    if (
      !validateNativeResumePreparationControlInput(payload) ||
      original.reservation.identity.generationId !== claim.eventId ||
      !isDeepStrictEqual(original.reservation.application, claim.application)
    )
      throw Error("NativeResumeDispatchUnavailable");
    const response = await options.invoker.send(
      new InvokeCommand({
        FunctionName: claim.workflowArn,
        InvocationType: "Event",
        DurableExecutionName: nativeResumeExecutionName(claim.eventId),
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    check();
    if (
      response.StatusCode !== 202 ||
      !response.DurableExecutionArn ||
      !(await options.requests.started(claim, response.DurableExecutionArn))
    )
      throw Error("NativeResumeDispatchUnavailable");
    return "started";
  };
}
