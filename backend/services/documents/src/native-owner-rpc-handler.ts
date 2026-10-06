import type { CoverLetterEvidenceSource } from "./cover-letter-generation.js";
import { validateProviderControlInput } from "./cover-letter-provider-control-contract.js";
import type { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import {
  type NativeOwnerBootstrap,
  type NativeOwnerRpcOutput,
  nativeOwnerJson,
  nativeOwnerRequestDigest,
  nativeOwnerRpcUnavailable,
  validateNativeOwnerEvidence,
  validateNativeOwnerRpcInput,
  validateNativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import { createNativeTaskCallerVerifier } from "./native-task-caller-verifier.js";
import type { createTemporaryMaterialCompletionHandler } from "./temporary-material-completion-handler.js";

export interface NativeOwnerRpcOwners {
  checkAdmission(binding: Readonly<NativeEvidenceBinding>): Promise<void>;
  bootstrap?(binding: Readonly<NativeEvidenceBinding>): Promise<NativeOwnerBootstrap>;
  principal?(
    binding: Readonly<NativeEvidenceBinding>,
    issuer: string,
  ): Promise<{ issuer: string; subject: string }>;
  evidence(
    binding: Readonly<NativeEvidenceBinding>,
    context: { jobContextHash: string; confirmedFactsHash: string },
  ): CoverLetterEvidenceSource;
  work: ReturnType<typeof createCoverLetterProviderControlHandler>;
  completion: ReturnType<typeof createTemporaryMaterialCompletionHandler>;
}
/** No caller proof reaches owners or a response. Authentication precedes lazy owner creation;
 * short owning admission surrounds owner awaits without retaining a SQL transaction. */
export function createNativeOwnerRpcHandler(options: {
  targetArn: string;
  taskRoleArn: string;
  deployment: Pick<
    NativeEvidenceBinding["allocation"],
    "clusterArn" | "taskDefinitionArn" | "containerName"
  >;
  owners(): Promise<NativeOwnerRpcOwners>;
  enabled?: () => boolean;
  testFetch?: Parameters<typeof createNativeTaskCallerVerifier>[0]["testFetch"];
}) {
  const target = options.targetArn;
  const role = options.taskRoleArn;
  const deployment = Object.freeze({ ...options.deployment });
  const enabled = options.enabled ?? (() => false);
  const owners = options.owners;
  const testFetch = options.testFetch;
  if (testFetch && process.env.NODE_ENV !== "test") throw nativeOwnerRpcUnavailable();
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
    if (!validateNativeOwnerRpcInput(raw)) throw nativeOwnerRpcUnavailable();
    const binding = nativeEvidenceBinding(raw.binding);
    const request = JSON.parse(nativeOwnerJson(raw.request)) as typeof raw.request;
    const digest = nativeOwnerRequestDigest(binding, request);
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
    )
      return unavailable;
    active = true;
    let result: unknown;
    try {
      const verifier = createNativeTaskCallerVerifier({
        binding,
        targetArn: target,
        taskRoleArn: role,
        enabled: permitted,
        ...(testFetch ? { testFetch } : {}),
      });
      // Copy only proof material for authentication. It is never passed to owning adapters.
      await verifier.verify(structuredClone(raw.proof), digest);
      if (!permitted()) return unavailable;
      const owner = await owners();
      if (!permitted()) return unavailable;
      await owner.checkAdmission(binding);
      if (!permitted()) return unavailable;
      if (request.action === "admit") result = { admitted: true };
      else if (request.action === "bootstrap") {
        if (!owner.bootstrap) return unavailable;
        result = await owner.bootstrap(binding);
      } else if (request.action === "principal") {
        if (!owner.principal) return unavailable;
        result = await owner.principal(binding, request.issuer);
      } else if (request.action === "evidence")
        result = await owner
          .evidence(binding, {
            jobContextHash: request.jobContextHash,
            confirmedFactsHash: request.confirmedFactsHash,
          })
          .load(binding.scope.ownerUserId, binding.scope.applicationId);
      else if (request.action === "work") {
        if (!validateProviderControlInput(request.input)) return unavailable;
        result = await owner.work(request.input, { invokedFunctionArn: target });
      } else result = await owner.completion(request.input, { invokedFunctionArn: target });
      result = structuredClone(result);
      await owner.checkAdmission(binding);
      if (!permitted()) return unavailable;
      const output: NativeOwnerRpcOutput = {
        schemaVersion: 1,
        requestSha256: digest,
        outcome: "ready",
        result,
      };
      if (!validateNativeOwnerRpcOutput(output, binding, request)) return unavailable;
      return structuredClone(output);
    } catch {
      return unavailable;
    } finally {
      // Clear owned evidence after transfer/refusal; no physical string-zeroization claim.
      if (request.action === "evidence" && validateNativeOwnerEvidence(result)) {
        const evidence = result as Awaited<ReturnType<CoverLetterEvidenceSource["load"]>>;
        for (const fact of evidence.facts) fact.value = "";
        evidence.job.title = "";
        evidence.job.company = "";
        evidence.job.description = "";
      }
      active = false;
    }
  };
}
