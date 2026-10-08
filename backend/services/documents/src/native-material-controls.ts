import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import {
  nativeLaunchControlVersion,
  validateNativeLaunchControlInput,
} from "./native-launch-control-contract.js";
import { type NativeMaterialReady, validateNativeMaterialReady } from "./native-material-ready.js";
import { createNativeOwnerRpcClient } from "./native-owner-rpc-client.js";
import { type NativeOwnerRequest, nativeOwnerJson } from "./native-owner-rpc-contract.js";
import { type NativeTaskAllocation, nativeTaskAllocationRegion } from "./native-task-allocation.js";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

interface Client {
  send(
    command: InvokeCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<{
    StatusCode?: number;
    ExecutedVersion?: string;
    FunctionError?: string;
    LogResult?: string;
    Payload?: Uint8Array;
  }>;
}
const unavailable = () => Error("NativeMaterialControlsUnavailable");
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable === true && "value" in d;
    })
  );
}
const workKeys = ["id", "documentId", "purpose", "requestSha256"] as const;
function sameWork(
  value: unknown,
  work: CoverLetterWorkReference,
): value is CoverLetterWorkReference {
  return closed(value, workKeys) && workKeys.every((key) => value[key] === work[key]);
}

/** Dedicated native process scalar ports only. Trusted launcher supplies the positively bound
 * original allocation/work; local equality is not authentication or owning task admission.
 * No issue/renew, another document, background-terminal settlement, SQL, content or task control.
 * IAM/owner/private task admission and actual runtime composition remain activation gates. */
