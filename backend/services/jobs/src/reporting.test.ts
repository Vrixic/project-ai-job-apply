import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  type CreateJobReportCommand,
  JobAlreadyReportedError,
  type JobReport,
  JobReportIdempotencyConflictError,
  JobReportingService,
  JobReportLimitError,
  JobReportServiceUnavailableError,
  type JobReportStore,
  JobReportTargetUnavailableError,
  jobReportReasons,
} from "./reporting.js";

class MemoryReportStore implements JobReportStore {
  failure?: Error;
  lastCommand?: CreateJobReportCommand;
  report: JobReport = {
    id: uuidv7(),
    requestedJobId: uuidv7(),
    canonicalJobId: uuidv7(),
    reason: "job_closed",
    createdAt: "2026-08-16T18:00:00.000Z",
  };

  async ping(): Promise<void> {}

  async create(command: CreateJobReportCommand): Promise<JobReport> {
    this.lastCommand = command;
    if (this.failure) throw this.failure;
    return this.report;
  }
}

function command(overrides: Partial<CreateJobReportCommand> = {}): CreateJobReportCommand {
  return {
    ownerUserId: uuidv7(),
    requestedJobId: uuidv7(),
    reason: "job_closed",
    idempotencyKey: "job-report-idempotency-0001",
    ...overrides,
  };
}

describe("job reporting service", () => {
  it("accepts every fixed enum reason and returns an immutable allowlist", async () => {
    for (const reason of jobReportReasons) {
      const store = new MemoryReportStore();
      store.report = { ...store.report, reason };
      const service = new JobReportingService(store);
      const result = await service.report(command({ reason }));

      expect(store.lastCommand?.reason).toBe(reason);
      expect(result).toEqual(store.report);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result).sort()).toEqual([
        "canonicalJobId",
        "createdAt",
        "id",
        "reason",
        "requestedJobId",
      ]);
    }
  });

  it("rejects malformed owners, targets, reasons, and idempotency keys before store I/O", async () => {
    const store = new MemoryReportStore();
    const service = new JobReportingService(store);
    for (const malformed of [
      command({ ownerUserId: uuidv7().toUpperCase() }),
      command({ requestedJobId: crypto.randomUUID() }),
      command({ reason: "free_text" as "job_closed" }),
      command({ idempotencyKey: "too-short" }),
      command({ idempotencyKey: "x".repeat(129) }),
    ]) {
      await expect(service.report(malformed)).rejects.toBeInstanceOf(TypeError);
    }
    expect(store.lastCommand).toBeUndefined();
  });

  it("preserves stable domain errors and hides unexpected store failures", async () => {
    for (const failure of [
      new JobReportTargetUnavailableError(),
      new JobReportIdempotencyConflictError(),
      new JobAlreadyReportedError(),
      new JobReportLimitError(),
    ]) {
      const store = new MemoryReportStore();
      store.failure = failure;
      await expect(new JobReportingService(store).report(command())).rejects.toBe(failure);
    }

    const store = new MemoryReportStore();
    store.failure = new Error("private database detail");
    await expect(new JobReportingService(store).report(command())).rejects.toEqual(
      new JobReportServiceUnavailableError(),
    );
  });
});
