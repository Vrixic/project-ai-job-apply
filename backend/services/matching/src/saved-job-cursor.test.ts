import { describe, expect, it } from "vitest";
import {
  decodeSavedJobCursor,
  deriveSavedJobCursorKeys,
  encodeSavedJobCursor,
  InvalidSavedJobCursorError,
  SavedJobCollectionChangedError,
} from "./saved-job-cursor.js";

describe("saved-job cursors", () => {
  const owner = "019d04cf-1f80-7000-8000-000000000011";
  const otherOwner = "019d04cf-1f80-7000-8000-000000000012";
  const id = "019d04cf-1f80-7000-8000-000000000013";
  const savedAt = new Date("2026-08-15T12:00:00.000Z");
  const keys = deriveSavedJobCursorKeys("postgresql://synthetic.invalid/database");

  it("round trips one owner-bound stable position", () => {
    const cursor = encodeSavedJobCursor(owner, "3", "11", savedAt, id, keys);
    expect(decodeSavedJobCursor(cursor, owner, "3", "11", keys)).toEqual({ savedAt, id });
    expect(cursor).not.toContain(owner);
  });

  it("rejects cross-owner reuse, mutation, and stale revisions", () => {
    const cursor = encodeSavedJobCursor(owner, "3", "11", savedAt, id, keys);
    expect(() => decodeSavedJobCursor(cursor, otherOwner, "3", "11", keys)).toThrow(
      InvalidSavedJobCursorError,
    );
    expect(() => decodeSavedJobCursor(`${cursor.slice(0, -1)}x`, owner, "3", "11", keys)).toThrow(
      InvalidSavedJobCursorError,
    );
    expect(() => decodeSavedJobCursor(cursor, owner, "4", "11", keys)).toThrow(
      SavedJobCollectionChangedError,
    );
    expect(() => decodeSavedJobCursor(cursor, owner, "3", "12", keys)).toThrow(
      SavedJobCollectionChangedError,
    );
  });
});
