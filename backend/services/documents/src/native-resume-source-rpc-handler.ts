import { nativeOwnerJson, type NativeOwnerRpcOutput } from "./native-owner-rpc-contract.js";
import type { NativeResumeBootstrap } from "./native-resume-owner-rpc-contract.js";
import {
  nativeResumeSourceUnavailable,
  type NativeResumeSourceValue,
} from "./native-resume-source.js";
import {
  type NativeResumeSourceInput,
  nativeResumeSourceRequestDigest,
  validateNativeResumeSourceInput,
  validateNativeResumeSourceOutput,
} from "./native-resume-source-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerVerifier } from "./native-resume-task-caller-verifier.js";

export interface NativeResumeSourceOwners {
  checkAdmission(binding: Readonly<NativeResumeTaskBinding>): Promise<void>;
  load(
    binding: Readonly<NativeResumeTaskBinding>,
    bootstrap: NativeResumeBootstrap,
  ): Promise<NativeResumeSourceValue>;
}

/** Authenticate the exact original resume task before lazy owner access. No caller proof reaches
 * owners, storage or responses. Every operation repeats owning admission after its awaits. */
export function createNativeResumeSourceRpcHandler(options: {
  targetArn: string;
  taskRoleArn: string;
  deployment: Pick<
    NativeResumeTaskBinding["allocation"],
    "clusterArn" | "taskDefinitionArn" | "containerName"
  >;
  owners(): Promise<NativeResumeSourceOwners>;
  enabled?: () => boolean;
  testFetch?: typeof fetch;
}) {
  const target = options.targetArn,
    role = options.taskRoleArn;
  const deployment = Object.freeze({ ...options.deployment });
  const owners = options.owners,
    enabled = options.enabled ?? (() => false),
    testFetch = options.testFetch;
  if (testFetch && process.env.NODE_ENV !== "test") throw nativeResumeSourceUnavailable();
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
  ): Promise<NativeOwnerRpcOutput> => {
    let input: NativeResumeSourceInput;
    try {
      if (!validateNativeResumeSourceInput(raw)) throw nativeResumeSourceUnavailable();
      input = JSON.parse(nativeOwnerJson(raw)) as typeof raw;
    } catch {
      throw nativeResumeSourceUnavailable();
    }
    const binding = nativeResumeTaskBinding(input.binding),
      request = input.request;
    const digest = nativeResumeSourceRequestDigest(binding, request);
    const unavailable: NativeOwnerRpcOutput = {
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
      let result: unknown = await owner.load(binding, request.bootstrap);
      result = structuredClone(result);
      await owner.checkAdmission(binding);
      if (!permitted()) return unavailable;
      const output: NativeOwnerRpcOutput = {
        schemaVersion: 1,
        requestSha256: digest,
        outcome: "ready",
        result,
      };
      return validateNativeResumeSourceOutput(output, binding, request)
        ? structuredClone(output)
        : unavailable;
    } catch {
      return unavailable;
    } finally {
      active = false;
    }
  };
}
