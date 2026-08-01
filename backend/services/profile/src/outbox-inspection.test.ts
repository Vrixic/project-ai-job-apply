import { describe, expect, it } from "vitest";
import { buildOutboxInspection, MAX_INSPECTABLE_OUTBOX_EVENTS } from "./outbox-inspection.js";

describe("outbox inspection", () => {
  it("creates a stable ordered digest without exposing event identifiers by default", () => {
    const result = buildOutboxInspection(
      [
        {
          id: "00000000-0000-7000-8000-000000000002",
          createdAt: new Date("2026-07-31T02:00:00Z"),
          attempts: 2,
        },
        {
          id: "00000000-0000-7000-8000-000000000001",
          createdAt: new Date("2026-07-31T01:00:00Z"),
          attempts: 0,
        },
      ],
      false,
    );

    expect(result).toEqual({
      version: 1,
      pendingCount: 2,
      oldestCreatedAt: "2026-07-31T01:00:00.000Z",
      maximumAttempts: 2,
      orderedEventIdSha256: "cf4264d484b55a19ca9f78ccb6a46929a13e71db0dace1fb491a731659b34ae6",
    });
    expect(result).not.toHaveProperty("eventIds");
  });

  it("includes only ordered immutable identifiers when explicitly requested", () => {
    const result = buildOutboxInspection(
      [
        { id: "event-b", createdAt: new Date("2026-07-31T01:00:00Z"), attempts: 1 },
        { id: "event-a", createdAt: new Date("2026-07-31T01:00:00Z"), attempts: 1 },
      ],
      true,
    );

    expect(result.eventIds).toEqual(["event-a", "event-b"]);
  });

  it("fails closed when the inspection would exceed its memory bound", () => {
    const row = { id: "event", createdAt: new Date("2026-07-31T01:00:00Z"), attempts: 0 };
    const rows = Array.from({ length: MAX_INSPECTABLE_OUTBOX_EVENTS + 1 }, (_, index) => ({
      ...row,
      id: `${row.id}-${index}`,
    }));

    expect(() => buildOutboxInspection(rows, false)).toThrow(
      "The pending outbox exceeds the bounded inspection limit",
    );
  });
});
