import type { CanonicalJobSummary } from "@ai-job-apply/api-contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearLastJobSearch,
  type LastJobSearch,
  readLastJobSearch,
  saveLastJobSearch,
} from "./last-job-search";

const job = (id: string) =>
  ({
    id,
    title: `Engineer ${id}`,
    company: { id: "c1", name: "Synthetic Company" },
    locations: ["Remote - US"],
    lastVerifiedAt: "2026-11-10T12:00:00.000Z",
  }) as unknown as CanonicalJobSummary;

const search = (overrides: Partial<LastJobSearch> = {}): LastJobSearch => ({
  fields: {
    query: "engineer",
    title: "",
    company: "",
    location: "",
    verifiedWithinDays: "7",
    sort: "freshness",
  },
  items: [job("1"), job("2")],
  cursor: "next-page",
  ...overrides,
});

afterEach(() => clearLastJobSearch());

describe("the last job search", () => {
  it("is held and read back exactly", () => {
    saveLastJobSearch(search());
    expect(readLastJobSearch()).toEqual(search());
  });

  it("holds a search with no further page", () => {
    const { cursor: _cursor, ...rest } = search();
    saveLastJobSearch(rest);
    expect(readLastJobSearch()).toEqual(rest);
    expect(readLastJobSearch()).not.toHaveProperty("cursor");
  });

  it("holds one search: a new one replaces the old", () => {
    saveLastJobSearch(search());
    const { cursor: _cursor, ...rest } = search();
    saveLastJobSearch({ ...rest, items: [job("3")] });
    expect(readLastJobSearch()?.items.map((entry) => entry.id)).toEqual(["3"]);
  });

  it("is gone once cleared, and there is nothing to read before any search", () => {
    expect(readLastJobSearch()).toBeUndefined();
    saveLastJobSearch(search());
    clearLastJobSearch();
    expect(readLastJobSearch()).toBeUndefined();
  });

  it("hands out copies, so a reader cannot change what is held", () => {
    saveLastJobSearch(search());
    const read = readLastJobSearch();
    read?.items.pop();
    if (read) read.fields.query = "changed";
    expect(readLastJobSearch()).toEqual(search());
  });

  it("writes nothing to browser storage", () => {
    const writes: string[] = [];
    const storage = {
      get length() {
        return 0;
      },
      setItem: (key: string) => writes.push(key),
    };
    const original = { local: globalThis.localStorage, session: globalThis.sessionStorage };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
    try {
      saveLastJobSearch(search());
      readLastJobSearch();
      clearLastJobSearch();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original.local,
        configurable: true,
      });
      Object.defineProperty(globalThis, "sessionStorage", {
        value: original.session,
        configurable: true,
      });
    }
    expect(writes).toEqual([]);
  });
});
