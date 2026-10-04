import { describe, expect, it, vi } from "vitest";
import { createCoverLetterSuccessfulResponseReconciler } from "./cover-letter-response-reconciliation.js";
import type { CoverLetterResponseInventory } from "./cover-letter-response-store.js";

const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const response = {
  schemaVersion: 1 as const,
  responseId: "resp_syntheticCompleted",
  createdAt: 1790000000,
};
const receipt = {
  kind: "response_deleted" as const,
  reference: response,
  terminalStatus: "completed" as const,
};
const signal = () => new AbortController().signal;
function fixture() {
  const order: string[] = [];
  let row: CoverLetterResponseInventory | null = { reference, state: "acknowledged", response };
  let enabled = true;
  const responses = {
    readCompleted: vi.fn(async () => {
      order.push("eligible_read");
      return structuredClone(row);
    }),
    recordDisposal: vi.fn(async () => {
      order.push("record");
      row = { reference, state: "disposed", response };
    }),
  };
  const cleanup = {
    deleteCompleted: vi.fn(async () => {
      order.push("provider");
      return receipt;
    }),
  };
  const options = { responses, cleanup, enabled: () => enabled };
  return {
    options,
    responses,
    cleanup,
    order,
    reconcile: createCoverLetterSuccessfulResponseReconciler(options),
    setRow: (value: CoverLetterResponseInventory | null) => {
      row = value;
    },
    disable: () => {
      enabled = false;
    },
  };
}

describe("successful-generation response reconciliation without work/cancel/purge authority", () => {
  it("requires owned eligibility, completed deletion and durable convergence; replay skips provider", async () => {
    const f = fixture();
    expect(await f.reconcile(reference, signal())).toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(f.order).toEqual(["eligible_read", "provider", "record", "eligible_read"]);
    expect(f.cleanup.deleteCompleted).toHaveBeenCalledExactlyOnceWith(
      response,
      expect.any(AbortSignal),
    );
    expect(f.responses.recordDisposal).toHaveBeenCalledExactlyOnceWith(reference, receipt);
    expect(await f.reconcile(reference, signal())).toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(f.cleanup.deleteCompleted).toHaveBeenCalledTimes(1);
    expect(f.responses.recordDisposal).toHaveBeenCalledTimes(1);
  });
  it("defaults off before all I/O", async () => {
    const f = fixture();
    const { enabled: _, ...options } = f.options;
    expect(
      await createCoverLetterSuccessfulResponseReconciler(options)(reference, signal()),
    ).toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it("refuses already aborted work before all I/O", async () => {
    const f = fixture();
    expect(await f.reconcile(reference, AbortSignal.abort())).toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it.each([
    null,
    [],
    { ...reference, userId: reference.id },
    { ...reference, purpose: "final_document" },
  ])("rejects invalid reference %#", async (raw) => {
    const f = fixture();
    expect(await f.reconcile(raw, signal())).toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it.each([
    null,
    { reference, state: "reserved" as const, response: null },
    {
      reference: { ...reference, id: "019a4000-0000-7000-8000-000000000009" },
      state: "acknowledged" as const,
      response,
    },
  ])("rejects absent/unknown/changed eligibility %#", async (row) => {
    const f = fixture();
    f.setRow(row);
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(f.cleanup.deleteCompleted).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "failed", "incomplete", "queued"])(
    "refuses %s receipt without recording disposal",
    async (terminalStatus) => {
      const f = fixture();
      f.cleanup.deleteCompleted.mockResolvedValue({ ...receipt, terminalStatus } as typeof receipt);
      expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
      expect(f.responses.recordDisposal).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...receipt, reference: { ...response, responseId: "resp_other" } },
    { ...receipt, reference: { ...response, createdAt: 1 } },
    { ...receipt, content: "synthetic" },
  ])("refuses changed/content-bearing receipt %#", async (value) => {
    const f = fixture();
    f.cleanup.deleteCompleted.mockResolvedValue(value);
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("rejects receipt accessors without execution", async () => {
    const f = fixture();
    const getter = vi.fn(() => response);
    const value = { ...receipt };
    Object.defineProperty(value, "reference", { enumerable: true, get: getter });
    f.cleanup.deleteCompleted.mockResolvedValue(value);
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("recovers committed-but-lost SQL ACK from eligible durable state, without repeating DELETE", async () => {
    const f = fixture();
    f.responses.recordDisposal.mockImplementationOnce(async () => {
      f.setRow({ reference, state: "disposed", response });
      throw Error("SyntheticLostSqlAck");
    });
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(await f.reconcile(reference, signal())).toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(f.cleanup.deleteCompleted).toHaveBeenCalledTimes(1);
  });
  it("never infers durable convergence from local write ACK", async () => {
    const f = fixture();
    f.responses.recordDisposal.mockResolvedValue(undefined);
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
  });
  it("refuses eligibility withdrawn during the read", async () => {
    const f = fixture();
    f.responses.readCompleted.mockImplementationOnce(async () => {
      f.disable();
      return { reference, state: "acknowledged", response };
    });
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(f.cleanup.deleteCompleted).not.toHaveBeenCalled();
  });
  it("refuses activation withdrawn during provider disposal before SQL receipt write", async () => {
    const f = fixture();
    f.cleanup.deleteCompleted.mockImplementationOnce(async () => {
      f.disable();
      return receipt;
    });
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("bounds stalled eligibility without provider effects", async () => {
    const f = fixture();
    f.responses.readCompleted.mockImplementationOnce(() => new Promise(() => undefined));
    expect(
      await createCoverLetterSuccessfulResponseReconciler({ ...f.options, timeoutMs: 10 })(
        reference,
        signal(),
      ),
    ).toEqual({ kind: "unresolved" });
    expect(f.cleanup.deleteCompleted).not.toHaveBeenCalled();
  });
  it("does not accept late completed deletion after local deadline", async () => {
    const f = fixture();
    let finish: (value: typeof receipt) => void = () => undefined;
    f.cleanup.deleteCompleted.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(
      await createCoverLetterSuccessfulResponseReconciler({ ...f.options, timeoutMs: 10 })(
        reference,
        signal(),
      ),
    ).toEqual({ kind: "unresolved" });
    finish(receipt);
    await Promise.resolve();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
});
