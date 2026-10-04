import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";

const ref = {
  id: "019a4000-0000-7000-8000-000000000001",
  documentId: "019a4000-0000-7000-8000-000000000002",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const response = { schemaVersion: 1 as const, responseId: "resp_synthetic", createdAt: 1791056000 };
const cleanup = {
  kind: "response_deleted" as const,
  reference: response,
  terminalStatus: "cancelled" as const,
};

describe("private response inventory fails closed before database access", () => {
  it.each(["reserve", "recordCreation", "recordDisposal", "read"] as const)(
    "defaults off for %s",
    async (method) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql);
      const result =
        method === "reserve"
          ? store.reserve(ref)
          : method === "recordCreation"
            ? store.recordCreation(ref, response)
            : method === "recordDisposal"
              ? store.recordDisposal(ref, cleanup)
              : store.read(ref);
      await expect(result).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it.each(["private_slots", "final_document", "invalid"])("refuses %s purpose", async (purpose) => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.reserve({ ...ref, purpose } as typeof ref)).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    expect(sql).not.toHaveBeenCalled();
  });
  it.each(["id", "documentId", "requestSha256"] as const)(
    "refuses invalid %s without reflecting it",
    async (key) => {
      const sql = vi.fn();
      const store = new PostgresCoverLetterResponseStore(
        sql as unknown as postgres.Sql,
        () => true,
      );
      await expect(store.read({ ...ref, [key]: "synthetic-private-diagnostic" })).rejects.toThrow(
        /^CoverLetterResponseUnavailable$/u,
      );
      expect(sql).not.toHaveBeenCalled();
    },
  );
  it("never evaluates reference or disposal accessors", async () => {
    const sql = vi.fn();
    const accessor = vi.fn(() => ref.id);
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    const input = { ...ref };
    Object.defineProperty(input, "id", { get: accessor, enumerable: true });
    await expect(store.reserve(input)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    const receipt = { ...cleanup };
    Object.defineProperty(receipt, "kind", { get: accessor, enumerable: true });
    await expect(store.recordDisposal(ref, receipt)).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    expect(accessor).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { ...response, createdAt: NaN },
    { ...response, responseId: "not-a-response" },
    { ...response, text: "synthetic" },
  ])("refuses malformed creation ACK %#", async (input) => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.recordCreation(ref, input as typeof response)).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    expect(sql).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "unresolved" },
    { ...cleanup, terminalStatus: "queued" },
    { ...cleanup, text: "synthetic" },
    { ...cleanup, reference: { ...response, createdAt: 0 } },
  ])("refuses absent/malformed disposal ACK %#", async (input) => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.recordDisposal(ref, input as typeof cleanup)).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("successful response eligibility refuses before database access", () => {
  it("defaults off", async () => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql);
    await expect(store.readCompleted(ref)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    expect(sql).not.toHaveBeenCalled();
  });
  it.each(["id", "documentId", "requestSha256"] as const)("rejects malformed %s", async (key) => {
    const sql = vi.fn();
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.readCompleted({ ...ref, [key]: "synthetic invalid" })).rejects.toThrow(
      /^CoverLetterResponseUnavailable$/u,
    );
    expect(sql).not.toHaveBeenCalled();
  });
  it("refuses accessor-bearing identity", async () => {
    const sql = vi.fn();
    const getter = vi.fn(() => ref.id);
    const input = { ...ref };
    Object.defineProperty(input, "id", { get: getter, enumerable: true });
    const store = new PostgresCoverLetterResponseStore(sql as unknown as postgres.Sql, () => true);
    await expect(store.readCompleted(input)).rejects.toThrow(/^CoverLetterResponseUnavailable$/u);
    expect(getter).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });
});
