import { createNativeResumeDnsRoute } from "@ai-job-apply/documents-service/native-resume-dns-route";
import {
  type NativeResumeRouteIntent,
  nativeResumeRouteIntent,
} from "@ai-job-apply/documents-service/native-resume-route-policy";
import {
  type NativeTaskLaunchScope,
  nativeTaskLaunchScope,
} from "@ai-job-apply/documents-service/native-task-launch-policy";
import {
  type DurableContext,
  StepInterruptedError,
  StepSemantics,
} from "@aws/durable-execution-sdk-js";

type Snapshot = { intent: NativeResumeRouteIntent; expiresAtMs: number };
type Receipt = { changeId: string; status: "PENDING" | "INSYNC" };
type Route = Pick<
  ReturnType<typeof createNativeResumeDnsRoute>,
  "create" | "inspect" | "status" | "remove"
>;
type Attachment = "not_attempted" | "acknowledged" | "unresolved";
const unavailable = () => Error("NativeResumeRouteLifecycleUnavailable");
const noRetry = { retryStrategy: () => ({ shouldRetry: false }) };
const once = { ...noRetry, semantics: StepSemantics.AtMostOncePerRetry };
const changeId = /^\/change\/[A-Z0-9]{1,128}$/u;
function checkedReceipt(value: Receipt, expected?: string): Receipt {
  if (
    !value ||
    typeof value.changeId !== "string" ||
    !changeId.test(value.changeId) ||
    (expected !== undefined && value.changeId !== expected) ||
    (value.status !== "PENDING" && value.status !== "INSYNC")
  )
    throw unavailable();
  return { changeId: value.changeId, status: value.status };
}

/** Private component for exactly one original named durable execution. The owning dispatcher
 * must bind that execution to this allocation; do not expose this as a freely callable workflow.
 * All clock/I/O decisions occur inside steps. Checkpoints retain only scalar route metadata.
 * A terminal execution with unresolved DNS needs retained-checkpoint/operator reconciliation.
 * It never certifies task death, external cache expiry, candidate purge or provider settlement. */
