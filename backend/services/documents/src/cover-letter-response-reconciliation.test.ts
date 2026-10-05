import { OpenAiLunaResponseCleanup } from "@ai-job-apply/ai-sdk";
import { describe, expect, it, vi } from "vitest";
import { createCoverLetterResponseReconciler } from "./cover-letter-response-reconciliation.js";
import type { CoverLetterResponseInventory } from "./cover-letter-response-store.js";

const reference = {
  id: "019a4000-0000-7000-8000-000000000002",
  documentId: "019a4000-0000-7000-8000-000000000001",
  purpose: "provider_dispatch" as const,
  requestSha256: "a".repeat(64),
};
const response = {
  schemaVersion: 1 as const,
  responseId: "resp_syntheticOriginal",
  createdAt: 1_790_000_000,
};
const receipt = {
  kind: "response_deleted" as const,
  reference: response,
  terminalStatus: "cancelled" as const,
};
const signal = () => new AbortController().signal;
function fixture() {
  const order: string[] = [];
  let row: CoverLetterResponseInventory = { reference, state: "acknowledged", response };
  let enabled = true;
  const work = {
    fenceForCleanup: vi.fn(async () => {
      order.push("fence");
      return "pending" as "pending" | "ledger_terminal";
    }),
  };
  const responses = {
    readFailed: vi.fn(async (): Promise<CoverLetterResponseInventory | null> => {
      order.push("eligible");
      return structuredClone(row);
    }),
    read: vi.fn(async () => structuredClone(row)),
    recordDisposal: vi.fn(async () => {
      order.push("record");
      row = { reference, state: "disposed", response };
    }),
  };
  const cleanup = {
    stopAndDelete: vi.fn(async () => {
      order.push("provider");
      return receipt;
    }),
  };
  const options = { work, responses, cleanup, enabled: () => enabled };
  return {
    options,
    work,
    responses,
    cleanup,
    order,
    reconcile: createCoverLetterResponseReconciler(options),
    setRow: (value: CoverLetterResponseInventory) => {
      row = value;
    },
    disable: () => {
      enabled = false;
    },
  };
}
describe("source-only failed/abandoned response reconciliation", () => {
  it("refuses an old composition before ordinary inventory, fencing or provider effects", async () => {
    const f = fixture();
    const { readFailed: _, ...responses } = f.responses;
    expect(
      await createCoverLetterResponseReconciler({ ...f.options, responses })(reference, signal()),
    ).toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
    expect(f.responses.read).not.toHaveBeenCalled();
  });
  it.each([null, { reference, state: "reserved" as const, response: null }])(
    "refuses absent original failure proof %j before a permanent fence",
    async (row) => {
      const f = fixture();
      f.responses.readFailed.mockResolvedValue(row);
      expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
      expect(f.responses.readFailed).toHaveBeenCalledExactlyOnceWith(reference);
      expect(f.work.fenceForCleanup).not.toHaveBeenCalled();
      expect(f.responses.read).not.toHaveBeenCalled();
      expect(f.cleanup.stopAndDelete).not.toHaveBeenCalled();
    },
  );
  it("refuses eligibility lost during convergence without ordinary-read fallback", async () => {
    const f = fixture();
    f.responses.readFailed
      .mockImplementationOnce(async () => ({ reference, state: "acknowledged", response }))
      .mockImplementationOnce(async () => null);
    expect(await f.reconcile(reference, signal())).toEqual({ kind: "unresolved" });
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.cleanup.stopAndDelete).toHaveBeenCalledTimes(1);
  });
  it("refuses an already-aborted maintenance call before I/O", async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(f.reconcile(reference, abort.signal)).resolves.toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it("does not promote a disposal receipt when activation is withdrawn", async () => {
    const f = fixture();
    f.cleanup.stopAndDelete.mockImplementation(async () => {
      f.disable();
      return receipt;
    });
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("never executes an accessor-bearing disposal receipt", async () => {
    const f = fixture();
    const getter = vi.fn(() => response);
    const value = { kind: receipt.kind, terminalStatus: receipt.terminalStatus };
    Object.defineProperty(value, "reference", { enumerable: true, get: getter });
    f.cleanup.stopAndDelete.mockResolvedValue(value as typeof receipt);
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("orders permanent fence, original read, positive disposal and durable convergence", async () => {
    const f = fixture();
    await expect(f.reconcile(reference, signal())).resolves.toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(f.order).toEqual(["eligible", "fence", "provider", "record", "eligible"]);
    expect(f.cleanup.stopAndDelete).toHaveBeenCalledExactlyOnceWith(
      response,
      expect.any(AbortSignal),
    );
    expect(f.responses.recordDisposal).toHaveBeenCalledExactlyOnceWith(reference, receipt);
    await f.reconcile(reference, signal());
    expect(f.cleanup.stopAndDelete).toHaveBeenCalledTimes(1);
    expect(f.responses.recordDisposal).toHaveBeenCalledTimes(1);
  });
  it("defaults off before all I/O", async () => {
    const f = fixture();
    const { enabled: _, ...options } = f.options;
    await expect(
      createCoverLetterResponseReconciler(options)(reference, signal()),
    ).resolves.toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it.each([
    null,
    [],
    { ...reference, userId: reference.id },
    { ...reference, purpose: "finalize" },
  ])("refuses invalid original work %j", async (value) => {
    const f = fixture();
    await expect(f.reconcile(value, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.order).toEqual([]);
  });
  it("keeps unknown original identity unresolved without provider I/O", async () => {
    const f = fixture();
    f.setRow({ reference, state: "reserved", response: null });
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.order).toEqual(["eligible"]);
  });
  it("refuses a lost permanent fence ACK before response/provider access", async () => {
    const f = fixture();
    f.work.fenceForCleanup.mockRejectedValue(Error("SyntheticCommittedFenceLostACK"));
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.responses.readFailed).toHaveBeenCalledTimes(1);
    expect(f.cleanup.stopAndDelete).not.toHaveBeenCalled();
  });
  it("refuses activation withdrawn during the original fence", async () => {
    const f = fixture();
    f.work.fenceForCleanup.mockImplementation(async () => {
      f.disable();
      return "pending";
    });
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.responses.read).not.toHaveBeenCalled();
    expect(f.responses.readFailed).toHaveBeenCalledTimes(1);
  });
  it.each(["id", "documentId", "requestSha256"] as const)(
    "rejects changed inventory %s",
    async (key) => {
      const f = fixture();
      f.setRow({
        reference: {
          ...reference,
          [key]: key === "requestSha256" ? "b".repeat(64) : "019a4000-0000-7000-8000-000000000009",
        },
        state: "acknowledged",
        response,
      });
      await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
      expect(f.cleanup.stopAndDelete).not.toHaveBeenCalled();
    },
  );
  it.each([
    { kind: "unresolved" },
    { ...receipt, reference: { ...response, responseId: "resp_other" } },
    { ...receipt, reference: { ...response, createdAt: response.createdAt + 1 } },
    { ...receipt, terminalStatus: "queued" },
    { ...receipt, content: "synthetic" },
  ])("rejects nonpositive or changed disposal %j before SQL", async (value) => {
    const f = fixture();
    f.cleanup.stopAndDelete.mockResolvedValue(value as typeof receipt);
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    expect(f.responses.recordDisposal).not.toHaveBeenCalled();
  });
  it("recovers a committed-but-lost disposal ACK from durable inventory alone", async () => {
    const f = fixture();
    f.responses.recordDisposal.mockImplementationOnce(async () => {
      f.setRow({ reference, state: "disposed", response });
      throw Error("SyntheticCommittedDisposalLostACK");
    });
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
    await expect(f.reconcile(reference, signal())).resolves.toEqual({
      kind: "response_disposed",
      reference,
    });
    expect(f.cleanup.stopAndDelete).toHaveBeenCalledTimes(1);
  });
  it("requires durable convergence even after a local successful SQL acknowledgement", async () => {
    const f = fixture();
    f.responses.recordDisposal.mockResolvedValue(undefined);
    await expect(f.reconcile(reference, signal())).resolves.toEqual({ kind: "unresolved" });
  });
  it("bounds stalled private reads without calling the provider", async () => {
    const f = fixture();
    f.responses.readFailed.mockImplementation(() => new Promise(() => undefined));
    await expect(
      createCoverLetterResponseReconciler({ ...f.options, timeoutMs: 10 })(reference, signal()),
    ).resolves.toEqual({ kind: "unresolved" });
    expect(f.cleanup.stopAndDelete).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "actual cleanup adapter preserves lost/missing deletion ACK unresolved=%s",
    async (missing) => {
      const f = fixture();
      const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
        if (init?.method === "GET")
          return new Response(
            JSON.stringify({
              object: "response",
              id: response.responseId,
              created_at: response.createdAt,
              model: "gpt-6-luna",
              background: true,
              store: false,
              previous_response_id: null,
              tools: [],
              status: "completed",
            }),
          );
        if (missing) return new Response("", { status: 404 });
        throw Error("SyntheticLostDeleteACK");
      });
      const cleanup = new OpenAiLunaResponseCleanup({
        enabled: () => true,
        apiKey: () => "synthetic",
        fetch,
      });
      await expect(
        createCoverLetterResponseReconciler({ ...f.options, cleanup })(reference, signal()),
      ).resolves.toEqual({ kind: "unresolved" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(f.responses.recordDisposal).not.toHaveBeenCalled();
    },
  );
});
