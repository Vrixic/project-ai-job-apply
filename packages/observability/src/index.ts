import { randomUUID } from "node:crypto";
import {
  context,
  type Context,
  isSpanContextValid,
  SpanStatusCode,
  trace,
  TraceFlags,
  type SpanContext,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import pino, { type Logger } from "pino";

const REDACTED_PATHS = [
  "req.headers.authorization",
  "request.headers.authorization",
  "accessToken",
  "refreshToken",
  "password",
  "email",
  "*.email",
  "targetRoles",
  "locations",
  "*.targetRoles",
  "*.locations",
  "resume",
  "*.resume",
];

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;
const tracer = trace.getTracer("@ai-job-apply/observability");
let telemetrySdk: NodeSDK | undefined;

export interface TelemetryOptions {
  service: string;
  endpoint?: string;
  environment: string;
  releaseSha?: string;
  sampleRatio?: number;
}

function traceEndpoint(endpoint: string): string {
  return endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1/traces`;
}

export function initializeTelemetry(options: TelemetryOptions): boolean {
  if (!options.endpoint || telemetrySdk) {
    return Boolean(telemetrySdk);
  }

  const sampleRatio = options.sampleRatio ?? 1;
  if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) {
    throw new Error("OpenTelemetry sample ratio must be between 0 and 1");
  }

  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": options.service,
      "service.version": options.releaseSha ?? "local",
      "deployment.environment.name": options.environment,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(sampleRatio),
    }),
    traceExporter: new OTLPTraceExporter({
      url: traceEndpoint(options.endpoint),
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Header capture is intentionally disabled. Query-bearing requests are not traced because
        // this API has no query contract and arbitrary query values are not safe telemetry.
        headersToSpanAttributes: {},
        ignoreIncomingRequestHook: (request) => Boolean(request.url?.includes("?")),
        ignoreOutgoingRequestHook: (request) =>
          Boolean(typeof request.path === "string" && request.path.includes("?")),
      }),
    ],
  });
  telemetrySdk.start();
  return true;
}

export async function shutdownTelemetry(): Promise<void> {
  const sdk = telemetrySdk;
  telemetrySdk = undefined;
  if (sdk) {
    await sdk.shutdown();
  }
}

export function parseTraceparent(value: string | undefined): SpanContext | undefined {
  if (!value) {
    return undefined;
  }
  const match = TRACEPARENT_PATTERN.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  const spanContext: SpanContext = {
    traceId: match[1],
    spanId: match[2],
    traceFlags: match[3] === "01" ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true,
  };
  return isSpanContextValid(spanContext) ? spanContext : undefined;
}

export function activeTraceparent(activeContext: Context = context.active()): string | undefined {
  const spanContext = trace.getSpanContext(activeContext);
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return undefined;
  }
  const flags = (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED ? "01" : "00";
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

export async function withTraceSpan<T>(
  name: string,
  parentTraceparent: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const parent = parseTraceparent(parentTraceparent);
  const parentContext = parent ? trace.setSpanContext(context.active(), parent) : context.active();

  return tracer.startActiveSpan(name, {}, parentContext, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function createLogger(options: {
  service: string;
  level?: string;
  releaseSha?: string;
}): Logger {
  return pino({
    name: options.service,
    level: options.level ?? "info",
    base: {
      service: options.service,
      release_sha: options.releaseSha ?? "local",
    },
    redact: {
      paths: REDACTED_PATHS,
      censor: "[REDACTED]",
    },
  });
}

export function correlationId(headerValue: string | undefined): string {
  if (headerValue && /^[a-zA-Z0-9._-]{8,128}$/.test(headerValue)) {
    return headerValue;
  }
  return randomUUID();
}
