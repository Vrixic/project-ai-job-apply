import { InvokeCommand } from "@aws-sdk/client-lambda";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import {
  TemporaryMaterialCompletionError,
  type TemporaryMaterialCompletionInput,
  type TemporaryMaterialCompletionOutcome,
  temporaryMaterialCompletionVersion,
  validateTemporaryMaterialCompletionInput,
  validateTemporaryMaterialCompletionOutput,
} from "./temporary-material-completion-contract.js";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
} from "./temporary-material-reference.js";
import type { TemporaryMaterialCompletionAuthority } from "./temporary-materials.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new TemporaryMaterialCompletionError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Bound to one original work before processing content. One invocation, no replay/recovery,
 * and no content on the wire. Lost ACK always means unavailable, even if SQL committed. */
export class TemporaryMaterialCompletionClient implements TemporaryMaterialCompletionAuthority {
  private readonly version: string;
  private readonly work: CoverLetterWorkReference;
  constructor(
    private readonly functionArn: string,
    work: CoverLetterWorkReference,
    private readonly client: CoverLetterProviderLambdaClient,
    private readonly enabled: () => boolean = () => false,
    private readonly timeoutMs = 10_000,
  ) {
    this.version = temporaryMaterialCompletionVersion(functionArn);
    this.work = structuredClone(work);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
      throw new TemporaryMaterialCompletionError();
  }
  async claimOriginalCompletion(
    reference: Readonly<TemporaryMaterialReference>,
  ): Promise<TemporaryMaterialCompletionOutcome> {
    try {
      const raw = {
        schemaVersion: 1,
        action: "claim_original_completion",
        work: this.work,
        material: reference,
      };
      if (!this.enabled() || !validateTemporaryMaterialCompletionInput(raw)) return "unavailable";
      const input: TemporaryMaterialCompletionInput = structuredClone(raw);
      const payload = new TextEncoder().encode(JSON.stringify(input));
      const deadline = AbortSignal.timeout(this.timeoutMs);
      if (
        payload.length > 8192 ||
        (await bounded(this.client.config.maxAttempts(), deadline)) !== 1 ||
        !this.enabled()
      )
        return "unavailable";
      deadline.throwIfAborted();
      const response = await bounded(
        this.client.send(
          new InvokeCommand({
            FunctionName: this.functionArn,
            InvocationType: "RequestResponse",
            LogType: "None",
            Payload: payload,
          }),
          { abortSignal: deadline },
        ),
        deadline,
      );
      if (
        !this.enabled() ||
        response.StatusCode !== 200 ||
        response.ExecutedVersion !== this.version ||
        response.FunctionError !== undefined ||
        response.LogResult !== undefined ||
        !(response.Payload instanceof Uint8Array) ||
        response.Payload.length < 1 ||
        response.Payload.length > 8192
      )
        return "unavailable";
      const text = new TextDecoder("utf-8", { fatal: true }).decode(response.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateTemporaryMaterialCompletionOutput(output) ||
        output.work.id !== input.work.id ||
        output.work.documentId !== input.work.documentId ||
        output.work.requestSha256 !== input.work.requestSha256 ||
        !sameTemporaryMaterialReference(output.material, input.material)
      )
        return "unavailable";
      return output.outcome;
    } catch {
      return "unavailable";
    }
  }
}
