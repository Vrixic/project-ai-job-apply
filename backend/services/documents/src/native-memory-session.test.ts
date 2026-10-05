import { describe, expect, it, vi } from "vitest";
import {
  createNativeMemorySession,
  type NativeMemorySessionOptions,
} from "./native-memory-session.js";

describe("native material process admission", () => {
  it("defaults off before kernel/evidence/control access", () => {
    const shortenBoot = vi.fn();
    const options = { kernel: { shortenBoot } } as unknown as NativeMemorySessionOptions;
    expect(() => createNativeMemorySession(options)).toThrow("NativeMemorySessionUnavailable");
    expect(shortenBoot).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "linux")(
    "rejects an enabled session outside Linux before kernel access",
    () => {
      const shortenBoot = vi.fn();
      const options = {
        enabled: () => true,
        kernel: { shortenBoot },
      } as unknown as NativeMemorySessionOptions;
      expect(() => createNativeMemorySession(options)).toThrow("NativeMemorySessionUnavailable");
      expect(shortenBoot).not.toHaveBeenCalled();
    },
  );
});
