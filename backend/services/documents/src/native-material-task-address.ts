import { createHash } from "node:crypto";
import type { PostgresNativeMaterialReadyStore } from "./native-material-ready-store.js";
import type {
  NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "./native-material-registry.js";
import {
  createNativeTaskAddressReader,
  type NativeTaskAddressTestClients,
} from "./native-task-address.js";
import {
  type NativeTaskLaunchConfiguration,
  nativeMaterialLaunchEnvironment,
  nativeTaskLaunchConfiguration,
} from "./native-task-launch-policy.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

/** Private owning route port. Current ready receipt and original launch must agree before and
 * after signed AWS inspection. Does not launch, change DNS, attach packets or authorize reads. */
export function createNativeMaterialTaskAddressReader(options: {
  registry: Pick<PostgresNativeMaterialRegistry, "readLaunch">;
  ready: Pick<PostgresNativeMaterialReadyStore, "readAllocation">;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClients?: NativeTaskAddressTestClients;
}) {
  const config = nativeTaskLaunchConfiguration(options.configuration);
  const sha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-material-launch.v1", ...config }))
    .digest("hex");
  const readLaunch = options.registry.readLaunch.bind(options.registry);
  const readAllocation = options.ready.readAllocation.bind(options.ready);
  const unavailable = () => Error("NativeMaterialTaskAddressUnavailable");
  return createNativeTaskAddressReader<{
    scope: NativeMaterialLaunchScope;
    reference: TemporaryMaterialReference;
  }>({
    ...options,
    configuration: config,
    kind: "cover_letter",
    unavailable,
    scope: (input) => input.scope,
    async original(input, scope) {
      const reference = input.reference;
      if (!validateTemporaryMaterialReference(reference) || reference.kind !== "cover_letter")
        throw unavailable();
      for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
        if (reference[key] !== scope[key]) throw unavailable();
      const row = structuredClone(await readLaunch(scope, sha));
      if (
        row.intent.state !== "bound" ||
        !row.intent.allocation ||
        row.configurationSha256 !== sha ||
        !Number.isSafeInteger(row.claimedAtEpochMs) ||
        (row.claimedAtEpochMs ?? 0) <= 0 ||
        row.original.documentId !== scope.generationId ||
        row.original.purpose !== "provider_dispatch" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
          row.original.id,
        ) ||
        !/^[a-f0-9]{64}$/u.test(row.original.requestSha256)
      )
        throw unavailable();
      for (const key of [
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "epochId",
      ] as const)
        if (row.intent[key] !== scope[key]) throw unavailable();
      for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
        if (row.deployment[key] !== config[key]) throw unavailable();
      if ((await readAllocation(reference)) !== scope.allocationId) throw unavailable();
      return {
        allocation: row.intent.allocation,
        reference,
        environment: nativeMaterialLaunchEnvironment(scope, row.original),
      };
    },
  });
}
