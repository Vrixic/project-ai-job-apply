import {
  compileComponentValidator,
  type PublicJobDetailResponse,
} from "@ai-job-apply/api-contracts";
import type { PublicJobDetailResult } from "@ai-job-apply/jobs-service";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";

export type PublicJobHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;

const publicJobPathPattern =
  /^\/v1\/public\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const revalidationHeader = "public, max-age=0, must-revalidate";
const noStoreHeader = "no-store";
const validatePublicJobDetailResponse = compileComponentValidator("PublicJobDetailResponse");
const availableResultKeys = new Set(["kind", "requestedJobId", "canonicalJobId", "isAlias", "job"]);
const publicJobKeys = new Set([
  "id",
  "companyName",
  "title",
  "locations",
  "department",
  "description",
  "firstObservedAt",
  "lastVerifiedAt",
  "expiresAt",
  "validThrough",
  "workMode",
  "employmentType",
  "datePosted",
  "applicationUrl",
  "structuredLocations",
]);

type CachedResult = Readonly<{
  expiresAt: number;
  result: PublicJobDetailResult;
}>;

export interface PublicJobReadCacheOptions {
  capacity: number;
  positiveTtlMs: number;
  negativeTtlMs: number;
  clock?: () => Date;
}

export interface PublicJobResultReader {
  get(jobId: string): Promise<PublicJobDetailResult>;
}

function requireFiniteDate(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Public job clock is invalid");
  }
  return new Date(now);
}

function resultExpiry(
  result: PublicJobDetailResult,
  now: Date,
  options: PublicJobReadCacheOptions,
) {
  if (result.kind === "absent") {
    return now.getTime() + options.negativeTtlMs;
  }
  const boundaries = [
    now.getTime() + options.positiveTtlMs,
    Date.parse(result.job.expiresAt),
    ...(result.job.validThrough === undefined ? [] : [Date.parse(result.job.validThrough)]),
  ];
  const expiry = Math.min(...boundaries);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    throw new Error("Public job cache boundary is invalid");
  }
  return expiry;
}

export class PublicJobReadCache {
  private readonly entries = new Map<string, CachedResult>();
  private readonly inFlight = new Map<string, Promise<PublicJobDetailResult>>();
  private readonly clock: () => Date;

  constructor(
    private readonly reader: PublicJobResultReader,
    private readonly options: PublicJobReadCacheOptions,
  ) {
    if (
      !Number.isInteger(options.capacity) ||
      options.capacity < 1 ||
      !Number.isInteger(options.positiveTtlMs) ||
      options.positiveTtlMs < 1 ||
      !Number.isInteger(options.negativeTtlMs) ||
      options.negativeTtlMs < 1
    ) {
      throw new Error("Public job cache options are invalid");
    }
    this.clock = options.clock ?? (() => new Date());
  }

