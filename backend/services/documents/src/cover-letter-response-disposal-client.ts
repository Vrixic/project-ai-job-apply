import { InvokeCommand } from "@aws-sdk/client-lambda";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import {
  CoverLetterResponseDisposalError,
  type CoverLetterResponseDisposalInput,
  type CoverLetterResponseDisposalOutput,
  validateResponseDisposalInput,
  validateResponseDisposalOutput,
} from "./cover-letter-response-disposal-contract.js";
import type { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new CoverLetterResponseDisposalError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Private maintenance only, default off, exact numeric target and one SDK attempt. A local
 * deadline/lost acknowledgement never certifies response disposal or private-writer quiescence.
 */
export class CoverLetterResponseDisposalClient {
  private readonly version: string;
  constructor(
    private readonly functionArn: string,
    private readonly client: CoverLetterProviderLambdaClient,
    private readonly enabled: () => boolean = () => false,
    private readonly timeoutMs = 10_000,
  ) {
    try {
      this.version = providerControlVersion(functionArn);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw Error();
    } catch {
      throw new CoverLetterResponseDisposalError();
    }
  }

  private async call(
    raw: CoverLetterResponseDisposalInput,
  ): Promise<CoverLetterResponseDisposalOutput> {
    try {
      if (!validateResponseDisposalInput(raw) || !this.enabled())
        throw new CoverLetterResponseDisposalError();
      const input = structuredClone(raw);
      const payload = new TextEncoder().encode(JSON.stringify(input));
      if (payload.length > 8_192) throw new CoverLetterResponseDisposalError();
      const deadline = AbortSignal.timeout(this.timeoutMs);
      if ((await bounded(this.client.config.maxAttempts(), deadline)) !== 1 || !this.enabled())
        throw new CoverLetterResponseDisposalError();
      deadline.throwIfAborted();
      const result = await bounded(
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
        result.StatusCode !== 200 ||
        result.ExecutedVersion !== this.version ||
        result.FunctionError !== undefined ||
        result.LogResult !== undefined ||
        !(result.Payload instanceof Uint8Array) ||
        result.Payload.length < 1 ||
        result.Payload.length > 8_192
      )
        throw new CoverLetterResponseDisposalError();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(result.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateResponseDisposalOutput(output) ||
        output.action !== input.action ||
        output.reference.id !== input.reference.id ||
        output.reference.documentId !== input.reference.documentId ||
        output.reference.requestSha256 !== input.reference.requestSha256 ||
        (input.action === "record_disposal" &&
          output.action === "record_disposal" &&
          (output.cleanup.reference.responseId !== input.cleanup.reference.responseId ||
            output.cleanup.reference.createdAt !== input.cleanup.reference.createdAt ||
            output.cleanup.terminalStatus !== input.cleanup.terminalStatus)) ||
        !this.enabled()
      )
        throw new CoverLetterResponseDisposalError();
      return structuredClone(output);
    } catch {
      throw new CoverLetterResponseDisposalError();
    }
  }

  async read(
    reference: Parameters<PostgresCoverLetterResponseStore["read"]>[0],
  ): ReturnType<PostgresCoverLetterResponseStore["read"]> {
    const output = await this.call({ schemaVersion: 1, action: "read", reference });
    if (output.action !== "read" || output.outcome !== "read")
      throw new CoverLetterResponseDisposalError();
    return output.inventory;
  }

  /** Owned successful-generation eligibility only, never ordinary inventory fallback. */
  async readCompleted(
    reference: Parameters<PostgresCoverLetterResponseStore["readCompleted"]>[0],
  ): ReturnType<PostgresCoverLetterResponseStore["readCompleted"]> {
    const output = await this.call({ schemaVersion: 1, action: "read_completed", reference });
    if (output.action !== "read_completed" || output.outcome !== "read")
      throw new CoverLetterResponseDisposalError();
    return output.inventory;
  }

  async recordDisposal(
    reference: Parameters<PostgresCoverLetterResponseStore["recordDisposal"]>[0],
    cleanup: Parameters<PostgresCoverLetterResponseStore["recordDisposal"]>[1],
  ): Promise<void> {
    const input: unknown = { schemaVersion: 1, action: "record_disposal", reference, cleanup };
    if (!validateResponseDisposalInput(input)) throw new CoverLetterResponseDisposalError();
    const output = await this.call(input);
    if (output.action !== "record_disposal" || output.outcome !== "recorded")
      throw new CoverLetterResponseDisposalError();
  }
}
