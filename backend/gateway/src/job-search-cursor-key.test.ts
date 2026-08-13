import { describe, expect, it } from "vitest";
import { deriveJobSearchCursorKeys } from "./job-search-cursor-key.js";

describe("job-search cursor key derivation", () => {
  it("derives one stable domain-separated server-only key", () => {
    const url = "postgres://synthetic:secret-one@localhost:5432/catalog";
    const first = deriveJobSearchCursorKeys(url);
    const replay = deriveJobSearchCursorKeys(url);

    expect(first.active.id).toBe("db-url-v1");
    expect(first.active.key).toHaveLength(32);
    expect(Buffer.from(first.active.key).equals(Buffer.from(replay.active.key))).toBe(true);
    expect(JSON.stringify(first)).not.toContain(url);
  });

  it("invalidates cursors when the managed database credential rotates", () => {
    const before = deriveJobSearchCursorKeys(
      "postgres://synthetic:secret-one@localhost:5432/catalog",
    );
    const after = deriveJobSearchCursorKeys(
      "postgres://synthetic:secret-two@localhost:5432/catalog",
    );

    expect(Buffer.from(before.active.key).equals(Buffer.from(after.active.key))).toBe(false);
  });
});
