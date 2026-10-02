import {
  isPreparationFunctionArn,
  MAX_PREPARATION_DISPATCH_BATCH,
  matchesPreparationExecutionArn,
  type PostgresApplicationStore,
  type PreparationDispatch,
  PreparationDispatchError,
  type PreparationTerminalStatus,
  preparationExecutionName,
} from "@ai-job-apply/applications-service";
import type { ApplicationPreparationDurableInput } from "./application-preparation-contract.js";
import { PreparationDispatchPendingError } from "./application-preparation-dispatch.js";

export type PreparationRecoveryStore = Pick<
  PostgresApplicationStore,
  | "claimPreparationNudges"
  | "claimPreparationExecutionsForReconciliation"
  | "getPreparationDispatch"
  | "settlePreparationExecution"
>;
export type PreparationExecutionMetadata =
  | { status: "RUNNING"; startTimestamp: Date }
  | { status: PreparationTerminalStatus; startTimestamp: Date; endTimestamp: Date };
export interface PreparationStatusReader {
  read(dispatch: PreparationDispatch): Promise<PreparationExecutionMetadata>;
}
export interface PreparationNudgePublisher {
  publish(payload: ApplicationPreparationDurableInput): Promise<void>;
}

/** Recovery of accepted work remains enabled even when new dispatch is disabled. */
export function createPreparationReconciler(
  store: PreparationRecoveryStore,
  publisher: PreparationNudgePublisher,
  status: PreparationStatusReader,
  options: { dispatchEnabled?: boolean; batchSize?: number; elapsedMs?: () => number } = {},
) {
  const limit = options.batchSize ?? MAX_PREPARATION_DISPATCH_BATCH;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PREPARATION_DISPATCH_BATCH)
    throw new PreparationDispatchError();
  const elapsed = options.elapsedMs ?? (() => performance.now());
  const dispatchEnabled = options.dispatchEnabled === true;
  const reconcile = async () => {
    const began = elapsed();
    if (!Number.isFinite(began)) throw new PreparationDispatchError();
    const withinBudget = () => {
      const current = elapsed();
      if (!Number.isFinite(current) || current < began) throw new PreparationDispatchError();
      return current - began < 50_000;
    };
    let inspected = 0;
    let settled = 0;
    let sent = 0;
    let failed = 0;
    const executions = await store.claimPreparationExecutionsForReconciliation(limit);
    for (const dispatch of executions) {
      if (!withinBudget()) break;
      inspected += 1;
      try {
        const result = await status.read(dispatch);
        if (result.status !== "RUNNING") {
          if (!dispatch.executionArn) throw new PreparationDispatchError();
          if (
            !(await store.settlePreparationExecution({
              eventId: dispatch.eventId,
              preparationId: dispatch.preparationId,
              functionArn: dispatch.functionArn,
              executionName: dispatch.executionName,
              executionArn: dispatch.executionArn,
              ...result,
            }))
          )
            throw new PreparationDispatchPendingError();
          settled += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (dispatchEnabled && withinBudget()) {
      const nudges = await store.claimPreparationNudges(limit);
      for (const nudge of nudges) {
        if (!withinBudget()) break;
        try {
          await publisher.publish({
            schemaVersion: 1,
            eventId: nudge.eventId,
            eventType: "application.packet-preparation.requested.v1",
            data: { preparationId: nudge.preparationId },
          });
          sent += 1;
        } catch {
          failed += 1;
        }
      }
    }
    // No candidate values, raw provider errors or execution data leave this boundary.
    return { inspected, settled, sent, failed };
  };
  return async () => {
    try {
      return await reconcile();
    } catch (error) {
      if (error instanceof PreparationDispatchError) throw error;
      throw new PreparationDispatchPendingError();
    }
  };
}

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every(
      (key) =>
        typeof key === "string" &&
        keys.includes(key) &&
        Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
    )
  );
}
function timestamp(value: unknown): Date | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
  )
    return;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 19) === value.slice(0, 19)
    ? parsed
    : undefined;
}
function resourcesArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 1)
    return false;
  return (
    Reflect.ownKeys(value).length === value.length + 1 &&
    (value.length === 0 ||
      (Object.getOwnPropertyDescriptor(value, "0")?.enumerable === true &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, "0") ?? {}, "value") &&
        typeof Object.getOwnPropertyDescriptor(value, "0")?.value === "string"))
  );
}
// EventBridge event IDs are opaque GUID-shaped identifiers, not our domain UUID contract.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