export function createNativeMaterialControls(options: {
  allocation: NativeTaskAllocation;
  original: CoverLetterWorkReference;
  consentExpiresAt: string;
  documentVersion?: number;
  workFunctionArn: string;
  completionFunctionArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
  /** Explicit authenticated transport version; no fallback to the older scalar RPC. */
  nativeRpc?: {
    binding: NativeEvidenceBinding;
    testCredentials?: Parameters<typeof createNativeOwnerRpcClient>[0]["testCredentials"];
  };
}) {
  let allocation: Readonly<NativeTaskAllocation>;
  let original: Readonly<CoverLetterWorkReference>;
  let workVersion: string;
  let completionVersion: string;
  const consent = options.consentExpiresAt;
  const workTarget = options.workFunctionArn;
  const completionTarget = options.completionFunctionArn;
  const timeout = options.timeoutMs ?? 10_000;
  const injected = options.testClient;
  const enabled = options.enabled ?? (() => false);
  const documentVersion = options.documentVersion === undefined ? 1 : options.documentVersion;
  try {
    if (
      !Number.isSafeInteger(documentVersion) ||
      documentVersion < 1 ||
      documentVersion > 2_147_483_647 ||
      !closed(options.allocation, [
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "containerName",
      ]) ||
      nativeTaskAllocationRegion(options.allocation) !== "us-east-2"
    )
      throw unavailable();
    allocation = Object.freeze(structuredClone(options.allocation));
    if (
      !validateNativeLaunchControlInput({
        schemaVersion: 1,
        action: "launch",
        ownerUserId: allocation.ownerUserId,
        applicationId: allocation.applicationId,
        original: options.original,
        previousEpochId: null,
      }) ||
      options.original.documentId !== allocation.generationId
    )
      throw unavailable();
    original = Object.freeze(structuredClone(options.original));
    workVersion = nativeLaunchControlVersion(workTarget);
    completionVersion = nativeLaunchControlVersion(completionTarget);
    if (
      workTarget.split(":")[4] !== allocation.clusterArn.split(":")[4] ||
      completionTarget.split(":")[4] !== workTarget.split(":")[4] ||
      (!options.nativeRpc && workTarget.split(":")[6] === completionTarget.split(":")[6]) ||
      typeof consent !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(consent) ||
      new Date(consent).toISOString() !== consent ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 10_000 ||
      (injected && process.env.NODE_ENV !== "test")
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  let authenticated: Map<string, ReturnType<typeof createNativeOwnerRpcClient>> | undefined;
  if (options.nativeRpc) {
    const fixed = nativeEvidenceBinding(options.nativeRpc.binding);
    if (
      nativeOwnerJson(fixed.allocation) !== nativeOwnerJson(allocation) ||
      nativeOwnerJson(fixed.original) !== nativeOwnerJson(original)
    )
      throw unavailable();
    authenticated = new Map();
    for (const targetArn of new Set([workTarget, completionTarget]))
      authenticated.set(
        targetArn,
        createNativeOwnerRpcClient({
          binding: fixed,
          targetArn,
          enabled,
          timeoutMs: timeout,
          ...(injected ? { testClient: injected } : {}),
          ...(options.nativeRpc.testCredentials
            ? { testCredentials: options.nativeRpc.testCredentials }
            : {}),
        }),
      );
  }
  let active = false;
  let claimAttempted = false;
  let claimed = false;
  let settlementAttempted = false;
  let successfulSettlement = false;
  let completionAttempted = false;
  let completionReference: TemporaryMaterialReference | undefined;
  let readyAttempted = false;
  const permitted = () => {
    try {
      return enabled() && (!injected || process.env.NODE_ENV === "test");
    } catch {
      return false;
    }
  };
  const freshConsent = () => Date.now() < Date.parse(consent);
  async function invoke(
    target: string,
    version: string,
    input: object,
  ): Promise<Record<string, unknown>> {
    if (active || !permitted()) throw unavailable();
    if (authenticated) {
      active = true;
      try {
        const request =
          target === completionTarget && "work" in input
            ? { action: "completion", input }
            : { action: "work", input };
        const reply = await authenticated.get(target)?.run(request as NativeOwnerRequest);
        if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw unavailable();
        return reply as Record<string, unknown>;
      } catch {
        throw unavailable();
      } finally {
        active = false;
      }
    }
    const payload = new TextEncoder().encode(JSON.stringify(input));
    if (payload.length > 8_192) throw unavailable();
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let owned: LambdaClient | undefined;
    try {
      if (!injected)
        owned = new LambdaClient({
          region: "us-east-2",
          endpoint: "https://lambda.us-east-2.amazonaws.com",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      const client = injected ?? owned;
      if (!client || !permitted()) throw unavailable();
      // Deliberately await actual transport settlement even if it ignores abort. The kernel
      // bounds the dedicated host; local timeout cannot release this admission or certify death.
      const reply = await client.send(
        new InvokeCommand({
          FunctionName: target,
          InvocationType: "RequestResponse",
          LogType: "None",
          Payload: payload,
        }),
        { abortSignal: controller.signal },
      );
      if (
        !permitted() ||
        controller.signal.aborted ||
        reply.StatusCode !== 200 ||
        reply.ExecutedVersion !== version ||
        reply.FunctionError !== undefined ||
        reply.LogResult !== undefined ||
        !(reply.Payload instanceof Uint8Array) ||
        reply.Payload.length < 1 ||
        reply.Payload.length > 8_192
      )
        throw unavailable();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(reply.Payload);
      const output: unknown = JSON.parse(text);
      if (
        !output ||
        typeof output !== "object" ||
        Array.isArray(output) ||
        JSON.stringify(output) !== text
      )
        throw unavailable();
      return output as Record<string, unknown>;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      owned?.destroy();
      active = false;
    }
  }
  async function settle(
    reference: CoverLetterWorkReference,
    action: "settle" | "settle_rejected" | "settle_undispatched",
  ): Promise<void> {
    if (!permitted() || active || !claimed || settlementAttempted || !sameWork(reference, original))
      throw unavailable();
    settlementAttempted = true;
    const reply = await invoke(workTarget, workVersion, {
      schemaVersion: 1,
      action,
      documentId: original.documentId,
      reference: original,
    });
    if (
      !permitted() ||
      !closed(reply, ["schemaVersion", "action", "documentId", "outcome", "reference"]) ||
      reply.schemaVersion !== 1 ||
      reply.action !== action ||
      reply.documentId !== original.documentId ||
      reply.outcome !== "settled" ||
      !sameWork(reply.reference, original)
    )
      throw unavailable();
    successfulSettlement = action === "settle";
  }
  return Object.freeze({
    async publishReady(raw: NativeMaterialReady): Promise<void> {
      if (
        !authenticated ||
        !permitted() ||
        active ||
        readyAttempted ||
        !completionReference ||
        !validateNativeMaterialReady(raw) ||
        !sameTemporaryMaterialReference(raw.material, completionReference) ||
        Date.now() >= raw.material.expiresAtMs
      )
        throw unavailable();
      const receipt = structuredClone(raw);
      readyAttempted = true;
      active = true;
      try {
        const result = await authenticated
          .get(completionTarget)
          ?.run({ action: "publish_ready", input: receipt });
        if (
          !permitted() ||
          Date.now() >= receipt.material.expiresAtMs ||
          !closed(result, ["published"]) ||
          result.published !== true
        )
          throw unavailable();
      } catch {
        throw unavailable();
      } finally {
        active = false;
      }
    },
    work: Object.freeze({
      async claimProviderDispatch(input: {
        documentId: string;
        requestSha256: string;
        consentExpiresAt: Date;
      }): Promise<
        { kind: "claimed"; reference: CoverLetterWorkReference } | { kind: "unavailable" }
      > {
        try {
          if (
            !permitted() ||
            active ||
            claimAttempted ||
            !closed(input, ["documentId", "requestSha256", "consentExpiresAt"]) ||
            input.documentId !== original.documentId ||
            input.requestSha256 !== original.requestSha256 ||
            !(input.consentExpiresAt instanceof Date) ||
            Object.getPrototypeOf(input.consentExpiresAt) !== Date.prototype ||
            Date.prototype.toISOString.call(input.consentExpiresAt) !== consent ||
            !freshConsent()
          )
            return { kind: "unavailable" };
          claimAttempted = true;
          const reply = await invoke(workTarget, workVersion, {
            schemaVersion: 1,
            action: "claim",
            documentId: original.documentId,
            requestSha256: original.requestSha256,
            consentExpiresAt: consent,
          });
          if (
            !permitted() ||
            !freshConsent() ||
            !closed(reply, ["schemaVersion", "action", "documentId", "outcome", "reference"]) ||
            reply.schemaVersion !== 1 ||
            reply.action !== "claim" ||
            reply.documentId !== original.documentId ||
            reply.outcome !== "claimed" ||
            !sameWork(reply.reference, original)
          )
            return { kind: "unavailable" };
          claimed = true;
          return { kind: "claimed", reference: { ...original } };
        } catch {
          return { kind: "unavailable" };
        }
      },
      settleProviderDispatch: (reference: CoverLetterWorkReference) => settle(reference, "settle"),
      settleRejectedProviderDispatch: (reference: CoverLetterWorkReference) =>
        settle(reference, "settle_rejected"),
      settleUndispatchedProviderDispatch: (reference: CoverLetterWorkReference) =>
        settle(reference, "settle_undispatched"),
    }),
    completion: Object.freeze({
      async claimOriginalCompletion(
        raw: Readonly<TemporaryMaterialReference>,
      ): Promise<"claimed" | "already_completed" | "unavailable"> {
        try {
          const now = Date.now();
          if (
            !permitted() ||
            active ||
            !successfulSettlement ||
            completionAttempted ||
            !validateTemporaryMaterialReference(raw) ||
            raw.kind !== "cover_letter" ||
            raw.ownerUserId !== allocation.ownerUserId ||
            raw.applicationId !== allocation.applicationId ||
            raw.generationId !== allocation.generationId ||
            raw.version !== documentVersion ||
            raw.completedAtMs > now ||
            raw.expiresAtMs <= now
          )
            return "unavailable";
          const material = structuredClone(raw);
          completionAttempted = true;
          const reply = await invoke(completionTarget, completionVersion, {
            schemaVersion: 1,
            action: "claim_original_completion",
            work: original,
            material,
          });
          if (
            !permitted() ||
            Date.now() >= material.expiresAtMs ||
            !closed(reply, ["schemaVersion", "action", "work", "material", "outcome"]) ||
            reply.schemaVersion !== 1 ||
            reply.action !== "claim_original_completion" ||
            !sameWork(reply.work, original) ||
            !validateTemporaryMaterialReference(reply.material) ||
            !sameTemporaryMaterialReference(reply.material, material) ||
            !["claimed", "already_completed", "unavailable"].includes(String(reply.outcome))
          )
            return "unavailable";
          if (reply.outcome === "claimed") completionReference = structuredClone(material);
          return reply.outcome as "claimed" | "already_completed" | "unavailable";
        } catch {
          return "unavailable";
        }
      },
    }),
  });
}
