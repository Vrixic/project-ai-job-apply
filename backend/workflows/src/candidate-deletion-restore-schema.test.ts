import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import { expect, it, vi } from "vitest";
import { verifyDeletionRecoverySchema } from "./candidate-deletion-restore-schema.js";

it("cancels the actual pending schema query when admission expires", async () => {
  const controller = new AbortController();
  let rejectPending: (error: Error) => void = () => undefined;
  const cancel = vi.fn(() => rejectPending(new Error("SyntheticSchemaQueryCancelled")));
  const pending = Object.assign(
    new Promise((_, reject) => {
      rejectPending = reject;
    }),
    { cancel },
  );
  const unsafe = vi.fn(() => pending);
  const begin = vi.fn(async (_options, work) => work({ unsafe }));
  const database = { client: { begin } } as unknown as DatabaseHandle;
  const result = verifyDeletionRecoverySchema(database, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow("SyntheticSchemaQueryCancelled");
  expect(cancel).toHaveBeenCalledOnce();
  expect(unsafe).toHaveBeenCalledOnce();
  expect(begin.mock.calls[0]?.[0]).toBe("read only isolation level repeatable read");
});

it("does not open a transaction after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const begin = vi.fn();
  await expect(
    verifyDeletionRecoverySchema(
      { client: { begin } } as unknown as DatabaseHandle,
      controller.signal,
    ),
  ).rejects.toThrow("CandidateDeletionRestoreSchemaRejected");
  expect(begin).not.toHaveBeenCalled();
});
