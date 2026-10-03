import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  CoverLetterProviderControlError,
  type CoverLetterProviderControlInput,
  type CoverLetterProviderControlOutput,
  providerControlVersion,
  validateProviderControlInput,
  validateProviderControlOutput,
} from "./cover-letter-provider-control-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new CoverLetterProviderControlError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Isolated provider capability only. No SQL, owner selection, issue/renewal or other-phase
 * settlement. Source-only/default-off until exact-version sender IAM and runtime are reviewed.
 * Lost responses never retry or prove that remote committed work stopped.
 */
export class CoverLetterProviderControlClient {
  private readonly version: string;
  constructor(
    private readonly functionArn: string,
    private readonly client: CoverLetterProviderLambdaClient,
    private readonly enabled: () => boolean = () => false,
    private readonly timeoutMs = 10_000,
  ) {
    this.version = providerControlVersion(functionArn);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
      throw new CoverLetterProviderControlError();
  }

  private async call(
    raw: CoverLetterProviderControlInput,
  ): Promise<CoverLetterProviderControlOutput> {
    try {
      if (!validateProviderControlInput(raw) || !this.enabled())
        throw new CoverLetterProviderControlError();
      const input = structuredClone(raw);
      const payload = new TextEncoder().encode(JSON.stringify(input));
      if (payload.length > 8_192) throw new CoverLetterProviderControlError();
      const deadline = AbortSignal.timeout(this.timeoutMs);
      if ((await bounded(this.client.config.maxAttempts(), deadline)) !== 1 || !this.enabled())
        throw new CoverLetterProviderControlError();
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
        response.StatusCode !== 200 ||
        response.ExecutedVersion !== this.version ||
        response.FunctionError !== undefined ||
        response.LogResult !== undefined ||
        !(response.Payload instanceof Uint8Array) ||
        response.Payload.length < 1 ||
        response.Payload.length > 8_192
      )
        throw new CoverLetterProviderControlError();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(response.Payload);
      const output: unknown = JSON.parse(text);
      if (
        JSON.stringify(output) !== text ||
        !validateProviderControlOutput(output) ||
        output.action !== input.action ||
        output.documentId !== input.documentId ||
        (input.action === "claim" &&
          output.outcome === "claimed" &&
          output.reference.requestSha256 !== input.requestSha256) ||
        (input.action !== "claim" &&
          output.outcome === "settled" &&
          (output.reference.id !== input.reference.id ||
            output.reference.requestSha256 !== input.reference.requestSha256))
      )
        throw new CoverLetterProviderControlError();
      return structuredClone(output);
    } catch {
      throw new CoverLetterProviderControlError();
    }
  }

  async claimProviderDispatch(
    input: Parameters<PostgresCoverLetterWorkStore["claimProviderDispatch"]>[0],
  ): ReturnType<PostgresCoverLetterWorkStore["claimProviderDispatch"]> {
    try {
      const result = await this.call({
        schemaVersion: 1,
        action: "claim",
        documentId: input.documentId,
        requestSha256: input.requestSha256,
        consentExpiresAt: input.consentExpiresAt.toISOString(),
      });
      return result.outcome === "claimed"
        ? { kind: "claimed", reference: result.reference }
        : { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  }
  async settleProviderDispatch(
    reference: Parameters<PostgresCoverLetterWorkStore["settleProviderDispatch"]>[0],
  ): Promise<void> {
    const result = await this.call({
      schemaVersion: 1,
      action: "settle",
      documentId: reference.documentId,
      reference,
    });
    if (result.outcome !== "settled") throw new CoverLetterProviderControlError();
  }
  async settleRejectedProviderDispatch(
    reference: Parameters<PostgresCoverLetterWorkStore["settleRejectedProviderDispatch"]>[0],
  ): Promise<void> {
    const result = await this.call({
      schemaVersion: 1,
      action: "settle_rejected",
      documentId: reference.documentId,
      reference,
    });
    if (result.outcome !== "settled") throw new CoverLetterProviderControlError();
  }

  async settleUndispatchedProviderDispatch(
    reference: Parameters<PostgresCoverLetterWorkStore["settleUndispatchedProviderDispatch"]>[0],
  ): Promise<void> {
    const result = await this.call({
      schemaVersion: 1,
      action: "settle_undispatched",
      documentId: reference.documentId,
      reference,
    });
    if (result.outcome !== "settled") throw new CoverLetterProviderControlError();
  }
}
