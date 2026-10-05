import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverLetterPersistence } from "./cover-letter-persistence.js";
import type { CoverLetterObjectStore } from "./cover-letter-store.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

const pools = vi.hoisted(() => ({
  created: [] as Array<{ sql: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }>,
  factory: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: pools.factory.mockImplementation(() => {
    const sql = vi.fn();
    const end = vi.fn(async () => undefined);
    pools.created.push({ sql, end });
    return Object.assign(sql, { end });
  }),
}));
afterEach(() => {
  pools.created.length = 0;
  vi.clearAllMocks();
});
const objects: CoverLetterObjectStore = { putIfAbsent: vi.fn(), read: vi.fn() };
describe("native Documents preparation persistence", () => {
  it("uses three distinct bounded pools with native codecs and no notices", () => {
    createCoverLetterPersistence("postgres://synthetic.invalid/preparation", objects);
    expect(pools.factory).toHaveBeenCalledTimes(3);
    expect(new Set(pools.created.map((p) => p.sql)).size).toBe(3);
    for (const [url, config] of pools.factory.mock.calls) {
      expect(url).toBe("postgres://synthetic.invalid/preparation");
      expect(config).toMatchObject({ max: 1, idle_timeout: 20, connect_timeout: 10 });
      expect(config.transform).toBeUndefined();
      expect(config.types).toBeUndefined();
      expect(config.onnotice()).toBeUndefined();
    }
    expect(pools.created.every((p) => p.sql.mock.calls.length === 0)).toBe(true);
  });
  it("gives the candidate lease only its frozen lease capability", () => {
    const persistence = createCoverLetterPersistence(
      "postgres://synthetic.invalid/preparation",
      objects,
    );
    expect(Object.keys(persistence.candidateLease)).toEqual(["withGenerationLease"]);
    expect(Object.isFrozen(persistence.candidateLease)).toBe(true);
  });
  it.each(["provider_dispatch", "private_slots"] as const)(
    "refuses final writer settling %s before SQL",
    async (purpose) => {
      const persistence = createCoverLetterPersistence(
        "postgres://synthetic.invalid/preparation",
        objects,
      );
      const finalWork = Reflect.get(persistence.documents, "work") as Pick<
        PostgresCoverLetterWorkStore,
        "recordSettled" | "claimFinalDocument"
      >;
      expect(Object.keys(finalWork)).toEqual(["claimFinalDocument", "recordSettled"]);
      expect(Object.isFrozen(finalWork)).toBe(true);
      await expect(
        finalWork.recordSettled({
          id: "01900000-0000-7000-8000-000000000001",
          documentId: "01900000-0000-7000-8000-000000000002",
          purpose,
          requestSha256: "a".repeat(64),
        }),
      ).rejects.toThrow("CoverLetterPersistenceUnavailable");
      expect(pools.created.every((p) => p.sql.mock.calls.length === 0)).toBe(true);
    },
  );
  it("closes every owned pool", async () => {
    const persistence = createCoverLetterPersistence(
      "postgres://synthetic.invalid/preparation",
      objects,
    );
    await persistence.close();
    for (const pool of pools.created) expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
