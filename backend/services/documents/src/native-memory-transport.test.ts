import { expect, it, vi } from "vitest";
import {
  createNativeMemoryTransport,
  type NativeMemoryTransportOptions,
} from "./native-memory-transport.js";

it("refuses default-off native transport before listener, auth, memory or owner access", () => {
  const authorize = vi.fn();
  expect(() =>
    createNativeMemoryTransport({ authorize } as unknown as NativeMemoryTransportOptions),
  ).toThrow("NativeMemoryTransportUnavailable");
  expect(authorize).not.toHaveBeenCalled();
});

it.skipIf(process.platform === "linux")(
  "refuses enabled transport outside the dedicated Linux runtime",
  () => {
    const authorize = vi.fn();
    expect(() =>
      createNativeMemoryTransport({
        enabled: () => true,
        authorize,
      } as unknown as NativeMemoryTransportOptions),
    ).toThrow("NativeMemoryTransportUnavailable");
    expect(authorize).not.toHaveBeenCalled();
  },
);
