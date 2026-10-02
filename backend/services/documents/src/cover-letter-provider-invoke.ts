import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  type CoverLetterProviderOutput,
  CoverLetterProviderTransportError,
  validateCoverLetterProviderInput,
  validateCoverLetterProviderOutput,
} from "./cover-letter-provider-contract.js";

export interface CoverLetterProviderLambdaClient {
  /** Runtime bootstrap must configure the SDK with a fixed maxAttempts: 1. */
  readonly config: { readonly maxAttempts: () => Promise<number> };
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

const WIRE_BYTE_LIMIT = 8_192;

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new CoverLetterProviderTransportError());
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Source-only, injected SDK adapter. No credentials/bootstrap, model, database or object-write
 * capability. It is uncomposed: bounded privacy authorization/quiescence and reviewed IAM/runtime
 * must precede activation. Local Invoke cancellation never proves remote completion/quiescence.
 */
export class CoverLetterProviderInvoker {
  private readonly version: string;

  constructor(
    private readonly functionArn: string,
    private readonly client: CoverLetterProviderLambdaClient,
    private readonly enabled: () => boolean = () => false,
    private readonly timeoutMs = 70_000,
  ) {
    const match =
      /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:([1-9][0-9]{0,8})$/u.exec(
        functionArn,
      );
    if (!match?.[1] || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 75_000)
      throw new CoverLetterProviderTransportError();
    this.version = match[1];
  }

  async invoke(raw: unknown, signal?: AbortSignal): Promise<CoverLetterProviderOutput> {
    let payload: Uint8Array;
    let documentId: string;
    try {
      if (!validateCoverLetterProviderInput(raw)) throw new CoverLetterProviderTransportError();
      documentId = raw.documentId;
      // Snapshot only the strict identifier/reference contract before any asynchronous work.
      payload = new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          documentId,
          request: {
            objectVersion: raw.request.objectVersion,
            etag: raw.request.etag,
            sha256: raw.request.sha256,
            sizeBytes: raw.request.sizeBytes,
          },
        }),
      );
      if (payload.length > WIRE_BYTE_LIMIT) throw new CoverLetterProviderTransportError();
    } catch {
      throw new CoverLetterProviderTransportError();
    }
    const failed: CoverLetterProviderOutput = { schemaVersion: 1, documentId, outcome: "failed" };
    const inProgress: CoverLetterProviderOutput = { ...failed, outcome: "in_progress" };
    let attempted = false;
    try {
      if (!this.enabled()) return failed;
      const deadline = AbortSignal.any([
        AbortSignal.timeout(this.timeoutMs),
        ...(signal ? [signal] : []),
      ]);
      deadline.throwIfAborted();
      if ((await bounded(this.client.config.maxAttempts(), deadline)) !== 1) return failed;
      if (!this.enabled()) return failed;
      deadline.throwIfAborted();
      attempted = true;
      // Exactly one send. Never request logs, invoke asynchronously or choose a caller target.
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
        response.StatusCode !== 200 ||
        response.ExecutedVersion !== this.version ||
        response.FunctionError !== undefined ||
        response.LogResult !== undefined ||
        !(response.Payload instanceof Uint8Array) ||
        response.Payload.length < 1 ||
        response.Payload.length > WIRE_BYTE_LIMIT
      )
        return inProgress;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(response.Payload);
      const result: unknown = JSON.parse(text);
      // Native Lambda serialization is compact JSON; reject duplicates/escaped ambiguous keys.
      if (
        JSON.stringify(result) !== text ||
        !validateCoverLetterProviderOutput(result) ||
        result.documentId !== documentId
      )
        return inProgress;
      return result.outcome === "ready"
        ? { schemaVersion: 1, documentId, outcome: "ready", result: { ...result.result } }
        : { schemaVersion: 1, documentId, outcome: result.outcome };
    } catch {
      // Remote execution may already have disclosed data or persisted a ready result.
      // Recovery uses the original document/request identity, never a new model request.
      return attempted ? inProgress : failed;
    }
  }
}
