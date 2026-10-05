import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  CoverLetterCleanupError,
  type CoverLetterCleanupInput,
  validateCoverLetterCleanupInput,
  validateCoverLetterCleanupOutput,
} from "./cover-letter-cleanup-contract.js";
import { providerControlVersion } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new CoverLetterCleanupError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Maintenance fence only. A lost acknowledgement never means remote work stopped. */
export class CoverLetterCleanupClient {
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
      throw new CoverLetterCleanupError();
    }
  }

  async fenceForCleanup(
    reference: Parameters<PostgresCoverLetterWorkStore["fenceForCleanup"]>[0],
  ): ReturnType<PostgresCoverLetterWorkStore["fenceForCleanup"]> {
    try {
      const raw: CoverLetterCleanupInput = {
        schemaVersion: 1,
        action: "fence",
        documentId: reference.documentId,
        reference,
      };
      if (!validateCoverLetterCleanupInput(raw) || !this.enabled()) throw Error();
      const input = structuredClone(raw);
      const payload = new TextEncoder().encode(JSON.stringify(input));
      if (payload.length > 8_192) throw Error();
      const deadline = AbortSignal.timeout(this.timeoutMs);
      if ((await bounded(this.client.config.maxAttempts(), deadline)) !== 1 || !this.enabled())
        throw Error();
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
        throw Error();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(result.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateCoverLetterCleanupOutput(output) ||
        output.reference.id !== input.reference.id ||
        output.reference.documentId !== input.reference.documentId ||
        output.reference.purpose !== input.reference.purpose ||
        output.reference.requestSha256 !== input.reference.requestSha256 ||
        output.outcome === "unavailable" ||
        !this.enabled()
      )
        throw Error();
      return output.outcome;
    } catch {
      throw new CoverLetterCleanupError();
    }
  }
}
