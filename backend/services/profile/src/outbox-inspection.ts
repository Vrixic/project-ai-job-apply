import { createHash } from "node:crypto";

export const MAX_INSPECTABLE_OUTBOX_EVENTS = 10_000;

export interface OutboxInspectionRow {
  id: string;
  createdAt: Date;
  attempts: number;
}

export interface OutboxInspection {
  version: 1;
  pendingCount: number;
  oldestCreatedAt: string | null;
  maximumAttempts: number | null;
  orderedEventIdSha256: string;
  eventIds?: string[];
}

export function buildOutboxInspection(
  rows: readonly OutboxInspectionRow[],
  includeEventIds: boolean,
): OutboxInspection {
  if (rows.length > MAX_INSPECTABLE_OUTBOX_EVENTS) {
    throw new Error("The pending outbox exceeds the bounded inspection limit");
  }

  const ordered = [...rows].sort((left, right) => {
    const timeDifference = left.createdAt.getTime() - right.createdAt.getTime();
    return timeDifference === 0 ? left.id.localeCompare(right.id) : timeDifference;
  });
  const eventIds = ordered.map((row) => row.id);
  const maximumAttempts = ordered.reduce<number | null>(
    (current, row) => (current === null ? row.attempts : Math.max(current, row.attempts)),
    null,
  );

  return {
    version: 1,
    pendingCount: ordered.length,
    oldestCreatedAt: ordered[0]?.createdAt.toISOString() ?? null,
    maximumAttempts,
    orderedEventIdSha256: createHash("sha256").update(eventIds.join("\n")).digest("hex"),
    ...(includeEventIds ? { eventIds } : {}),
  };
}