export interface NativeRouteLifecycleOptions {
  /** Owner admission + original ready-task address/configuration; no candidate-controlled DNS. */
  capture(scope: NativeTaskLaunchScope): Promise<Snapshot>;
  /** Current owner/epoch/readiness admission, repeated immediately before creation/attachment. */
  admit(scope: NativeTaskLaunchScope, snapshot: Snapshot): Promise<boolean>;
  /** Owning atomic, idempotent original-reference attachment; never creates new generation. */
  attach(scope: NativeTaskLaunchScope): Promise<void>;
  /** Only positive exact task retirement; errors/absence are not retirement. */
  retired(scope: NativeTaskLaunchScope): Promise<boolean>;
  enabled?: () => boolean;
  creationEnabled?: () => boolean;
  testRoute?: (intent: NativeResumeRouteIntent) => Route;
}
export function createNativeRouteLifecycle(
  kind: "resume" | "material",
  options: NativeRouteLifecycleOptions,
) {
  const prefix = `${kind}-route`;
  const enabled = options.enabled ?? (() => false);
  const creationEnabled = options.creationEnabled ?? (() => false);
  const testRoute = options.testRoute;
  if (testRoute && process.env.NODE_ENV !== "test") throw unavailable();
  const check = () => {
    if (!enabled() || (testRoute && process.env.NODE_ENV !== "test")) throw unavailable();
  };
  return async (context: DurableContext, input: NativeTaskLaunchScope) => {
    check();
    const scope = nativeTaskLaunchScope(input);
    const snapshot = await context.step(
      `${prefix}.intent.v1`,
      async () => {
        check();
        let value: Snapshot;
        try {
          value = await options.capture(scope);
        } catch {
          throw unavailable();
        }
        check();
        const intent = nativeResumeRouteIntent(value.intent);
        const now = Date.now();
        if (
          intent.allocationId !== scope.allocationId ||
          !Number.isSafeInteger(value.expiresAtMs) ||
          value.expiresAtMs <= now ||
          value.expiresAtMs > now + 1_800_000
        )
          throw unavailable();
        return { intent, expiresAtMs: value.expiresAtMs };
      },
      noRetry,
    );
    const route = testRoute
      ? testRoute(snapshot.intent)
      : createNativeResumeDnsRoute({ intent: snapshot.intent, enabled, creationEnabled });
    const detached = () => structuredClone(snapshot);
    const result = (cleanup: "not_created" | "removed" | "unresolved", attachment: Attachment) =>
      Object.freeze({ allocationId: scope.allocationId, cleanup, attachment });

    // START must be durably acknowledged before sending the single write. Never wrap this
    // operation in withRetry; StepSemantics is per retry attempt, not per whole execution.
    let created: { kind: "skipped" | "unknown" } | { kind: "accepted"; receipt: Receipt };
    try {
      created = await context.step(
        `${prefix}.create.v1`,
        async () => {
          check();
          if (!creationEnabled() || Date.now() >= snapshot.expiresAtMs)
            return { kind: "skipped" as const };
          let admitted: boolean;
          try {
            admitted = await options.admit(scope, detached());
          } catch {
            return { kind: "skipped" as const };
          }
          check();
          if (admitted !== true || !creationEnabled() || Date.now() >= snapshot.expiresAtMs)
            return { kind: "skipped" as const };
          try {
            return { kind: "accepted" as const, receipt: checkedReceipt(await route.create()) };
          } catch {
            return { kind: "unknown" as const };
          }
        },
        once,
      );
    } catch (error) {
      if (!(error instanceof StepInterruptedError)) throw error;
      created = { kind: "unknown" };
    }
    if (created.kind === "skipped") return result("not_created", "not_attempted");

    async function propagated(id: string, name: string, expected: "present" | "absent") {
      for (let n = 0; n < 12; n++) {
        const ready = await context.step(
          `${name}.poll-${n}`,
          async () => {
            check();
            try {
              if (checkedReceipt(await route.status(id), id).status !== "INSYNC") return false;
              const observed = await route.inspect();
              check();
              return observed.kind === expected;
            } catch {
              return false;
            }
          },
          noRetry,
        );
        if (ready) return true;
        if (n < 11) await context.wait(`${name}.wait-${n}`, { seconds: 5 });
      }
      return false;
    }
    let attachment: Attachment = "not_attempted";
    if (
      created.kind === "accepted" &&
      (await propagated(created.receipt.changeId, `${prefix}.ready.v1`, "present"))
    ) {
      try {
        attachment = await context.step(
          `${prefix}.attach.v1`,
          async (): Promise<Attachment> => {
            check();
            try {
              if (
                Date.now() >= snapshot.expiresAtMs ||
                (await options.admit(scope, detached())) !== true
              )
                return "not_attempted";
              check();
              if (Date.now() >= snapshot.expiresAtMs) return "not_attempted";
              await options.attach(scope);
              check();
              return "acknowledged";
            } catch {
              return "unresolved";
            }
          },
          once,
        );
      } catch (error) {
        if (!(error instanceof StepInterruptedError)) throw error;
        // Admission changes after the packet commits. Do not replay that changed admission
        // and incorrectly label a lost successful attachment as "not_attempted".
        attachment = "unresolved";
      }
    }

    // Bounded 30-minute lifetime observation, with early cleanup on positive task retirement.
    // Expiry permits route removal; it does not itself prove that the native task has died.
    let cleanupDue = false;
    for (let n = 0; n < 122; n++) {
      cleanupDue = await context.step(
        `${prefix}.retirement.v1.poll-${n}`,
        async () => {
          check();
          if (Date.now() >= snapshot.expiresAtMs) return true;
          try {
            const retired = await options.retired(scope);
            check();
            return retired === true;
          } catch {
            return false;
          }
        },
        noRetry,
      );
      if (cleanupDue) break;
      if (n < 121) await context.wait(`${prefix}.retirement.v1.wait-${n}`, { seconds: 15 });
    }
    if (!cleanupDue) return result("unresolved", attachment);
    // Positive presence after the sole original creator is interrupted can recover its effect.
    // Absence is insufficient: a delayed unknown CREATE could still arrive after a DELETE.
    const present = await context.step(
      `${prefix}.cleanup-presence.v1`,
      async () => {
        check();
        try {
          const found = await route.inspect();
          check();
          return found.kind === "present";
        } catch {
          return false;
        }
      },
      noRetry,
    );
    if (!present) return result("unresolved", attachment);
    let removed: Receipt | null;
    try {
      removed = await context.step(
        `${prefix}.remove.v1`,
        async () => {
          check();
          try {
            return checkedReceipt(await route.remove());
          } catch {
            return null;
          }
        },
        once,
      );
    } catch (error) {
      if (!(error instanceof StepInterruptedError)) throw error;
      removed = null;
    }
    if (!removed) return result("unresolved", attachment);
    const gone = await propagated(removed.changeId, `${prefix}.removed.v1`, "absent");
    return result(gone ? "removed" : "unresolved", attachment);
  };
}
