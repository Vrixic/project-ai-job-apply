import {
  RESUME_TAILORING_RESULT_SCHEMA,
  type ResumeTailoringRequest,
  type ResumeTailoringResult,
} from "@ai-job-apply/documents-service";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

/**
 * The Gateway's only path to resume text. Tailoring runs in the Documents runtime (ADR-031); the
 * Gateway never reads the normalized resume object. Errors carry no payload text.
 */
export interface ResumeTailoringClient {
  tailor(request: ResumeTailoringRequest): Promise<ResumeTailoringResult>;
}

export class ResumeTailoringTransportError extends Error {
  constructor() {
    super("The resume tailoring runtime is unavailable");
    this.name = "ResumeTailoringTransportError";
  }
}

interface LambdaSender {
  send(
    command: InvokeCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{ FunctionError?: string; Payload?: Uint8Array }>;
}

const MAXIMUM_RESPONSE_BYTES = 6 * 1024 * 1024;

function isResult(value: unknown): value is ResumeTailoringResult {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { schema?: unknown }).schema === RESUME_TAILORING_RESULT_SCHEMA &&
    ["ready", "no_resume", "unavailable"].includes((value as { status?: string }).status ?? "")
  );
}

/** Invokes the exact, reviewed processor alias synchronously with one fixed request kind. */
export class LambdaResumeTailoringClient implements ResumeTailoringClient {
  constructor(
    private readonly functionArn: string,
    private readonly client: LambdaSender = new LambdaClient({}) as unknown as LambdaSender,
    private readonly timeoutMilliseconds = 10_000,
  ) {}

  async tailor(request: ResumeTailoringRequest): Promise<ResumeTailoringResult> {
    let payload: Uint8Array | undefined;
    try {
      const response = await this.client.send(
        new InvokeCommand({
          FunctionName: this.functionArn,
          InvocationType: "RequestResponse",
          Payload: new TextEncoder().encode(JSON.stringify(request)),
        }),
        { abortSignal: AbortSignal.timeout(this.timeoutMilliseconds) },
      );
      if (response.FunctionError) throw new ResumeTailoringTransportError();
      payload = response.Payload;
    } catch {
      throw new ResumeTailoringTransportError();
    }
    if (!payload || payload.byteLength < 2 || payload.byteLength > MAXIMUM_RESPONSE_BYTES) {
      throw new ResumeTailoringTransportError();
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      throw new ResumeTailoringTransportError();
    }
    if (!isResult(value)) throw new ResumeTailoringTransportError();
    return value;
  }
}
