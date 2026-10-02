import {
  type PreparationDispatch,
  PreparationDispatchError,
} from "@ai-job-apply/applications-service";
import { describe, expect, it, vi } from "vitest";
import { PreparationDispatchPendingError } from "./application-preparation-dispatch.js";
import {
  createPreparationReconciler,
  createPreparationTerminalHandler,
  type PreparationRecoveryStore,
  type PreparationStatusReader,
} from "./application-preparation-recovery.js";

const eventId = "019d04cf-1f80-7000-8000-00000000000a";
const preparationId = "019d04cf-1f80-7000-8000-00000000000b";
const functionArn = "arn:aws:lambda:us-east-2:123456789012:function:preparation:7";
const currentArn = functionArn.replace(":7", ":8");
const executionName = `preparation-${eventId}`;
const executionArn = `${functionArn}/durable-execution/${executionName}/synthetic-id`;
const start = new Date("2026-10-02T12:00:00Z");
const end = new Date("2026-10-02T12:01:00Z");
const dispatch: PreparationDispatch = {
  eventId,
  preparationId,
  functionArn,
  executionName,
  executionArn,
  boundAt: start,
  startedAt: start,
  leaseId: null,
  leaseExpiresAt: null,
  terminalStatus: null,
};
const terminal = { status: "FAILED" as const, startTimestamp: start, endTimestamp: end };
function envelope() {
  return {
    version: "0",
    id: "019d04cf-1f80-7000-8000-00000000000c",
    "detail-type": "Durable Execution Status Change",
    source: "aws.lambda",
    account: "123456789012",
    region: "us-east-2",
    time: end.toISOString(),
    resources: [] as string[],
    detail: {
      durableExecutionArn: executionArn,
      durableExecutionName: executionName,
      functionArn,
      status: "FAILED",
      startTimestamp: start.toISOString(),
      endTimestamp: end.toISOString(),
    },
  };
}
function fixture() {
  const store = {
    claimPreparationNudges: vi
      .fn<PreparationRecoveryStore["claimPreparationNudges"]>()
      .mockResolvedValue([{ eventId, preparationId }]),
    claimPreparationExecutionsForReconciliation: vi
      .fn<PreparationRecoveryStore["claimPreparationExecutionsForReconciliation"]>()
      .mockResolvedValue([dispatch]),
    getPreparationDispatch: vi
      .fn<PreparationRecoveryStore["getPreparationDispatch"]>()
      .mockResolvedValue(dispatch),
    settlePreparationExecution: vi
      .fn<PreparationRecoveryStore["settlePreparationExecution"]>()
      .mockResolvedValue(true),
  };
  const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
  const status = { read: vi.fn<PreparationStatusReader["read"]>().mockResolvedValue(terminal) };
  const handler = createPreparationTerminalHandler(currentArn, store, status, () => end);
  return { store, publisher, status, handler };
}

