import { ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { activeTraceparent, parseTraceparent, withTraceSpan } from "./index.js";

const VALID_TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("trace context", () => {
  it("accepts a valid W3C traceparent", () => {
    expect(parseTraceparent(VALID_TRACEPARENT)).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  });

  it.each([
    undefined,
    "",
    "correlation-id",
    "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  ])("rejects an invalid or unsupported traceparent: %s", (value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });

  it("serializes only valid active span context", () => {
    const activeContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
    });

    expect(activeTraceparent(activeContext)).toBe(VALID_TRACEPARENT);
    expect(activeTraceparent(ROOT_CONTEXT)).toBeUndefined();
  });

  it("runs work even when no telemetry provider is configured", async () => {
    await expect(
      withTraceSpan("test.operation", VALID_TRACEPARENT, async () => "done"),
    ).resolves.toBe("done");
  });
});
