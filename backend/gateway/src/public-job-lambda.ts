import { loadPublicJobEdgeLambdaConfig } from "@ai-job-apply/config/public-job-edge";
import type {
  PublicJobDetailResult,
  PublicJobSitemapCursor,
  PublicJobSitemapProjectionPage,
} from "@ai-job-apply/jobs-service";
import { initializeTelemetry } from "@ai-job-apply/observability";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  createPublicJobReadHandler,
  type PublicJobHandler,
  PublicJobReadCache,
  publicJobUnavailableResponse,
} from "./public-job-read.js";
import {
  assertPublicJobSitemapProjection,
  createPublicJobSitemapReadHandler,
  type PublicJobSitemapResultReader,
} from "./public-job-sitemap-read.js";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const resultKeys = new Set(["kind", "requestedJobId", "canonicalJobId", "isAlias", "job"]);
const absentKeys = new Set(["kind"]);
const jobKeys = new Set([
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
const structuredLocationKeys = new Set(["address"]);
const structuredAddressKeys = new Set(["addressCountry", "addressLocality", "addressRegion"]);
const workModes = new Set(["remote", "hybrid", "on_site", "unknown"]);
const employmentTypes = new Set(["full_time", "part_time", "contract", "internship", "unknown"]);

function exactKeys(value: object, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasUnsafeControlCharacter(value: string, allowPlainTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (
      (code < 0x20 && !(allowPlainTextWhitespace && [0x09, 0x0a, 0x0d].includes(code))) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x00ad ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff ||
      code === 0xe0001 ||
      (code >= 0xe0020 && code <= 0xe007f)
    ) {
      return true;
    }
  }
  return false;
}

function boundedText(value: unknown, maximum: number, allowPlainTextWhitespace = false): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= maximum &&
    !hasUnsafeControlCharacter(value, allowPlainTextWhitespace)
  );
}

function canonicalInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    canonicalInstantPattern.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validApplicationUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096 || !value.startsWith("https://")) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function validStructuredLocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  if (!exactKeys(location, structuredLocationKeys)) return false;
  const address = location.address;
  if (!address || typeof address !== "object" || Array.isArray(address)) return false;
  const fields = address as Record<string, unknown>;
  return (
    exactKeys(fields, structuredAddressKeys) &&
    boundedText(fields.addressCountry, 100) &&
    (fields.addressLocality === undefined || boundedText(fields.addressLocality, 200)) &&
    (fields.addressRegion === undefined || boundedText(fields.addressRegion, 200))
  );
}

function validProjectedJob(value: unknown, canonicalJobId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, jobKeys)) {
    return false;
  }
  const job = value as Record<string, unknown>;
  if (
    job.id !== canonicalJobId ||
    !boundedText(job.companyName, 200) ||
    !boundedText(job.title, 240) ||
    !Array.isArray(job.locations) ||
    job.locations.length < 1 ||
    job.locations.length > 20 ||
    job.locations.some((location) => !boundedText(location, 240)) ||
    (job.department !== undefined && !boundedText(job.department, 200)) ||
    !boundedText(job.description, 200_000, true) ||
    !canonicalInstant(job.firstObservedAt) ||
    !canonicalInstant(job.lastVerifiedAt) ||
    !canonicalInstant(job.expiresAt) ||
    (job.validThrough !== undefined && !canonicalInstant(job.validThrough)) ||
    (job.workMode !== undefined && !workModes.has(job.workMode as string)) ||
    (job.employmentType !== undefined && !employmentTypes.has(job.employmentType as string)) ||
    (job.datePosted !== undefined && !canonicalInstant(job.datePosted)) ||
    (job.applicationUrl !== undefined && !validApplicationUrl(job.applicationUrl)) ||
    (job.structuredLocations !== undefined &&
      (!Array.isArray(job.structuredLocations) ||
        job.structuredLocations.length < 1 ||
        job.structuredLocations.length > 20 ||
        job.structuredLocations.some((location) => !validStructuredLocation(location))))
  ) {
    return false;
  }
  const firstObservedAt = Date.parse(job.firstObservedAt);
  const lastVerifiedAt = Date.parse(job.lastVerifiedAt);
  const expiresAt = Date.parse(job.expiresAt);
  const validThrough = job.validThrough === undefined ? undefined : Date.parse(job.validThrough);
  const datePosted = job.datePosted === undefined ? undefined : Date.parse(job.datePosted);
  return (
    firstObservedAt <= lastVerifiedAt &&
    lastVerifiedAt <= expiresAt &&
    (validThrough === undefined ||
      (firstObservedAt <= validThrough && validThrough <= expiresAt)) &&
    (datePosted === undefined || datePosted <= firstObservedAt)
  );
}

