import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

const owner = "019a4000-0000-7000-8000-000000000001";
const documentId = "019a4000-0000-7000-8000-000000000002";
const ref = {
  id: owner,
  documentId,
  purpose: "private_slots" as const,
  requestSha256: "a".repeat(64),
};
const consentExpiresAt = new Date("2026-10-02T12:00:00Z");

describe("private generation work control fails closed before database access", () => {
  it.each([
    "issue",
    "claim",
    "claimProviderDispatch",
    "settleProviderDispatch",
    "recordSettled",
    "revokeUnclaimed",
    "readDrainState",
  ] as const)("defaults off for %s", async (method) => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql);
    const result =
      method === "issue"
        ? store.issue({ ...ref, ownerUserId: owner, consentExpiresAt })
        : method === "claim"
          ? store.claim(ref)
          : method === "claimProviderDispatch"
            ? store.claimProviderDispatch({
                documentId,
                requestSha256: ref.requestSha256,
                consentExpiresAt,
              })
            : method === "settleProviderDispatch"
              ? store.settleProviderDispatch({ ...ref, purpose: "provider_dispatch" })
              : method === "recordSettled"
                ? store.recordSettled(ref)
                : method === "revokeUnclaimed"
                  ? store.revokeUnclaimed(owner, documentId)
                  : store.readDrainState(owner, documentId);
    await expect(result).rejects.toThrow("CoverLetterWorkUnavailable");
    expect(sql).not.toHaveBeenCalled();
  });
  it.each(["private_slots", "final_document"] as const)(
    "provider settlement cannot mutate %s authority",
    async (purpose) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
      await expect(store.settleProviderDispatch({ ...ref, purpose })).rejects.toThrow(
        /^CoverLetterWorkUnavailable$/u,
      );
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it.each(["document", "hash", "time"])(
    "rejects malformed provider admission %s before SQL",
    async (kind) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
      const input = { documentId, requestSha256: ref.requestSha256, consentExpiresAt };
      if (kind === "document") input.documentId = "synthetic-private-diagnostic";
      if (kind === "hash") input.requestSha256 = "synthetic-private-diagnostic";
      if (kind === "time") input.consentExpiresAt = new Date("invalid");
      await expect(store.claimProviderDispatch(input)).rejects.toThrow(
        /^CoverLetterWorkUnavailable$/u,
      );
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it.each(["owner", "document", "hash", "purpose", "time"])(
    "rejects malformed issue %s without SQL or input reflection",
    async (kind) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
      const input = { ...ref, ownerUserId: owner, consentExpiresAt };
      if (kind === "owner") input.ownerUserId = "synthetic-private-diagnostic";
      if (kind === "document") input.documentId = "synthetic-private-diagnostic";
      if (kind === "hash") input.requestSha256 = "synthetic-private-diagnostic";
      if (kind === "purpose")
        input.purpose = "synthetic-private-diagnostic" as typeof input.purpose;
      if (kind === "time") input.consentExpiresAt = new Date("invalid");
      await expect(store.issue(input)).rejects.toThrow(/^CoverLetterWorkUnavailable$/u);
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it.each(["claim", "recordSettled"] as const)(
    "rejects malformed %s identity before SQL",
    async (method) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
      await expect(store[method]({ ...ref, id: "invalid" })).rejects.toThrow(
        "CoverLetterWorkUnavailable",
      );
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it.each(["revokeUnclaimed", "readDrainState"] as const)(
    "rejects malformed %s owner before SQL",
    async (method) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
      await expect(store[method]("invalid", documentId)).rejects.toThrow(
        "CoverLetterWorkUnavailable",
      );
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it("never reflects owner database diagnostics", async () => {
    const sql = vi.fn(async () => {
      throw Error("synthetic-private-diagnostic");
    });
    const store = new PostgresCoverLetterWorkStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.readDrainState(owner, documentId)).rejects.toThrow(
      /^CoverLetterWorkUnavailable$/u,
    );
  });
});