/** EventBridge is a nudge, not settlement authority. AWS metadata independently confirms it. */
export function createPreparationTerminalHandler(
  currentFunctionArn: string,
  store: PreparationRecoveryStore,
  status: PreparationStatusReader,
  now: () => Date = () => new Date(),
) {
  if (!isPreparationFunctionArn(currentFunctionArn)) throw new PreparationDispatchError();
  const scope = currentFunctionArn.split(":");
  const base = currentFunctionArn.slice(0, currentFunctionArn.lastIndexOf(":"));
  return async (value: unknown): Promise<{ handled: boolean }> => {
    const time = now();
    if (!(time instanceof Date) || !Number.isFinite(time.getTime()))
      throw new PreparationDispatchError();
    if (
      !record(value, [
        "version",
        "id",
        "detail-type",
        "source",
        "account",
        "time",
        "region",
        "resources",
        "detail",
      ])
    )
      throw new PreparationDispatchError();
    const envelope = timestamp(value.time);
    if (
      value.version !== "0" ||
      typeof value.id !== "string" ||
      !UUID.test(value.id) ||
      value.source !== "aws.lambda" ||
      value["detail-type"] !== "Durable Execution Status Change" ||
      value.account !== scope[4] ||
      value.region !== scope[3] ||
      !envelope ||
      envelope.getTime() < time.getTime() - 14 * 86_400_000 ||
      envelope.getTime() > time.getTime() + 300_000 ||
      !resourcesArray(value.resources) ||
      !record(value.detail, [
        "durableExecutionArn",
        "durableExecutionName",
        "functionArn",
        "status",
        "startTimestamp",
        "endTimestamp",
      ])
    )
      throw new PreparationDispatchError();
    const detail = value.detail;
    const start = timestamp(detail.startTimestamp);
    const end = timestamp(detail.endTimestamp);
    if (
      !isPreparationFunctionArn(detail.functionArn) ||
      detail.functionArn.slice(0, detail.functionArn.lastIndexOf(":")) !== base ||
      (value.resources.length === 1 && value.resources[0] !== detail.functionArn) ||
      typeof detail.durableExecutionName !== "string" ||
      !detail.durableExecutionName.startsWith("preparation-") ||
      typeof detail.durableExecutionArn !== "string" ||
      !matchesPreparationExecutionArn(
        detail.durableExecutionArn,
        detail.functionArn,
        detail.durableExecutionName,
      ) ||
      typeof detail.status !== "string" ||
      !["SUCCEEDED", "FAILED", "STOPPED", "TIMED_OUT"].includes(detail.status) ||
      !start ||
      !end ||
      end < start ||
      Math.abs(end.getTime() - envelope.getTime()) > 300_000
    )
      throw new PreparationDispatchError();
    const eventId = detail.durableExecutionName.slice("preparation-".length);
    if (preparationExecutionName(eventId) !== detail.durableExecutionName)
      throw new PreparationDispatchError();
    try {
      const dispatch = await store.getPreparationDispatch(eventId);
      if (!dispatch) return { handled: false };
      if (
        dispatch.functionArn !== detail.functionArn ||
        dispatch.executionName !== detail.durableExecutionName ||
        (dispatch.executionArn && dispatch.executionArn !== detail.durableExecutionArn)
      )
        throw new PreparationDispatchError();
      const verified = await status.read({ ...dispatch, executionArn: detail.durableExecutionArn });
      if (
        verified.status === "RUNNING" ||
        verified.status !== detail.status ||
        verified.startTimestamp.getTime() !== start.getTime() ||
        verified.endTimestamp.getTime() !== end.getTime()
      )
        throw new PreparationDispatchError();
      const handled = await store.settlePreparationExecution({
        eventId,
        preparationId: dispatch.preparationId,
        functionArn: dispatch.functionArn,
        executionName: dispatch.executionName,
        executionArn: detail.durableExecutionArn,
        ...verified,
      });
      return { handled };
    } catch (error) {
      if (error instanceof PreparationDispatchError) throw error;
      throw new PreparationDispatchPendingError();
    }
  };
}
