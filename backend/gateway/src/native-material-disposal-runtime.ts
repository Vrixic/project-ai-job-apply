import { PostgresNativeMaterialCleanupQueue } from "@ai-job-apply/applications-service/native-material-cleanup-queue";
import { PostgresNativeMaterialWithdrawalStore } from "@ai-job-apply/applications-service/native-material-withdrawal";
import { PostgresNativeApplicationDisposalStore } from "@ai-job-apply/documents-service/native-application-disposal-store";
import { createNativeMaterialDisposal } from "@ai-job-apply/documents-service/native-material-disposal";
import {
  type NativeTaskAllocation,
  nativeTaskDeploymentRegion,
} from "@ai-job-apply/documents-service/native-task-allocation";
import postgres from "postgres";
import { createNativeOwnerMaterialCleanup } from "./native-owner-material-cleanup.js";

type Deployment = Pick<NativeTaskAllocation, "clusterArn" | "taskDefinitionArn" | "containerName">;
/** Called only by Applications after its owner-scoped terminal mutation. No public stop-task input.
 * The release must supply retained exact deployments and corresponding scoped ECS/network access.
 */
export function nativeMaterialDisposalFromEnvironment(url: string, environment: NodeJS.ProcessEnv) {
  if (environment.NATIVE_APPLICATION_DISPOSAL_ENABLED !== "true") return undefined;
  const serialized = environment.NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS;
  if (!serialized) throw Error("NativeApplicationDisposalConfigurationInvalid");
  let deployments: Deployment[];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw Error();
    deployments = value.map((item: unknown) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).sort().join(",") !== "clusterArn,containerName,taskDefinitionArn"
      )
        throw Error();
      const deployment = item as Deployment;
      if (nativeTaskDeploymentRegion(deployment) !== "us-east-2") throw Error();
      return { ...deployment };
    });
  } catch {
    throw Error("NativeApplicationDisposalConfigurationInvalid");
  }
  const enabled = () =>
    environment.NATIVE_APPLICATION_DISPOSAL_ENABLED === "true" &&
    environment.NATIVE_APPLICATION_DISPOSAL_DEPLOYMENTS === serialized;
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
    connection: {
      statement_timeout: 5000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 10000,
    },
    onnotice: () => undefined,
  });
  const registry = new PostgresNativeApplicationDisposalStore(sql, enabled);
  const disposal = createNativeMaterialDisposal({ registry, deployments, enabled });
  const ownerEnabled = () =>
    enabled() && environment.NATIVE_OWNER_MATERIAL_CLEANUP_ENABLED === "true";
  const queue = new PostgresNativeMaterialCleanupQueue(sql, ownerEnabled);
  const withdrawals = new PostgresNativeMaterialWithdrawalStore(sql, ownerEnabled);
  const ownerCleanup = createNativeOwnerMaterialCleanup({
    enabled: ownerEnabled,
    withdrawals: {
      withdraw: async (owner, requestId) => {
        const receipt = await queue.read(owner, requestId);
        if (!receipt) throw Error("NativeOwnerMaterialCleanupUnavailable");
        return receipt;
      },
    },
    inventory: registry,
    disposal,
  });
  return Object.freeze({
    ...disposal,
    ownerCleanup,
    ownerRequests: {
      async create(owner: string, requestId: string) {
        await withdrawals.withdraw(owner, requestId);
        const status = await queue.read(owner, requestId);
        if (!status) throw Error("NativeOwnerMaterialCleanupUnavailable");
        return {
          requestId,
          requestedAt: new Date(status.requestedAtMs).toISOString(),
          state: status.state,
        };
      },
      async get(owner: string, requestId: string) {
        const status = await queue.read(owner, requestId);
        return status
          ? {
              requestId,
              requestedAt: new Date(status.requestedAtMs).toISOString(),
              state: status.state,
            }
          : null;
      },
    },
    async runOwnerCleanup() {
      const claim = await queue.claim();
      if (!claim) return { state: "idle" as const };
      const result = await ownerCleanup.step(
        claim.ownerUserId,
        claim.requestId,
        claim.afterApplicationId,
      );
      const recorded = await queue.finish(claim, result);
      return { state: recorded ? result.state : ("lease_lost" as const) };
    },
    close: () => sql.end(),
  });
}
