import { describe, expect, it, vi } from "vitest";
import {
  createNativeCoverLetterRuntime,
  type NativeCoverLetterRuntimeOptions,
} from "./native-cover-letter-runtime.js";

describe("dedicated native runtime admission", () => {
  it("defaults off before touching identity, content, kernel or control ports", async () => {
    const options = Object.defineProperty({}, "binding", {
      get: () => {
        throw Error("ContentTouched");
      },
    });
    await expect(
      createNativeCoverLetterRuntime(options as NativeCoverLetterRuntimeOptions),
    ).rejects.toThrow("NativeCoverLetterRuntimeUnavailable");
  });
  it.skipIf(process.platform === "linux")(
    "refuses non-Linux before owning admission or loading the kernel",
    async () => {
      const checkAdmission = vi.fn();
      const loadKernel = vi.fn();
      await expect(
        createNativeCoverLetterRuntime({
          enabled: () => true,
          checkAdmission,
          loadKernel,
        } as unknown as NativeCoverLetterRuntimeOptions),
      ).rejects.toThrow("NativeCoverLetterRuntimeUnavailable");
      expect(checkAdmission).not.toHaveBeenCalled();
      expect(loadKernel).not.toHaveBeenCalled();
    },
  );
});
