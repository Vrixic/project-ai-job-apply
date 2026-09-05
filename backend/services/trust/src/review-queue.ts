export type TrustReviewQueueState = "needs_review" | "appeal_pending";
export interface TrustReviewQueueInput {
  state: TrustReviewQueueState;
  pageSize: number;
  after?: { updatedAt: string; id: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

// Cursor only selects a continuation inside the authorized queue; it never carries authority.
export function trustReviewQueueCursor(
  input: TrustReviewQueueInput,
  after: { updatedAt: Date; id: string },
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      state: input.state,
      pageSize: input.pageSize,
      at: after.updatedAt.toISOString(),
      id: after.id,
    }),
  ).toString("base64url");
}

export function parseTrustReviewQueue(input: {
  state?: string;
  pageSize?: number;
  cursor?: string;
}): TrustReviewQueueInput {
  const state = input.state ?? "needs_review";
  const pageSize = input.pageSize ?? 25;
  if (
    !["needs_review", "appeal_pending"].includes(state) ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 25
  )
    throw new Error("Invalid review queue request");
  const result: TrustReviewQueueInput = { state: state as TrustReviewQueueState, pageSize };
  if (input.cursor === undefined) return result;
  if (!/^[A-Za-z0-9_-]{1,400}$/u.test(input.cursor)) throw new Error("Invalid review queue cursor");
  const encoded = Buffer.from(input.cursor, "base64url");
  if (encoded.toString("base64url") !== input.cursor)
    throw new Error("Invalid review queue cursor");
  const cursor: unknown = JSON.parse(encoded.toString("utf8"));
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
    throw new Error("Invalid review queue cursor");
  const value = cursor as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "at,id,pageSize,state,v" ||
    value.v !== 1 ||
    value.state !== state ||
    value.pageSize !== pageSize ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    new Date(value.at).toISOString() !== value.at
  )
    throw new Error("Invalid review queue cursor");
  result.after = { updatedAt: value.at, id: value.id };
  return result;
}
