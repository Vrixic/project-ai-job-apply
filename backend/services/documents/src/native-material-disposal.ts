import type { PostgresNativeMaterialRegistry } from "./native-material-registry.js";
import type {
  NativeTaskAllocation,
  NativeTaskRetirementReceipt,
} from "./native-task-allocation.js";
import { createNativeTaskRetirement } from "./native-task-retirement.js";

type Registry = Pick<
  PostgresNativeMaterialRegistry,
  "sealApplication" | "recordRetirement" | "confirmApplicationDisposed"
>;
type Retire = (allocation: NativeTaskAllocation) => Promise<NativeTaskRetirementReceipt>;

/** Native registry/task disposal only; no memory read, provider settlement, retry dispatch or
 * candidate-wide purge authority. A missing/unbound launch stays unknown. Sealing is committed
 * before any remote await; final epoch comparison prevents an old disposal acknowledgement
 * from certifying a freshly opened explicit generation. SQL locks never span AWS calls. */
export function createNativeMaterialDisposal(options: {
  registry: Registry & {
    sealApplicationThrough?: (
      owner: string,
      application: string,
      throughMicros: string,
    ) => Promise<{
      epochId: string;
      intents: import("./native-material-registry.js").NativeMaterialIntent[];
    } | null>;
  };
  enabled?: () => boolean;
  /** Original deployments retained by the caller's release; when supplied, no other task is stopped. */
  deployments?: ReadonlyArray<
    Pick<NativeTaskAllocation, "clusterArn" | "taskDefinitionArn" | "containerName">
  >;
  /** Test-only; production always uses the exact signed managed task observer. */
  testRetire?: Retire;
}) {
  const enabled = options.enabled ?? (() => false);
  const testRetire = options.testRetire;
  if (testRetire && process.env.NODE_ENV !== "test")
    throw Error("NativeMaterialDisposalUnavailable");
  const deployments = options.deployments?.map((deployment) => Object.freeze({ ...deployment }));
  const active = new Set<string>();
  const permitted = () => {
    if (!enabled() || (testRetire && process.env.NODE_ENV !== "test"))
      throw Error("NativeMaterialDisposalUnavailable");
  };
  const discard = async (
    owner: string,
    application: string,
    throughMicros?: string,
  ): Promise<"discarded"> => {
    const key = `${owner}:${application}`;
    if (active.has(key)) throw Error("NativeMaterialDisposalUnavailable");
    permitted();
    active.add(key);
    try {
      const plan =
        throughMicros === undefined
          ? await options.registry.sealApplication(owner, application)
          : await (() => {
              if (!/^\d{16,17}$/u.test(throughMicros) || !options.registry.sealApplicationThrough)
                throw Error();
              return options.registry.sealApplicationThrough(owner, application, throughMicros);
            })();
      permitted();
      if (!plan) return "discarded";
      // Current registry permits at most one unretired intent per owner/application. Enforce
      // the bound here as well so an unexpected composition never causes broad task effects.
      if (plan.intents.length > 1) throw Error();
      for (const original of plan.intents) {
        const intent = structuredClone(original);
        if (
          intent.ownerUserId !== owner ||
          intent.applicationId !== application ||
          intent.epochId !== plan.epochId ||
          intent.state !== "bound" ||
          !intent.allocation ||
          intent.allocation.allocationId !== intent.allocationId ||
          intent.allocation.ownerUserId !== owner ||
          intent.allocation.applicationId !== application ||
          intent.allocation.generationId !== intent.generationId
        )
          throw Error();
        if (
          deployments &&
          !deployments.some(
            (deployment) =>
              deployment.clusterArn === intent.allocation?.clusterArn &&
              deployment.taskDefinitionArn === intent.allocation?.taskDefinitionArn &&
              deployment.containerName === intent.allocation?.containerName,
          )
        )
          throw Error();
        permitted();
        const receipt = testRetire
          ? await testRetire(intent.allocation)
          : await createNativeTaskRetirement({ allocation: intent.allocation, enabled }).retire(
              intent.allocation,
            );
        permitted();
        await options.registry.recordRetirement(receipt);
        permitted();
      }
      if (!(await options.registry.confirmApplicationDisposed(owner, application, plan.epochId)))
        throw Error();
      permitted();
      return "discarded";
    } catch {
      throw Error("NativeMaterialDisposalUnavailable");
    } finally {
      active.delete(key);
    }
  };
  return Object.freeze({
    discardApplication: (owner: string, application: string) => discard(owner, application),
    discardApplicationThrough: (owner: string, application: string, throughMicros: string) =>
      discard(owner, application, throughMicros),
  });
}
