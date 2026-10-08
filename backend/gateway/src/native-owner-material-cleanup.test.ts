import { expect, it, vi } from "vitest";
import { createNativeOwnerMaterialCleanup } from "./native-owner-material-cleanup.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
function setup() {
  const withdrawals = {
    withdraw: vi.fn(async () => ({
      requestId: id(2),
      requestedAtMs: 1000,
      cutoffEpochMicros: "1791460000000000",
    })),
  };
  const inventory = {
    pendingOwnerApplications: vi
      .fn()
      .mockResolvedValueOnce([id(3), id(4)])
      .mockResolvedValue([]),
  };
  const disposal = { discardApplicationThrough: vi.fn(async () => "discarded" as const) };
  const options = { withdrawals, inventory, disposal, enabled: () => true };
  return { ...options, create: () => createNativeOwnerMaterialCleanup(options) };
}
it("withdraws first, processes a bounded batch and checks durable inventory before acknowledging", async () => {
  const f = setup();
  expect(await f.create().step(id(1), id(2))).toMatchObject({ state: "native_tasks_settled" });
  expect(f.withdrawals.withdraw.mock.invocationCallOrder[0]).toBeLessThan(
    f.inventory.pendingOwnerApplications.mock.invocationCallOrder[0] ?? 0,
  );
  expect(f.disposal.discardApplicationThrough.mock.calls).toEqual([
    [id(1), id(3), "1791460000000000"],
    [id(1), id(4), "1791460000000000"],
  ]);
  expect(f.inventory.pendingOwnerApplications.mock.calls).toEqual([
    [id(1), "1791460000000000", 5, null],
    [id(1), "1791460000000000", 1],
  ]);
});
it("keeps unknown task retirement pending and continues other applications", async () => {
  const f = setup();
  f.disposal.discardApplicationThrough.mockRejectedValueOnce(Error("unknown original task"));
  f.inventory.pendingOwnerApplications.mockResolvedValue([id(3)]);
  expect(await f.create().step(id(1), id(2))).toMatchObject({ state: "pending" });
  expect(f.disposal.discardApplicationThrough).toHaveBeenCalledTimes(2);
});
it("refuses disabled cleanup before withdrawals or task effects", async () => {
  const f = setup();
  await expect(
    createNativeOwnerMaterialCleanup({
      withdrawals: f.withdrawals,
      inventory: f.inventory,
      disposal: f.disposal,
    }).step(id(1), id(2)),
  ).rejects.toThrow("NativeOwnerMaterialCleanupUnavailable");
  expect(f.withdrawals.withdraw).not.toHaveBeenCalled();
});
it("returns a cursor so unresolved applications cannot starve later pages", async () => {
  const f = setup();
  const page = Array.from({ length: 5 }, (_, index) => id(index + 10));
  f.inventory.pendingOwnerApplications
    .mockReset()
    .mockResolvedValueOnce(page)
    .mockResolvedValue([id(3)]);
  f.disposal.discardApplicationThrough.mockRejectedValue(Error("original recovery pending"));
  expect(await f.create().step(id(1), id(2), id(9))).toMatchObject({
    state: "pending",
    nextApplicationId: id(14),
  });
  expect(f.inventory.pendingOwnerApplications).toHaveBeenNthCalledWith(
    1,
    id(1),
    "1791460000000000",
    5,
    id(9),
  );
});
it("rejects a mismatched receipt and oversized inventory without task effects", async () => {
  const f = setup();
  f.withdrawals.withdraw.mockResolvedValueOnce({
    requestId: id(9),
    requestedAtMs: 1000,
    cutoffEpochMicros: "1791460000000000",
  });
  await expect(f.create().step(id(1), id(2))).rejects.toThrow();
  f.inventory.pendingOwnerApplications
    .mockReset()
    .mockResolvedValue(Array.from({ length: 6 }, (_, i) => id(i + 3)));
  await expect(f.create().step(id(1), id(2))).rejects.toThrow();
  expect(f.disposal.discardApplicationThrough).not.toHaveBeenCalled();
});