describe("bounded preparation reconciliation", () => {
  it("recovers terminal work with dispatch disabled by default", async () => {
    const { store, publisher, status } = fixture();
    expect(await createPreparationReconciler(store, publisher, status)()).toEqual({
      inspected: 1,
      settled: 1,
      sent: 0,
      failed: 0,
    });
    expect(store.settlePreparationExecution).toHaveBeenCalledWith({
      eventId,
      preparationId,
      functionArn,
      executionName,
      executionArn,
      ...terminal,
    });
    expect(store.claimPreparationNudges).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it("publishes bounded identifiers only when dispatch is explicitly enabled", async () => {
    const { store, publisher, status } = fixture();
    status.read.mockResolvedValue({ status: "RUNNING", startTimestamp: start });
    expect(
      await createPreparationReconciler(store, publisher, status, {
        dispatchEnabled: true,
        batchSize: 3,
      })(),
    ).toEqual({ inspected: 1, settled: 0, sent: 1, failed: 0 });
    expect(store.claimPreparationExecutionsForReconciliation).toHaveBeenCalledWith(3);
    expect(store.claimPreparationNudges).toHaveBeenCalledWith(3);
    expect(publisher.publish).toHaveBeenCalledWith({
      schemaVersion: 1,
      eventId,
      eventType: "application.packet-preparation.requested.v1",
      data: { preparationId },
    });
    expect(store.settlePreparationExecution).not.toHaveBeenCalled();
  });
  it("contains individual read/publish/settlement failures without returning raw errors", async () => {
    const { store, publisher, status } = fixture();
    store.claimPreparationExecutionsForReconciliation.mockResolvedValue([dispatch, dispatch]);
    status.read.mockRejectedValueOnce(new Error("synthetic-private-detail"));
    store.settlePreparationExecution.mockResolvedValueOnce(false);
    publisher.publish.mockRejectedValueOnce(new Error("synthetic-private-detail"));
    expect(
      await createPreparationReconciler(store, publisher, status, { dispatchEnabled: true })(),
    ).toEqual({ inspected: 2, settled: 0, sent: 0, failed: 3 });
  });
  it("stops issuing work at the shared fifty-second budget", async () => {
    const { store, publisher, status } = fixture();
    store.claimPreparationExecutionsForReconciliation.mockResolvedValue([dispatch, dispatch]);
    let elapsed = 0;
    status.read.mockImplementation(async () => {
      elapsed = 50_000;
      return terminal;
    });
    expect(
      await createPreparationReconciler(store, publisher, status, {
        dispatchEnabled: true,
        elapsedMs: () => elapsed,
      })(),
    ).toEqual({ inspected: 1, settled: 1, sent: 0, failed: 0 });
    expect(status.read).toHaveBeenCalledTimes(1);
    expect(store.claimPreparationNudges).not.toHaveBeenCalled();
  });
  it("rejects invalid batch/clock configuration before I/O", async () => {
    const { store, publisher, status } = fixture();
    for (const batchSize of [0, 26, 1.5, Number.NaN])
      expect(() => createPreparationReconciler(store, publisher, status, { batchSize })).toThrow(
        PreparationDispatchError,
      );
    await expect(
      createPreparationReconciler(store, publisher, status, { elapsedMs: () => Number.NaN })(),
    ).rejects.toThrow(PreparationDispatchError);
    expect(store.claimPreparationExecutionsForReconciliation).not.toHaveBeenCalled();
  });

  it("redacts batch-wide SQL claim failures without sending any nudge", async () => {
    const { store, publisher, status } = fixture();
    store.claimPreparationExecutionsForReconciliation.mockRejectedValue(
      new Error("synthetic-private-sql"),
    );
    await expect(
      createPreparationReconciler(store, publisher, status, { dispatchEnabled: true })(),
    ).rejects.toThrow("PreparationDispatchPending");
    expect(status.read).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

describe("independently verified preparation terminal events", () => {
  it("supports the documented empty resource envelope and retained numeric version", async () => {
    const { store, status, handler } = fixture();
    await expect(handler(envelope())).resolves.toEqual({ handled: true });
    expect(status.read).toHaveBeenCalledWith(dispatch);
    expect(store.settlePreparationExecution).toHaveBeenCalledWith({
      eventId,
      preparationId,
      functionArn,
      executionName,
      executionArn,
      ...terminal,
    });
  });

  it("treats EventBridge event IDs as opaque GUIDs without weakening owned event UUIDs", async () => {
    const { handler } = fixture();
    await expect(
      handler({ ...envelope(), id: "019d04cf-1f80-9000-0000-00000000000c" }),
    ).resolves.toEqual({ handled: true });
  });
  it("recovers a lost start ACK only after independent AWS metadata verification", async () => {
    const { store, status, handler } = fixture();
    store.getPreparationDispatch.mockResolvedValue({
      ...dispatch,
      executionArn: null,
      leaseId: preparationId,
    });
    const value = envelope();
    value.resources = [functionArn];
    await expect(handler(value)).resolves.toEqual({ handled: true });
    expect(status.read).toHaveBeenCalledWith({ ...dispatch, leaseId: preparationId });
  });
  it("ignores missing or deleted events without an AWS call", async () => {
    const { store, status, handler } = fixture();
    store.getPreparationDispatch.mockResolvedValue(undefined);
    await expect(handler(envelope())).resolves.toEqual({ handled: false });
    expect(status.read).not.toHaveBeenCalled();
    expect(store.settlePreparationExecution).not.toHaveBeenCalled();
  });
  it.each(["RUNNING", "SUCCEEDED"] as const)(
    "cannot settle a forged FAILED envelope when AWS reports %s",
    async (reported) => {
      const { store, status, handler } = fixture();
      status.read.mockResolvedValue(
        reported === "RUNNING"
          ? { status: reported, startTimestamp: start }
          : { ...terminal, status: reported },
      );
      await expect(handler(envelope())).rejects.toThrow(PreparationDispatchError);
      expect(store.settlePreparationExecution).not.toHaveBeenCalled();
    },
  );
  it("refuses metadata timestamp disagreement or stored execution identity before settlement", async () => {
    const { store, status, handler } = fixture();
    status.read.mockResolvedValue({ ...terminal, endTimestamp: new Date(end.getTime() + 1) });
    await expect(handler(envelope())).rejects.toThrow(PreparationDispatchError);
    status.read.mockClear();
    store.getPreparationDispatch.mockResolvedValue({
      ...dispatch,
      executionArn: `${executionArn}-foreign`,
    });
    await expect(handler(envelope())).rejects.toThrow(PreparationDispatchError);
    expect(status.read).not.toHaveBeenCalled();
    expect(store.settlePreparationExecution).not.toHaveBeenCalled();
  });
  it("strictly rejects wrong account/region/function/resources, value fields and malformed dates before I/O", async () => {
    const { store, handler } = fixture();
    for (const value of [
      { ...envelope(), account: "999999999999" },
      { ...envelope(), region: "us-east-1" },
      { ...envelope(), source: "custom" },
      { ...envelope(), resources: ["foreign"] },
      { ...envelope(), resources: [functionArn, functionArn] },
      { ...envelope(), time: "2026-09-01T12:00:00Z" },
      { ...envelope(), time: "2026-02-30T12:00:00Z" },
      { ...envelope(), prompt: "synthetic" },
      { ...envelope(), detail: { ...envelope().detail, functionArn: currentArn } },
      { ...envelope(), detail: { ...envelope().detail, result: "synthetic" } },
      { ...envelope(), detail: { ...envelope().detail, endTimestamp: "2026-10-02T11:00:00Z" } },
    ])
      await expect(handler(value)).rejects.toThrow(PreparationDispatchError);
    expect(store.getPreparationDispatch).not.toHaveBeenCalled();
  });
  it("does not evaluate injected accessors or status conversion", async () => {
    const { store, handler } = fixture();
    const getter = vi.fn(() => "synthetic-private");
    const value = envelope();
    Object.defineProperty(value, "source", { get: getter, enumerable: true });
    await expect(handler(value)).rejects.toThrow(PreparationDispatchError);
    const statusConversion = vi.fn(() => "FAILED");
    await expect(
      handler({
        ...envelope(),
        detail: { ...envelope().detail, status: { toString: statusConversion } },
      }),
    ).rejects.toThrow(PreparationDispatchError);
    expect(getter).not.toHaveBeenCalled();
    expect(statusConversion).not.toHaveBeenCalled();
    expect(store.getPreparationDispatch).not.toHaveBeenCalled();
  });

  it("refuses resource accessors and hidden fields without evaluating them", async () => {
    const { store, handler } = fixture();
    const getter = vi.fn(() => functionArn);
    const resources = [functionArn];
    Object.defineProperty(resources, "0", { get: getter, enumerable: true });
    await expect(handler({ ...envelope(), resources })).rejects.toThrow(PreparationDispatchError);
    const hidden: string[] = [];
    Object.defineProperty(hidden, "prompt", { value: "synthetic", enumerable: false });
    await expect(handler({ ...envelope(), resources: hidden })).rejects.toThrow(
      PreparationDispatchError,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(store.getPreparationDispatch).not.toHaveBeenCalled();
  });
  it("returns fixed pending errors on unavailable owner or AWS ports", async () => {
    const { store, status, handler } = fixture();
    store.getPreparationDispatch.mockRejectedValueOnce(new Error("synthetic-private-sql"));
    await expect(handler(envelope())).rejects.toThrow(PreparationDispatchPendingError);
    status.read.mockRejectedValueOnce(new Error("synthetic-private-aws"));
    await expect(handler(envelope())).rejects.toThrow("PreparationDispatchPending");
  });
});