export function parseProjectionResult(payload: Uint8Array | undefined): PublicJobDetailResult {
  if (!payload || payload.byteLength < 2 || payload.byteLength > 256_000) {
    throw new Error("The public projection response is invalid");
  }
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The public projection response is invalid");
  }
  const result = parsed as Record<string, unknown>;
  if (result.kind === "absent") {
    if (!exactKeys(result, absentKeys)) {
      throw new Error("The public projection absence response is invalid");
    }
    return result as unknown as PublicJobDetailResult;
  }
  if (
    result.kind !== "available" ||
    !exactKeys(result, resultKeys) ||
    typeof result.requestedJobId !== "string" ||
    !uuidV7Pattern.test(result.requestedJobId) ||
    typeof result.canonicalJobId !== "string" ||
    !uuidV7Pattern.test(result.canonicalJobId) ||
    typeof result.isAlias !== "boolean" ||
    result.isAlias !== (result.requestedJobId !== result.canonicalJobId) ||
    !validProjectedJob(result.job, result.canonicalJobId)
  ) {
    throw new Error("The public projection available response is invalid");
  }
  return result as unknown as PublicJobDetailResult;
}

export class LambdaPublicJobDetailReader {
  constructor(
    private readonly client: Pick<LambdaClient, "send">,
    private readonly functionName: string,
  ) {}

  async get(jobId: string): Promise<PublicJobDetailResult> {
    if (!uuidV7Pattern.test(jobId)) throw new Error("The public projection identifier is invalid");
    const response = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, jobId })),
      }),
    );
    if (
      response.StatusCode !== 200 ||
      response.FunctionError ||
      typeof response.ExecutedVersion !== "string" ||
      !/^[1-9][0-9]*$/.test(response.ExecutedVersion)
    ) {
      throw new Error("The public projection invocation failed");
    }
    return parseProjectionResult(response.Payload);
  }
}

export function parseSitemapProjectionResult(
  payload: Uint8Array | undefined,
): PublicJobSitemapProjectionPage {
  if (!payload || payload.byteLength < 2 || payload.byteLength > 64_000) {
    throw new Error("The public sitemap projection response is invalid");
  }
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
  assertPublicJobSitemapProjection(parsed, new Date());
  return parsed;
}

export class LambdaPublicJobSitemapReader implements PublicJobSitemapResultReader {
  constructor(
    private readonly client: Pick<LambdaClient, "send">,
    private readonly functionName: string,
  ) {}

  async list(
    cursor: Readonly<PublicJobSitemapCursor> | undefined,
  ): Promise<PublicJobSitemapProjectionPage> {
    const response = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({ schemaVersion: 1, operation: "sitemap", cursor: cursor ?? null }),
        ),
      }),
    );
    if (
      response.StatusCode !== 200 ||
      response.FunctionError ||
      typeof response.ExecutedVersion !== "string" ||
      !/^[1-9][0-9]*$/.test(response.ExecutedVersion)
    ) {
      throw new Error("The public sitemap projection invocation failed");
    }
    return parseSitemapProjectionResult(response.Payload);
  }
}

export async function createConfiguredPublicJobHandler(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PublicJobHandler> {
  const config = loadPublicJobEdgeLambdaConfig(environment);
  initializeTelemetry({
    service: "public-job-edge",
    environment: config.NODE_ENV,
    releaseSha: config.RELEASE_SHA,
    sampleRatio: config.OTEL_TRACE_SAMPLE_RATIO,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
  });
  const lambda = new LambdaClient({ region: config.AWS_REGION });
  const reader = new LambdaPublicJobDetailReader(lambda, config.PUBLIC_JOB_PROJECTION_ARN);
  const detailHandler = createPublicJobReadHandler(
    new PublicJobReadCache(reader, {
      capacity: config.PUBLIC_JOB_CACHE_CAPACITY,
      positiveTtlMs: config.PUBLIC_JOB_CACHE_TTL_MS,
      negativeTtlMs: config.PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS,
    }),
  );
  const sitemapHandler = createPublicJobSitemapReadHandler(
    new LambdaPublicJobSitemapReader(lambda, config.PUBLIC_JOB_PROJECTION_ARN),
  );
  return async (event, context) =>
    event.routeKey === "GET /v1/public/jobs/sitemap"
      ? sitemapHandler(event, context)
      : detailHandler(event, context);
}

export function createLazyPublicJobHandler(
  initialize: () => Promise<PublicJobHandler>,
): PublicJobHandler {
  let configured: PublicJobHandler | undefined;
  let initialization: Promise<PublicJobHandler> | undefined;
  return async (event, context) => {
    if (!configured) {
      try {
        initialization ??= initialize();
        configured = await initialization;
      } catch {
        initialization = undefined;
        return publicJobUnavailableResponse(event.requestContext.requestId);
      }
    }
    try {
      return await configured(event, context);
    } catch {
      return publicJobUnavailableResponse(event.requestContext.requestId);
    }
  };
}

export const handler = createLazyPublicJobHandler(() => createConfiguredPublicJobHandler());
