export const PREPARATION_DISPATCH_LEASE_MS = 60_000;
export const MAX_PREPARATION_DISPATCH_BATCH = 25;
export type PreparationTerminalStatus = "SUCCEEDED" | "FAILED" | "STOPPED" | "TIMED_OUT";
export interface PreparationNudge {
  eventId: string;
  preparationId: string;
}
export interface PreparationDispatch extends PreparationNudge {
  functionArn: string;
  executionName: string;
  boundAt: Date;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  executionArn: string | null;
  startedAt: Date | null;
  terminalStatus: PreparationTerminalStatus | null;
}
export type PreparationDispatchClaim =
  | { kind: "claimed"; dispatch: PreparationDispatch }
  | { kind: "started"; dispatch: PreparationDispatch }
  | { kind: "busy" | "terminal" | "missing" };
export interface PreparationTerminalInput extends PreparationNudge {
  functionArn: string;
  executionName: string;
  executionArn: string;
  status: PreparationTerminalStatus;
  startTimestamp: Date;
  endTimestamp: Date;
}
export class PreparationDispatchError extends Error {
  constructor() {
    super("PreparationDispatchRejected");
    this.name = "PreparationDispatchError";
  }
}
export function isPreparationFunctionArn(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    /^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]{1,64}:[1-9]\d*$/u.test(
      value,
    )
  );
}
export function preparationExecutionName(eventId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(eventId))
    throw new PreparationDispatchError();
  return `preparation-${eventId.toLowerCase()}`;
}
export function matchesPreparationExecutionArn(
  value: string,
  functionArn: string,
  name: string,
): boolean {
  const prefix = `${functionArn}/durable-execution/${name}/`;
  return (
    isPreparationFunctionArn(functionArn) &&
    typeof value === "string" &&
    value.length <= 1_024 &&
    value.startsWith(prefix) &&
    /^[A-Za-z0-9_-]+$/u.test(value.slice(prefix.length))
  );
}
