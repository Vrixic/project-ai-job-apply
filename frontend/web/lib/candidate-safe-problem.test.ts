import { describe, expect, it } from "vitest";
import {
  type CandidateProblemSurface,
  candidateSafeProblemMessage,
} from "./candidate-safe-problem";

const privateCanary = "synthetic-private-upstream-detail-never-render";

function problem(status: number, code: string): Response {
  return Response.json(
    {
      type: `urn:private:${privateCanary}`,
      title: `Private title ${privateCanary}`,
      detail: `Private detail ${privateCanary}`,
      traceId: privateCanary,
      code,
    },
    { status },
  );
}

describe("candidateSafeProblemMessage", () => {
  it.each([
    [401, "authentication_required", "preferences", "Sign in again to continue."],
    [503, "session_expired", "resume", "Sign in again to continue."],
    [403, "forbidden", "profile_facts", "Your session is not allowed"],
    [400, "invalid_request", "preferences", "Check your job preferences"],
    [413, "payload_too_large", "resume", "Check the resume request"],
    [409, "version_conflict", "profile_facts", "This profile fact changed"],
    [404, "not_found", "operation", "saved check is no longer available"],
    [503, "private_database_failure", "profile_facts", "temporarily unavailable"],
  ] as const)(
    "maps %i %s on %s to fixed candidate-safe copy",
    async (status, code, surface, expected) => {
      const message = await candidateSafeProblemMessage(
        problem(status, code),
        surface as CandidateProblemSurface,
      );

      expect(message).toContain(expected);
      expect(message).not.toContain(privateCanary);
      expect(message).not.toContain(code);
    },
  );

  it.each([
    ["preferences", "Job preferences are temporarily unavailable."],
    ["operation", "The saved check is temporarily unavailable."],
    ["profile_facts", "Profile facts are temporarily unavailable."],
    ["resume", "Resume processing is temporarily unavailable."],
  ] as const)(
    "uses a fixed %s fallback for unknown, malformed, or empty bodies",
    async (surface, expected) => {
      const unknown = await candidateSafeProblemMessage(problem(503, privateCanary), surface);
      const malformed = await candidateSafeProblemMessage(
        new Response(`not-json-${privateCanary}`, { status: 502 }),
        surface,
      );
      const empty = await candidateSafeProblemMessage(new Response(null, { status: 500 }), surface);

      expect([unknown, malformed, empty]).toEqual([expected, expected, expected]);
      expect([unknown, malformed, empty].join(" ")).not.toContain(privateCanary);
    },
  );
});
