import {
  isPreparationFunctionArn,
  matchesPreparationExecutionArn,
  type PostgresApplicationStore,
  PreparationDispatchError,
  preparationExecutionName,
} from "@ai-job-apply/applications-service";
import {
  type ApplicationPreparationDurableInput,
  validateApplicationPreparationDurableInput,
} from "./application-preparation-contract.js";
import { PreparationDispatchPendingError } from "./application-preparation-errors.js";

export type PreparationStarterStore = Pick<
  PostgresApplicationStore,
  "claimPreparationDispatch" | "markPreparationStarted"
>;
export interface PreparationExecutionStarter {
  start(input: {
    functionArn: string;
    executionName: string;
    payload: ApplicationPreparationDurableInput;
  }): Promise<{ executionArn: string }>;
}
export { PreparationDispatchPendingError } from "./application-preparation-errors.js";

/** No environment bootstrap or provider activation. The caller must supply owned private ports. */
export function createPreparationStarter(
  functionArn: string,
  store: PreparationStarterStore,
  execution: PreparationExecutionStarter,
): (value: unknown) => Promise<void> {
  if (!isPreparationFunctionArn(functionArn)) throw new PreparationDispatchError();
  return async (value) => {
    if (!validateApplicationPreparationDurableInput(value)) throw new PreparationDispatchError();
    // Snapshot the identifier-only input before asynchronous I/O. Canonical lowercase UUIDs make
    // duplicate deliveries byte-identical even when a transport changes UUID casing.
    const eventId = value.eventId.toLowerCase();
    const preparationId = value.data.preparationId.toLowerCase();
    try {
      const claim = await store.claimPreparationDispatch(eventId, functionArn, preparationId);
      if (claim.kind === "missing" || claim.kind === "terminal" || claim.kind === "started") return;
      if (claim.kind === "busy") throw new PreparationDispatchPendingError();
      if (claim.kind !== "claimed") throw new PreparationDispatchError();
      const dispatch = claim.dispatch;
      const executionName = preparationExecutionName(eventId);
      if (
        dispatch.eventId !== eventId ||
        dispatch.preparationId !== preparationId ||
        dispatch.executionName !== executionName ||
        !isPreparationFunctionArn(dispatch.functionArn) ||
        dispatch.functionArn.slice(0, dispatch.functionArn.lastIndexOf(":")) !==
          functionArn.slice(0, functionArn.lastIndexOf(":")) ||
        !dispatch.leaseId ||
        dispatch.executionArn !== null ||
        dispatch.terminalStatus !== null
      )
        throw new PreparationDispatchError();
      const accepted = await execution.start({
        functionArn: dispatch.functionArn,
        executionName,
        payload: {
          schemaVersion: 1,
          eventId,
          eventType: "application.packet-preparation.requested.v1",
          data: { preparationId },
        },
      });
      if (
        !matchesPreparationExecutionArn(accepted.executionArn, dispatch.functionArn, executionName)
      )
        throw new PreparationDispatchError();
      if (!(await store.markPreparationStarted(eventId, dispatch.leaseId, accepted.executionArn)))
        throw new PreparationDispatchPendingError();
    } catch (error) {
      if (
        error instanceof PreparationDispatchError ||
        error instanceof PreparationDispatchPendingError
      )
        throw error;
      // Ambiguous Invoke/receipt failures retain the owned lease and original binding. Never
      // expose provider, SQL or SDK details; a later nudge repeats the same name and payload.
      throw new PreparationDispatchPendingError();
    }
  };
}
