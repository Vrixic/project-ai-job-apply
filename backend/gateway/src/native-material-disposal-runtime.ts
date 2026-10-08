import { PostgresNativeApplicationDisposalStore } from "@ai-job-apply/documents-service/native-application-disposal-store";
import { createNativeMaterialDisposal } from "@ai-job-apply/documents-service/native-material-disposal";
import {
  type NativeTaskAllocation,
  nativeTaskDeploymentRegion,
} from "@ai-job-apply/documents-service/native-task-allocation";
import postgres from "postgres";

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
  return Object.freeze({
    ...createNativeMaterialDisposal({ registry, deployments, enabled }),
    close: () => sql.end(),
  });
}
