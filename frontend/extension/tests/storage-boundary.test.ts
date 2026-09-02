import { describe, expect, it, vi } from "vitest";
import { restrictExtensionStorageToTrustedContexts } from "../lib/storage-boundary";

describe("extension storage boundary", () => {
  it("makes token, capture, policy, and pending storage unavailable to content scripts", async () => {
    const local = { setAccessLevel: vi.fn(async () => undefined) };
    const session = { setAccessLevel: vi.fn(async () => undefined) };

    await restrictExtensionStorageToTrustedContexts({ local, session });

    expect(local.setAccessLevel).toHaveBeenCalledOnce();
    expect(session.setAccessLevel).toHaveBeenCalledOnce();
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("fails startup closed when either storage boundary cannot be established", async () => {
    await expect(
      restrictExtensionStorageToTrustedContexts({
        local: { setAccessLevel: vi.fn(async () => Promise.reject(new Error("unavailable"))) },
        session: { setAccessLevel: vi.fn(async () => undefined) },
      }),
    ).rejects.toThrow("unavailable");
  });
});
