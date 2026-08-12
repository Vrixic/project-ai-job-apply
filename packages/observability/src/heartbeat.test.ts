import { afterEach, describe, expect, it, vi } from "vitest";
import { LOG_DELIVERY_HEARTBEAT_EVENT, startLogDeliveryHeartbeat } from "./index.js";

describe("log delivery heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits only the fixed event immediately and on the configured interval", () => {
    vi.useFakeTimers();
    const info = vi.fn();

    const stop = startLogDeliveryHeartbeat({ info }, 1_000);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenLastCalledWith(
      { event: LOG_DELIVERY_HEARTBEAT_EVENT },
      "privacy-safe log delivery heartbeat",
    );

    vi.advanceTimersByTime(2_000);
    expect(info).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(2_000);
    expect(info).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid interval: %s",
    (intervalMs) => {
      expect(() => startLogDeliveryHeartbeat({ info: vi.fn() }, intervalMs)).toThrow(
        "Log delivery heartbeat interval must be positive",
      );
    },
  );
});
