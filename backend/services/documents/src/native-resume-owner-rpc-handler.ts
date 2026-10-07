import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeBootstrap,
  type NativeResumeOwnerRpcInput,
  type NativeResumeOwnerRpcOutput,
  nativeResumeOwnerRequestDigest,
  nativeResumeOwnerUnavailable,
  validateNativeResumeOwnerRpcInput,
  validateNativeResumeOwnerRpcOutput,
} from "./native-resume-owner-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerVerifier } from "./native-resume-task-caller-verifier.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

export interface NativeResumeOwnerRpcOwners {
  checkAdmission(binding: Readonly<NativeResumeTaskBinding>): Promise<void>;
  bootstrap(binding: Readonly<NativeResumeTaskBinding>): Promise<NativeResumeBootstrap>;
  principal?(
    binding: Readonly<NativeResumeTaskBinding>,
    issuer: string,
  ): Promise<{ issuer: string; subject: string }>;
  claimOriginalCompletion(
    binding: Readonly<NativeResumeTaskBinding>,
    material: TemporaryMaterialReference,
  ): Promise<"claimed" | "already_completed" | "unavailable">;
  publishReady(
    binding: Readonly<NativeResumeTaskBinding>,
    material: TemporaryMaterialReference,
  ): Promise<void>;
}

/** Authenticate the exact original resume task before lazy owner access. No caller proof reaches
 * owners, storage or responses. Every operation repeats owning admission after its awaits. */
export function createNativeResumeOwnerRpcHandler(options: {
  targetArn: string;
  taskRoleArn: string;
  deployment: Pick<
    NativeResumeTaskBinding["allocation"],
    "clusterArn" | "taskDefinitionArn" | "containerName"
  >;
  owners(): Promise<NativeResumeOwnerRpcOwners>;
  enabled?: () => boolean;
  testFetch?: typeof fetch;
}) {
  const target = options.targetArn,
    role = options.taskRoleArn;
  const deployment = Object.freeze({ ...options.deployment });
  const owners = options.owners,
    enabled = options.enabled ?? (() => false),
    testFetch = options.testFetch;
  if (testFetch && process.env.NODE_ENV !== "test") throw nativeResumeOwnerUnavailable();
  let active = false;
  const permitted = () => {
    try {
      return enabled() && (!testFetch || process.env.NODE_ENV === "test");
    } catch {
      return false;
    }
  };
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<NativeResumeOwnerRpcOutput> => {
    let input: NativeResumeOwnerRpcInput;
    try {
      if (!validateNativeResumeOwnerRpcInput(raw)) throw nativeResumeOwnerUnavailable();
      input = JSON.parse(nativeOwnerJson(raw)) as typeof raw;
    } catch {
      throw nativeResumeOwnerUnavailable();
    }
    const binding = nativeResumeTaskBinding(input.binding),
      request = input.request;
    const digest = nativeResumeOwnerRequestDigest(binding, request);
    const unavailable: NativeResumeOwnerRpcOutput = {
      schemaVersion: 1,
      requestSha256: digest,
      outcome: "unavailable",
      result: null,
    };
    if (
      active ||
      !permitted() ||
      context?.invokedFunctionArn !== target ||
      Object.keys(deployment).some(
        (k) =>
          deployment[k as keyof typeof deployment] !==
          binding.allocation[k as keyof typeof deployment],
      )
    ) {
      for (const key of Object.keys(input.proof.headers)) input.proof.headers[key] = "";
      return unavailable;
    }
    active = true;
    try {
      try {
        await createNativeResumeTaskCallerVerifier({
          binding,
          targetArn: target,
          taskRoleArn: role,
          enabled: permitted,
          ...(testFetch ? { testFetch } : {}),
        }).verify(input.proof, digest);
      } finally {
        for (const key of Object.keys(input.proof.headers)) input.proof.headers[key] = "";
      }
      if (!permitted()) return unavailable;
      const owner = await owners();
      if (!permitted()) return unavailable;
      await owner.checkAdmission(binding);
      if (!permitted()) return unavailable;
      let result: unknown;
      if (request.action === "admit") result = { admitted: true };
      else if (request.action === "bootstrap") result = await owner.bootstrap(binding);
      else if (request.action === "principal") {
        if (!owner.principal) return unavailable;
        result = await owner.principal(binding, request.issuer);
      } else if (request.action === "completion") {
        const outcome = await owner.claimOriginalCompletion(binding, request.material);
        if (outcome === "unavailable") return unavailable;
        result = { outcome, material: request.material };
      } else {
        await owner.publishReady(binding, request.material);
        result = { published: true, material: request.material };
      }
      result = structuredClone(result);
      await owner.checkAdmission(binding);
      if (!permitted()) return unavailable;
      const output: NativeResumeOwnerRpcOutput = {
        schemaVersion: 1,
        requestSha256: digest,
        outcome: "ready",
        result,
      };
      return validateNativeResumeOwnerRpcOutput(output, binding, request)
        ? structuredClone(output)
        : unavailable;
    } catch {
      return unavailable;
    } finally {
      active = false;
    }
  };
}
