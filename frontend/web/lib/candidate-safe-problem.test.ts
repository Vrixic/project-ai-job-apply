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

describe("resume refusals (ADR-032)", () => {
  const problem = (status: number, code: string) =>
    new Response(
      JSON.stringify({ code, title: "upstream text must never show", detail: "secret" }),
      {
        status,
        headers: { "content-type": "application/problem+json" },
      },
    );

  it("gives an unfinished upload, the plan limit, and unavailable plan details their own fixed copy", async () => {
    await expect(
      candidateSafeProblemMessage(problem(409, "resume_upload_in_progress"), "resume"),
    ).resolves.toBe(
      "Your resume is still being processed. You can upload another when it finishes.",
    );
    await expect(
      candidateSafeProblemMessage(problem(409, "resume_document_limit"), "resume"),
    ).resolves.toBe("Your plan's stored resume limit has been reached.");
    await expect(
      candidateSafeProblemMessage(problem(503, "entitlement_unavailable"), "resume"),
    ).resolves.toBe("Your plan details are temporarily unavailable. Try uploading again shortly.");
  });

  it("gives a resume that is still processing its own fixed deletion copy (ADR-033)", async () => {
    await expect(
      candidateSafeProblemMessage(problem(409, "resume_not_deletable"), "resume"),
    ).resolves.toBe(
      "This resume is still being processed. You can delete it when processing finishes.",
    );
  });

  it("uses that copy only for the resume surface, never echoes upstream text, and keeps other conflicts generic", async () => {
    await expect(
      candidateSafeProblemMessage(problem(409, "resume_document_limit"), "profile_facts"),
    ).resolves.toBe("This profile fact changed. Refresh and review it again.");
    await expect(
      candidateSafeProblemMessage(problem(409, "idempotency_conflict"), "resume"),
    ).resolves.toBe("The resume request changed. Refresh and try again.");
    await expect(
      candidateSafeProblemMessage(problem(409, "something_else"), "resume"),
    ).resolves.toBe("The resume request changed. Refresh and try again.");
    for (const code of [
      "resume_upload_in_progress",
      "resume_document_limit",
      "entitlement_unavailable",
    ]) {
      const message = await candidateSafeProblemMessage(problem(409, code), "resume");
      expect(message).not.toMatch(/upstream|secret/);
    }
  });
});
