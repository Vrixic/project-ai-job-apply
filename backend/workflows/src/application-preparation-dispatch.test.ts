import {
  type PreparationDispatch,
  PreparationDispatchError,
  preparationExecutionName,
} from "@ai-job-apply/applications-service";
import { describe, expect, it, vi } from "vitest";
import {
  createPreparationStarter,
  PreparationDispatchPendingError,
  type PreparationStarterStore,
} from "./application-preparation-dispatch.js";

const eventId = "019d04cf-1f80-7000-8000-00000000000a";
const preparationId = "019d04cf-1f80-7000-8000-00000000000b";
const functionArn = "arn:aws:lambda:us-east-2:123456789012:function:preparation:7";
const executionName = preparationExecutionName(eventId);
const executionArn = `${functionArn}/durable-execution/${executionName}/synthetic-id`;
const input = {
  schemaVersion: 1,
  eventId,
  eventType: "application.packet-preparation.requested.v1",
  data: { preparationId },
};
const dispatch: PreparationDispatch = {
  eventId,
  preparationId,
  functionArn,
  executionName,
  boundAt: new Date("2026-10-02T12:00:00Z"),
  leaseId: "019d04cf-1f80-7000-8000-00000000000c",
  leaseExpiresAt: new Date("2026-10-02T12:01:00Z"),
  executionArn: null,
  startedAt: null,
  terminalStatus: null,
};
function fixture() {
  const store = {
    claimPreparationDispatch: vi.fn<PreparationStarterStore["claimPreparationDispatch"]>(),
    markPreparationStarted: vi.fn<PreparationStarterStore["markPreparationStarted"]>(),
  };
  store.claimPreparationDispatch.mockResolvedValue({ kind: "claimed", dispatch });
  store.markPreparationStarted.mockResolvedValue(true);
  const execution = { start: vi.fn().mockResolvedValue({ executionArn }) };
  const start = createPreparationStarter(functionArn.replace(":7", ":8"), store, execution);
  return { store, execution, start };
}

describe("owned preparation starter", () => {
  it("pins the stored numeric version and snapshots a canonical identifier-only payload", async () => {
    const { store, execution, start } = fixture();
    const value = {
      ...input,
      eventId: eventId.toUpperCase(),
      data: { preparationId: preparationId.toUpperCase() },
    };
    const pending = start(value);
    value.data.preparationId = eventId;
    await pending;
    expect(store.claimPreparationDispatch).toHaveBeenCalledWith(
      eventId,
      functionArn.replace(":7", ":8"),
      preparationId,
    );
    expect(execution.start).toHaveBeenCalledWith({ functionArn, executionName, payload: input });
    expect(store.markPreparationStarted).toHaveBeenCalledWith(
      eventId,
      dispatch.leaseId,
      executionArn,
    );
  });

  it("refuses malformed or value-bearing inputs before database/provider I/O", async () => {
    const { store, execution, start } = fixture();
    for (const value of [
      null,
      { ...input, prompt: "synthetic" },
      { ...input, data: { preparationId, owner: eventId } },
      { ...input, eventId: "invalid" },
    ])
      await expect(start(value)).rejects.toThrow(PreparationDispatchError);
    expect(store.claimPreparationDispatch).not.toHaveBeenCalled();
    expect(execution.start).not.toHaveBeenCalled();
    expect(() =>
      createPreparationStarter(functionArn.replace(":7", ":latest"), store, execution),
    ).toThrow(PreparationDispatchError);
  });

  it.each(["missing", "terminal", "started"] as const)(
    "acknowledges %s without another Invoke",
    async (kind) => {
      const { store, execution, start } = fixture();
      store.claimPreparationDispatch.mockResolvedValue(
        kind === "started" ? { kind, dispatch: { ...dispatch, executionArn } } : { kind },
      );
      await start(input);
      expect(execution.start).not.toHaveBeenCalled();
      expect(store.markPreparationStarted).not.toHaveBeenCalled();
    },
  );

  it("keeps busy claims retryable without starting work", async () => {
    const { store, execution, start } = fixture();
    store.claimPreparationDispatch.mockResolvedValue({ kind: "busy" });
    await expect(start(input)).rejects.toThrow(PreparationDispatchPendingError);
    expect(execution.start).not.toHaveBeenCalled();
  });

  it("refuses mismatched authoritative identity or function before Invoke", async () => {
    const { store, execution, start } = fixture();
    for (const changed of [
      { preparationId: eventId },
      { eventId: preparationId },
      { executionName: "foreign" },
      { functionArn: functionArn.replace("preparation:", "foreign:") },
      { leaseId: null },
    ]) {
      store.claimPreparationDispatch.mockResolvedValue({
        kind: "claimed",
        dispatch: { ...dispatch, ...changed },
      });
      await expect(start(input)).rejects.toThrow(PreparationDispatchError);
    }
    expect(execution.start).not.toHaveBeenCalled();
  });

  it("does not acknowledge a foreign execution ARN", async () => {
    const { store, execution, start } = fixture();
    execution.start.mockResolvedValue({ executionArn: executionArn.replace(":7/", ":8/") });
    await expect(start(input)).rejects.toThrow(PreparationDispatchError);
    expect(store.markPreparationStarted).not.toHaveBeenCalled();
  });

  it("redacts ambiguous start/receipt failures and retries the same bound execution", async () => {
    const { store, execution, start } = fixture();
    execution.start.mockRejectedValueOnce(new Error("synthetic-private-provider-detail"));
    await expect(start(input)).rejects.toThrow("PreparationDispatchPending");
    expect(store.markPreparationStarted).not.toHaveBeenCalled();
    store.markPreparationStarted.mockResolvedValueOnce(false);
    await expect(start(input)).rejects.toThrow(PreparationDispatchPendingError);
    await start(input);
    expect(execution.start.mock.calls).toEqual(
      Array(3).fill([{ functionArn, executionName, payload: input }]),
    );
  });
});
