import {
  compileComponentValidator,
  type ProblemDetails,
  type PublicJobDetailResponse,
} from "@ai-job-apply/api-contracts";
import { cache } from "react";

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumResponseBytes = 1_500_000;
const validateResponse = compileComponentValidator("PublicJobDetailResponse");
const validateProblem = compileComponentValidator("ProblemDetails");

type RegisterCancellation = (cancel: (() => void) | undefined) => void;

export type PublicJobReadResult =
  | Readonly<{ kind: "available"; detail: PublicJobDetailResponse }>
  | Readonly<{ kind: "absent" }>;

export class PublicJobPageUnavailableError extends Error {
  constructor() {
    super("Public job page is unavailable");
    this.name = "PublicJobPageUnavailableError";
  }
}

function platformOrigin(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PLATFORM_API_BASE_URL is invalid");
  }
  return url;
}

function isSemanticallyValid(value: PublicJobDetailResponse, now: Date) {
  const parseCanonicalInstant = (instant: string) => {
    const milliseconds = Date.parse(instant);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === instant
      ? milliseconds
      : Number.NaN;
  };
  const firstObservedAt = parseCanonicalInstant(value.job.firstObservedAt);
  const lastVerifiedAt = parseCanonicalInstant(value.job.lastVerifiedAt);
  const expiresAt = parseCanonicalInstant(value.job.expiresAt);
  const validThrough =
    value.job.validThrough === undefined
      ? undefined
      : parseCanonicalInstant(value.job.validThrough);
  return (
    value.job.id === value.canonicalJobId &&
    value.isAlias === (value.requestedJobId !== value.canonicalJobId) &&
    firstObservedAt <= lastVerifiedAt &&
    lastVerifiedAt <= now.getTime() &&
    expiresAt > now.getTime() &&
    expiresAt >= lastVerifiedAt &&
    (validThrough === undefined ||
      (validThrough > now.getTime() &&
        validThrough >= firstObservedAt &&
        validThrough <= expiresAt))
  );
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (!body) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must never replace the fixed public failure boundary.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort and must never replace the fixed public failure boundary.
  }
}

async function readBoundedJson(
  response: Response,
  mediaType: string,
  registerCancellation: RegisterCancellation,
): Promise<unknown> {
  registerCancellation(response.body ? () => cancelBody(response.body) : undefined);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== mediaType) {
    cancelBody(response.body);
    registerCancellation(undefined);
    throw new PublicJobPageUnavailableError();
  }

  const declaredLengthHeader = response.headers.get("content-length");
  let declaredLength: number | undefined;
  if (response.headers.has("transfer-encoding")) {
    cancelBody(response.body);
    registerCancellation(undefined);
    throw new PublicJobPageUnavailableError();
  }
  if (declaredLengthHeader !== null) {
    if (!/^\d+$/.test(declaredLengthHeader)) {
      cancelBody(response.body);
      registerCancellation(undefined);
      throw new PublicJobPageUnavailableError();
    }
    declaredLength = Number(declaredLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maximumResponseBytes) {
      cancelBody(response.body);
      registerCancellation(undefined);
      throw new PublicJobPageUnavailableError();
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    registerCancellation(undefined);
    throw new PublicJobPageUnavailableError();
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let complete = false;
  let cancellationRequested = false;
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    cancelReader(reader);
  };
  registerCancellation(cancel);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      const nextTotalBytes = totalBytes + chunk.value.byteLength;
      if (nextTotalBytes > maximumResponseBytes) {
        throw new PublicJobPageUnavailableError();
      }
      totalBytes = nextTotalBytes;
      chunks.push(chunk.value);
    }
  } finally {
    registerCancellation(undefined);
    if (!complete) cancel();
  }
  if (declaredLength !== undefined && totalBytes !== declaredLength) {
    throw new PublicJobPageUnavailableError();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function isExactNotFoundProblem(value: unknown): value is ProblemDetails {
  if (!validateProblem(value)) return false;
  const problem = value as ProblemDetails;
  return (
    problem.type === "urn:ai-job-apply:problem:PUBLIC_JOB_NOT_FOUND" &&
    problem.title === "Public job not found" &&
    problem.status === 404 &&
    problem.code === "PUBLIC_JOB_NOT_FOUND"
  );
}

export async function fetchPublicJobDetail(
  jobId: string,
  options: {
    baseUrl?: string;
    fetchImplementation?: typeof fetch;
    now?: () => Date;
    timeoutMilliseconds?: number;
  } = {},
): Promise<PublicJobReadResult> {
  if (!jobIdPattern.test(jobId)) return Object.freeze({ kind: "absent" });
  try {
    const baseUrl = platformOrigin(
      options.baseUrl ?? process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    );
    const controller = new AbortController();
    let cancelActiveRead: (() => void) | undefined;
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      cancelActiveRead?.();
      rejectDeadline?.(new PublicJobPageUnavailableError());
    }, options.timeoutMilliseconds ?? 5_000);
    try {
      const read = async (): Promise<PublicJobReadResult> => {
        const response = await (options.fetchImplementation ?? fetch)(
          new URL(`/v1/public/jobs/${jobId}`, baseUrl),
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) {
          cancelBody(response.body);
          throw new PublicJobPageUnavailableError();
        }
        const registerCancellation: RegisterCancellation = (cancel) => {
          cancelActiveRead = cancel;
        };
        if (response.status === 404) {
          const problem = await readBoundedJson(
            response,
            "application/problem+json",
            registerCancellation,
          );
          if (!isExactNotFoundProblem(problem)) throw new PublicJobPageUnavailableError();
          return Object.freeze({ kind: "absent" });
        }
        if (!response.ok) {
          cancelBody(response.body);
          throw new PublicJobPageUnavailableError();
        }
        const parsed = await readBoundedJson(response, "application/json", registerCancellation);
        const now = options.now?.() ?? new Date();
        if (!Number.isFinite(now.getTime()) || !validateResponse(parsed)) {
          throw new PublicJobPageUnavailableError();
        }
        const validated = parsed as PublicJobDetailResponse;
        if (validated.requestedJobId !== jobId || !isSemanticallyValid(validated, now)) {
          throw new PublicJobPageUnavailableError();
        }
        return Object.freeze({ kind: "available", detail: validated });
      };
      return await Promise.race([read(), deadline]);
    } finally {
      clearTimeout(timeout);
      cancelActiveRead = undefined;
    }
  } catch (error) {
    if (error instanceof PublicJobPageUnavailableError) throw error;
    throw new PublicJobPageUnavailableError();
  }
}

export const getPublicJobDetail = cache((jobId: string) => fetchPublicJobDetail(jobId));
