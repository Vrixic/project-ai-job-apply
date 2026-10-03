import { InvokeCommand } from "@aws-sdk/client-lambda";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import {
  CoverLetterResponseCaptureError,
  type CoverLetterResponseCaptureInput,
  type CoverLetterResponseCaptureOutput,
  validateResponseCaptureInput,
  validateResponseCaptureOutput,
} from "./cover-letter-response-capture-contract.js";
import type { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new CoverLetterResponseCaptureError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Original actor capture capability only, separate from maintenance/settlement.
 * Default off, exact numeric version, one SDK attempt. Lost RPC acknowledgements are unresolved.
 */
export class CoverLetterResponseCaptureClient {
  private readonly version: string;
  constructor(
    private readonly functionArn: string,
    private readonly client: CoverLetterProviderLambdaClient,
    private readonly enabled: () => boolean = () => false,
    private readonly timeoutMs = 10_000,
  ) {
    this.version = providerControlVersion(functionArn);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
      throw new CoverLetterResponseCaptureError();
  }

  private async call(
    raw: CoverLetterResponseCaptureInput,
  ): Promise<CoverLetterResponseCaptureOutput> {
    try {
      if (!validateResponseCaptureInput(raw) || !this.enabled())
        throw new CoverLetterResponseCaptureError();
      const input = structuredClone(raw);
      const payload = new TextEncoder().encode(JSON.stringify(input));
      if (payload.length > 8_192) throw new CoverLetterResponseCaptureError();
      const deadline = AbortSignal.timeout(this.timeoutMs);
      if ((await bounded(this.client.config.maxAttempts(), deadline)) !== 1 || !this.enabled())
        throw new CoverLetterResponseCaptureError();
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
        throw new CoverLetterResponseCaptureError();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(result.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateResponseCaptureOutput(output) ||
        output.action !== input.action ||
        output.reference.id !== input.reference.id ||
        output.reference.documentId !== input.reference.documentId ||
        output.reference.requestSha256 !== input.reference.requestSha256 ||
        (input.action === "record_creation" &&
          output.action === "record_creation" &&
          (output.response.responseId !== input.response.responseId ||
            output.response.createdAt !== input.response.createdAt)) ||
        !this.enabled()
      )
        throw new CoverLetterResponseCaptureError();
      return structuredClone(output);
    } catch {
      throw new CoverLetterResponseCaptureError();
    }
  }

  async reserve(
    reference: Parameters<PostgresCoverLetterResponseStore["reserve"]>[0],
  ): ReturnType<PostgresCoverLetterResponseStore["reserve"]> {
    const output = await this.call({ schemaVersion: 1, action: "reserve", reference });
    if (output.action !== "reserve" || output.outcome === "unavailable")
      throw new CoverLetterResponseCaptureError();
    return { kind: output.outcome };
  }

  async recordCreation(
    reference: Parameters<PostgresCoverLetterResponseStore["recordCreation"]>[0],
    response: Parameters<PostgresCoverLetterResponseStore["recordCreation"]>[1],
  ): Promise<void> {
    const output = await this.call({
      schemaVersion: 1,
      action: "record_creation",
      reference,
      response,
    });
    if (output.action !== "record_creation" || output.outcome !== "recorded")
      throw new CoverLetterResponseCaptureError();
  }
}