  async get(jobId: string): Promise<PublicJobDetailResult> {
    const now = requireFiniteDate(this.clock);
    const cached = this.entries.get(jobId);
    if (cached && cached.expiresAt > now.getTime()) {
      this.entries.delete(jobId);
      this.entries.set(jobId, cached);
      return cached.result;
    }
    this.entries.delete(jobId);

    const pending = this.inFlight.get(jobId);
    if (pending) return pending;

    const request = this.reader
      .get(jobId)
      .then((result) => {
        const completedAt = requireFiniteDate(this.clock);
        const expiresAt = resultExpiry(result, completedAt, this.options);
        this.entries.set(jobId, Object.freeze({ expiresAt, result }));
        while (this.entries.size > this.options.capacity) {
          const oldest = this.entries.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
        return result;
      })
      .finally(() => this.inFlight.delete(jobId));
    this.inFlight.set(jobId, request);
    return request;
  }
}

function response(
  statusCode: number,
  body: object,
  options: { requestId: string; retryAfter?: number },
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "cache-control":
        statusCode === 200 || statusCode === 404 ? revalidationHeader : noStoreHeader,
      "content-type":
        statusCode === 200
          ? "application/json; charset=utf-8"
          : "application/problem+json; charset=utf-8",
      "x-request-id": options.requestId,
      ...(options.retryAfter === undefined ? {} : { "retry-after": String(options.retryAfter) }),
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function problem(status: number, code: string, title: string, requestId: string) {
  return {
    type: `urn:ai-job-apply:problem:${code}`,
    title,
    status,
    code,
    traceId: requestId,
  };
}

function assertResponseBinding(result: Extract<PublicJobDetailResult, { kind: "available" }>) {
  if (
    Object.keys(result).some((key) => !availableResultKeys.has(key)) ||
    typeof result.job !== "object" ||
    result.job === null ||
    Object.keys(result.job).some((key) => !publicJobKeys.has(key)) ||
    result.job.id !== result.canonicalJobId ||
    result.isAlias !== (result.requestedJobId !== result.canonicalJobId)
  ) {
    throw new Error("Public job identity binding is invalid");
  }
}

export function createPublicJobReadHandler(
  cache: Pick<PublicJobReadCache, "get">,
): PublicJobHandler {
  return async (event) => {
    const pathMatch = publicJobPathPattern.exec(event.rawPath);
    if (
      event.version !== "2.0" ||
      event.routeKey !== "GET /v1/public/jobs/{jobId}" ||
      event.isBase64Encoded ||
      event.requestContext.http.method !== "GET" ||
      pathMatch === null ||
      event.rawQueryString !== "" ||
      event.body !== undefined
    ) {
      return response(
        400,
        problem(
          400,
          "PUBLIC_JOB_INVALID_REQUEST",
          "Invalid public job request",
          event.requestContext.requestId,
        ),
        { requestId: event.requestContext.requestId },
      );
    }

    try {
      const result = await cache.get(pathMatch[1] as string);
      if (result.kind === "absent") {
        return response(
          404,
          problem(
            404,
            "PUBLIC_JOB_NOT_FOUND",
            "Public job not found",
            event.requestContext.requestId,
          ),
          { requestId: event.requestContext.requestId },
        );
      }
      assertResponseBinding(result);
      const body: PublicJobDetailResponse = {
        requestedJobId: result.requestedJobId,
        canonicalJobId: result.canonicalJobId,
        isAlias: result.isAlias,
        job: {
          id: result.job.id,
          companyName: result.job.companyName,
          title: result.job.title,
          locations: [...result.job.locations],
          ...(result.job.department === undefined ? {} : { department: result.job.department }),
          description: result.job.description,
          firstObservedAt: result.job.firstObservedAt,
          lastVerifiedAt: result.job.lastVerifiedAt,
          expiresAt: result.job.expiresAt,
          ...(result.job.validThrough === undefined
            ? {}
            : { validThrough: result.job.validThrough }),
          ...(result.job.workMode === undefined ? {} : { workMode: result.job.workMode }),
          ...(result.job.employmentType === undefined
            ? {}
            : { employmentType: result.job.employmentType }),
          ...(result.job.datePosted === undefined ? {} : { datePosted: result.job.datePosted }),
          ...(result.job.applicationUrl === undefined
            ? {}
            : { applicationUrl: result.job.applicationUrl }),
          ...(result.job.structuredLocations === undefined
            ? {}
            : {
                structuredLocations: result.job.structuredLocations.map((location) => ({
                  address: { ...location.address },
                })),
              }),
        },
      };
      if (!validatePublicJobDetailResponse(body)) {
        throw new Error("Public job response shape is invalid");
      }
      return response(200, body, { requestId: event.requestContext.requestId });
    } catch {
      return publicJobUnavailableResponse(event.requestContext.requestId);
    }
  };
}

export function publicJobUnavailableResponse(requestId: string) {
  return response(
    503,
    problem(503, "PUBLIC_JOB_UNAVAILABLE", "Public job detail is unavailable", requestId),
    { requestId, retryAfter: 5 },
  );
}
