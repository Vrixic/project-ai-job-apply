import { coverLetterContext } from "@ai-job-apply/ai-sdk/context";
import type { CoverLetterEvidenceSource } from "./cover-letter-generation.js";
import { nativeEvidenceBinding } from "./native-evidence-binding.js";
import { createNativeOwnerRpcClient } from "./native-owner-rpc-client.js";
import {
  nativeOwnerRequestDigest,
  nativeOwnerRpcUnavailable,
  validateNativeOwnerEvidence,
} from "./native-owner-rpc-contract.js";

/** Fixed candidate/context owner evidence over authenticated RPC; no generation or persistence. */
export function createNativeOwnerEvidenceClient(
  options: Parameters<typeof createNativeOwnerRpcClient>[0] & {
    context: { jobContextHash: string; confirmedFactsHash: string };
  },
) {
  const binding = nativeEvidenceBinding(options.binding);
  const client = createNativeOwnerRpcClient(options);
  const request = {
    action: "evidence" as const,
    jobContextHash: options.context.jobContextHash,
    confirmedFactsHash: options.context.confirmedFactsHash,
  };
  nativeOwnerRequestDigest(binding, request);
  const source: CoverLetterEvidenceSource = Object.freeze({
    async load(ownerUserId: string, applicationId: string) {
      if (
        ownerUserId !== binding.scope.ownerUserId ||
        applicationId !== binding.scope.applicationId
      )
        throw nativeOwnerRpcUnavailable();
      const result = await client.run(request);
      if (!validateNativeOwnerEvidence(result)) throw nativeOwnerRpcUnavailable();
      const context = coverLetterContext({ ...result, now: new Date() });
      if (
        context.jobContextHash !== request.jobContextHash ||
        context.confirmedFactsHash !== request.confirmedFactsHash
      )
        throw nativeOwnerRpcUnavailable();
      return result;
    },
  });
  return Object.freeze({ source, checkAdmission: client.checkAdmission });
}
