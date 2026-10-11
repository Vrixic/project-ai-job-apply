import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { type DatabaseHandle, PostgresProfileStore } from "./index.js";

describe("reviewed resume fact response", () => {
  it.each([null, 1])(
    "preserves evidence with database page %s in a valid response and replay record",
    async (page) => {
      const factId = "019a4000-0000-7000-8000-000000000001";
      const span = {
        documentId: "019a4000-0000-7000-8000-000000000002",
        documentVersion: 1,
        parserVersion: "resume-parser-v1",
        blockIndex: 2,
        startOffset: 0,
        endOffset: 20,
        page,
      };
      let replayResponse: unknown;
      const transaction = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("SELECT id FROM profile.profile_facts")) return [{ id: factId }];
        if (sql.includes("NULL::jsonb AS evidence")) {
          return [
            {
              id: factId,
              kind: "identity",
              key: "email",
              value: "synthetic@example.test",
              verification: "proposed",
              availabilityState: "available",
              availabilityReason: null,
              sensitivity: "confidential",
              sourceType: "resume",
              sourceReference: "synthetic",
              effectiveFrom: null,
              effectiveTo: null,
              version: 1,
              createdAt: "2026-10-11T12:00:00Z",
              updatedAt: "2026-10-11T12:00:00Z",
              evidence: null,
            },
          ];
        }
        if (sql.includes('SELECT document_id AS "documentId"')) return [span];
        if (sql.includes("INSERT INTO platform.idempotency_keys")) {
          replayResponse = JSON.parse(values[4] as string);
        }
        return [];
      };
      const handle = {
        client: {
          begin: (callback: (sql: typeof transaction) => unknown) => callback(transaction),
        },
      } as unknown as DatabaseHandle;
      const response = await new PostgresProfileStore(handle).updateProfileFact(
        "synthetic-owner",
        factId,
        { expectedVersion: 1, verification: "confirmed" },
        "synthetic-review-key",
        "synthetic-trace",
      );
      expect(response?.verification).toBe("confirmed");
      expect(response?.evidence?.supportingSpans).toEqual([
        page === null ? (({ page: _page, ...rest }) => rest)(span) : span,
      ]);
      expect(compileComponentValidator("ProfileFact")(response)).toBe(true);
      expect(replayResponse).toEqual(response);
    },
  );
});
