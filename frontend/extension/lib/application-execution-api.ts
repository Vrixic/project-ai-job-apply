import type {
  ApplicationSubmissionResultRequest,
  StartApplicationSubmissionRequest,
} from "@ai-job-apply/api-contracts";
import {
  validateApplication,
  validateApplicationAttempt,
  validateApplicationSubmissionResultRequest,
  validateApplicationSubmissionStart,
  validateStartApplicationSubmissionRequest,
} from "@ai-job-apply/api-contracts/browser-validators";
import { safeApiOrigin } from "./config";
import { RUN_BUDGET_MS } from "./execution-budget";

const unavailable = () => Error("ApplicationExecutionUnavailable");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

/** Fixed owning routes only. Never retries a request, including a lost dispatch acknowledgement. */
export function applicationExecutionApi(options: {
  apiOrigin: string;
  accessToken: string;
  applicationId: string;
  deadline: number;
  /** The furthest the deadline may be from now: the short lease unless a fill-only run asks more. */
  maximumMs?: number;
  signal: AbortSignal;
}) {
  const maximumMs = options.maximumMs ?? RUN_BUDGET_MS;
  if (!safeApiOrigin(options.apiOrigin) || !UUID.test(options.applicationId)) throw unavailable();
  const root = `/v1/applications/${options.applicationId}`;
  async function post(path: string, value?: unknown, key?: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const now = Date.now();
    if (
      options.signal.aborted ||
      !Number.isFinite(options.deadline) ||
      options.deadline <= now ||
      options.deadline > now + maximumMs ||
      (key !== undefined && !/^[a-zA-Z0-9_-]{16,128}$/u.test(key))
    )
      throw unavailable();
    options.signal.addEventListener("abort", abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let body: ReadableStream<Uint8Array> | null | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = value === undefined ? undefined : JSON.stringify(value);
    try {
      if (request !== undefined && new TextEncoder().encode(request).byteLength > 16_384)
        throw unavailable();
      const work = async () => {
        const response = await fetch(new URL(path, options.apiOrigin), {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.accessToken}`,
            accept: "application/json",
            ...(request === undefined ? {} : { "content-type": "application/json" }),
            ...(key === undefined ? {} : { "Idempotency-Key": key }),
          },
          ...(request === undefined ? {} : { body: request }),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        body = response.body;
        if (
          controller.signal.aborted ||
          response.status !== 200 ||
          response.headers.get("cache-control")?.toLowerCase() !== "no-store" ||
          response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
            "application/json" ||
          !body
        )
          throw unavailable();
        reader = body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "";
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted) throw unavailable();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 512 * 1024) {
            chunk.value.fill(0);
            throw unavailable();
          }
          text += decoder.decode(chunk.value, { stream: true });
          chunk.value.fill(0);
        }
        text += decoder.decode();
        const result: unknown = JSON.parse(text);
        text = "";
        if (controller.signal.aborted || Date.now() >= options.deadline) throw unavailable();
        return result;
      };
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          const stop = () => {
            abort();
            reject(unavailable());
          };
          timer = setTimeout(stop, Math.min(10_000, options.deadline - now));
          controller.signal.addEventListener("abort", () => reject(unavailable()), { once: true });
          if (options.signal.aborted) stop();
        }),
      ]);
    } catch {
      throw unavailable();
    } finally {
      request = undefined;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      abort();
      if (reader) void reader.cancel().catch(() => undefined);
      else void body?.cancel().catch(() => undefined);
    }
  }
  return {
    async start(request: StartApplicationSubmissionRequest, commandId: string) {
      if (!validateStartApplicationSubmissionRequest(request)) throw unavailable();
      const response = await post(`${root}/submissions`, request, commandId);
      if (!validateApplicationSubmissionStart(response)) throw unavailable();
      return response;
    },
    async dispatch(attemptId: string) {
      if (!UUID.test(attemptId)) throw unavailable();
      const response = await post(`${root}/attempts/${attemptId}/dispatch`);
      if (!validateApplicationAttempt(response)) throw unavailable();
      return response;
    },
    async result(attemptId: string, result: ApplicationSubmissionResultRequest, commandId: string) {
      if (!UUID.test(attemptId) || !validateApplicationSubmissionResultRequest(result))
        throw unavailable();
      const response = await post(`${root}/attempts/${attemptId}/result`, result, commandId);
      if (!validateApplication(response)) throw unavailable();
      return response;
    },
  };
}
