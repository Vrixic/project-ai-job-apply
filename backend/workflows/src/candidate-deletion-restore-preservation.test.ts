import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digestRestoredData,
  PRESERVATION_RELATIONS,
} from "./candidate-deletion-restore-preservation.js";

type Sql = Parameters<typeof digestRestoredData>[0];
function harness(change: (row: Record<string, unknown>) => void = () => undefined) {
  const calls: string[] = [];
  const cancel = vi.fn();
  const unsafe = vi.fn((query: string) => {
    calls.push(query);
    let value: Record<string, unknown>[];
    if (query.startsWith("SET LOCAL")) value = [];
    else if (query.includes("AS settings"))
      value = [
        {
          settings: [
            "UTC",
            "ISO, YMD",
            "iso_8601",
            "3",
            "hex",
            "off",
            "UTF8",
            "UTF8",
            16,
            "pg_catalog",
          ],
        },
      ];
    else if (query.includes("WITH tables AS"))
      value = [{ relations: [...PRESERVATION_RELATIONS].sort(), visible: true }];
    else {
      const row = {
        rows: "1",
        bytes: "40",
        largest: "40",
        sha: "a".repeat(64),
        schema: "b".repeat(64),
      };
      change(row);
      value = [row];
    }
    return Object.assign(Promise.resolve(value), { cancel });
  });
  return { sql: { unsafe } as unknown as Sql, unsafe, calls, cancel };
}
const budget = () => ({ deadline: Date.now() + 90_000, rowCount: 0, byteCount: 0 });

afterEach(() => vi.useRealTimers());
describe("bounded restored whole-row preservation", () => {
  it("binds the complete immutable current manifest, not a sampled inventory", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../services/database-migrations/restore-manifest.v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(PRESERVATION_RELATIONS).toEqual(
      manifest.contributors.flatMap((c: { relations: string[] }) => c.relations),
    );
    expect(new Set(PRESERVATION_RELATIONS).size).toBe(96);
    expect(Object.isFrozen(PRESERVATION_RELATIONS)).toBe(true);
  });
  it("returns only an aggregate and accounts shared work across passes", async () => {
    const h = harness();
    const b = budget();
    const first = await digestRestoredData(h.sql, [], b);
    expect(first).toMatchObject({ relationCount: 96, rowCount: 96, byteCount: 3840 });
    expect(Object.keys(first).sort()).toEqual(["byteCount", "relationCount", "rowCount", "sha256"]);
    const second = await digestRestoredData(h.sql, [], b);
    expect(second).toEqual(first);
    expect(b.rowCount).toBe(192);
    expect(b.byteCount).toBe(7680);
    expect(h.calls.filter((q) => q.startsWith("WITH row_hashes"))).toHaveLength(192);
  });
  it.each([
    { rows: "10001" },
    { bytes: "4194305" },
    { largest: "262145" },
    { rows: 1 },
    { bytes: "01" },
    { rows: "9007199254740992" },
    { sha: null },
    { schema: null },
    { sha: "invalid" },
    { extra: "forbidden" },
  ])("refuses malformed, hidden or partial aggregates %j", async (mutation) => {
    const h = harness((row) => Object.assign(row, mutation));
    await expect(digestRestoredData(h.sql, [], budget())).rejects.toThrow("PreservationRejected");
  });
  it.each(["rows", "bytes"])("enforces the shared global %s cap", async (kind) => {
    const h = harness();
    const b = budget();
    if (kind === "rows") b.rowCount = 100000;
    else b.byteCount = 67108864;
    await expect(digestRestoredData(h.sql, [], b)).rejects.toThrow("PreservationRejected");
    expect(h.calls.filter((q) => q.startsWith("WITH row_hashes"))).toHaveLength(1);
  });
  it("refuses expired work before starting SQL", async () => {
    const h = harness();
    await expect(
      digestRestoredData(h.sql, [], { ...budget(), deadline: Date.now() - 1 }),
    ).rejects.toThrow("PreservationRejected");
    expect(h.unsafe).not.toHaveBeenCalled();
  });
  it("cancels a hanging query and emits no partial evidence", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pending = Object.assign(new Promise<never>(() => undefined), { cancel });
    const sql = { unsafe: vi.fn(() => pending) } as unknown as Sql;
    const result = digestRestoredData(sql, [], budget());
    const rejected = expect(result).rejects.toThrow("PreservationRejected");
    await vi.advanceTimersByTimeAsync(15001);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels in-flight SQL on abort without returning partial evidence", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const sql = {
      unsafe: vi.fn(() => Object.assign(new Promise<never>(() => undefined), { cancel })),
    } as unknown as Sql;
    const result = digestRestoredData(sql, [], budget(), controller.signal);
    const rejected = expect(result).rejects.toThrow("PreservationRejected");
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not renew the shared deadline for a later pass", async () => {
    vi.useFakeTimers();
    const h = harness();
    const b = { ...budget(), deadline: Date.now() + 1000 };
    await digestRestoredData(h.sql, [], b);
    const calls = h.calls.length;
    await vi.advanceTimersByTimeAsync(1001);
    await expect(digestRestoredData(h.sql, [], b)).rejects.toThrow("PreservationRejected");
    expect(h.calls).toHaveLength(calls);
  });
  it("refuses a noncanonical serialization or hidden tables", async () => {
    for (const response of [
      { settings: ["UTC"] },
      { relations: [...PRESERVATION_RELATIONS], visible: false },
    ]) {
      const h = harness();
      h.unsafe.mockImplementationOnce(() =>
        Object.assign(Promise.resolve([]), { cancel: h.cancel }),
      );
      if ("settings" in response)
        h.unsafe.mockImplementationOnce(() =>
          Object.assign(Promise.resolve([response]), { cancel: h.cancel }),
        );
      else {
        h.unsafe.mockImplementationOnce(() =>
          Object.assign(
            Promise.resolve([
              {
                settings: [
                  "UTC",
                  "ISO, YMD",
                  "iso_8601",
                  "3",
                  "hex",
                  "off",
                  "UTF8",
                  "UTF8",
                  16,
                  "pg_catalog",
                ],
              },
            ]),
            { cancel: h.cancel },
          ),
        );
        h.unsafe.mockImplementationOnce(() =>
          Object.assign(Promise.resolve([response]), { cancel: h.cancel }),
        );
      }
      await expect(digestRestoredData(h.sql, [], budget())).rejects.toThrow("PreservationRejected");
    }
  });
});
