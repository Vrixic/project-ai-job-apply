import { describe, expect, it, vi } from "vitest";
import {
  type CoverLetterCleanupInput,
  validateCoverLetterCleanupInput,
  validateCoverLetterCleanupOutput,
} from "./cover-letter-cleanup-contract.js";
import { createCoverLetterCleanupHandler } from "./cover-letter-cleanup-handler.js";
import { validateProviderControlInput } from "./cover-letter-provider-control-contract.js";

const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-cleanup:7";
const documentId = "019a4000-0000-7000-8000-000000000001";
const input: CoverLetterCleanupInput = {
  schemaVersion: 1,
  action: "fence",
  documentId,
  reference: {
    id: "019a4000-0000-7000-8000-000000000002",
    documentId,
    purpose: "private_slots",
    requestSha256: "a".repeat(64),
  },
};

describe("private cover-letter cleanup boundary", () => {
  it.each(["private_slots", "provider_dispatch", "final_document"] as const)(
    "accepts an exact original %s reference without expanding provider control",
    (purpose) => {
      const request = { ...input, reference: { ...input.reference, purpose } };
      expect(validateCoverLetterCleanupInput(request)).toBe(true);
      expect(validateProviderControlInput(request)).toBe(false);
    },
  );
  it.each([
    null,
    [],
    { ...input, schemaVersion: 2 },
    { ...input, action: "settle" },
    { ...input, ownerUserId: documentId },
    { ...input, stopped: true },
    { ...input, deadline: "2026-10-03T00:00:00.000Z" },
    { ...input, documentId: "invalid" },
    { ...input, reference: { ...input.reference, documentId: input.reference.id } },
    { ...input, reference: { ...input.reference, purpose: "unknown" } },
    { ...input, reference: { ...input.reference, requestSha256: "invalid" } },
    { ...input, reference: { ...input.reference, id: "invalid" } },
    { ...input, reference: { ...input.reference, ownerUserId: documentId } },
  ])("rejects malformed or authority-bearing envelopes before control access (%#)", async (raw) => {
    const fenceForCleanup = vi.fn(async () => "pending" as const);
    const handler = createCoverLetterCleanupHandler({
      functionArn: arn,
      work: { fenceForCleanup },
      enabled: () => true,
    });
    expect(validateCoverLetterCleanupInput(raw)).toBe(false);
    await expect(handler(raw, { invokedFunctionArn: arn })).rejects.toThrow(
      /^CoverLetterCleanupUnavailable$/u,
    );
    expect(fenceForCleanup).not.toHaveBeenCalled();
  });
  it("rejects getters, hidden/symbol keys, inherited records and coercible values", () => {
    const getter = vi.fn(() => input.documentId);
    const coercePurpose = vi.fn(() => "private_slots");
    for (const raw of [
      Object.defineProperty({ ...input }, "documentId", { get: getter, enumerable: true }),
      Object.defineProperty({ ...input }, "hidden", { value: true }),
      { ...input, [Symbol("extra")]: true },
      Object.assign(Object.create({ inherited: true }), input),
      { ...input, reference: { ...input.reference, purpose: { toString: coercePurpose } } },
    ])
      expect(validateCoverLetterCleanupInput(raw)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(coercePurpose).not.toHaveBeenCalled();
  });
  it.each(["pending", "ledger_terminal", "unavailable"] as const)(
    "validates %s as operational metadata, never quiescence proof",
    (outcome) => {
      const output = { ...input, outcome };
      expect(validateCoverLetterCleanupOutput(output)).toBe(true);
      expect(validateCoverLetterCleanupOutput({ ...output, quiescent: true })).toBe(false);
      expect(validateCoverLetterCleanupOutput({ ...output, outcome: "settled" })).toBe(false);
      expect(
        validateCoverLetterCleanupOutput({ ...output, outcome: { toString: () => outcome } }),
      ).toBe(false);
    },
  );
  it.each(["default_off", "wrong_target", "disabled"])(
    "refuses %s before control access",
    async (kind) => {
      const fenceForCleanup = vi.fn(async () => "pending" as const);
      const handler = createCoverLetterCleanupHandler({
        functionArn: arn,
        work: { fenceForCleanup },
        ...(kind === "default_off" ? {} : { enabled: () => kind === "wrong_target" }),
      });
      expect(
        await handler(input, { invokedFunctionArn: kind === "wrong_target" ? `${arn}1` : arn }),
      ).toEqual({
        ...input,
        outcome: "unavailable",
      });
      expect(fenceForCleanup).not.toHaveBeenCalled();
    },
  );
  it.each(["pending", "ledger_terminal"] as const)(
    "awaits the committed fence before %s",
    async (outcome) => {
      const fenceForCleanup = vi.fn(async () => outcome);
      const handler = createCoverLetterCleanupHandler({
        functionArn: arn,
        work: { fenceForCleanup },
        enabled: () => true,
      });
      expect(await handler(input, { invokedFunctionArn: arn })).toEqual({ ...input, outcome });
      expect(fenceForCleanup).toHaveBeenCalledExactlyOnceWith(input.reference);
    },
  );
  it("snapshots input and waits for the original acknowledgement, refusing a changed gate", async () => {
    let finish: (value: "pending") => void = () => undefined;
    let enabled = true;
    const original = new Promise<"pending">((resolve) => {
      finish = resolve;
    });
    const fenceForCleanup = vi.fn(() => original);
    const handler = createCoverLetterCleanupHandler({
      functionArn: arn,
      work: { fenceForCleanup },
      enabled: () => enabled,
    });
    const mutable = structuredClone(input);
    let returned = false;
    const response = handler(mutable, { invokedFunctionArn: arn }).then((value) => {
      returned = true;
      return value;
    });
    mutable.reference.requestSha256 = "b".repeat(64);
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(fenceForCleanup).toHaveBeenCalledExactlyOnceWith(input.reference);
    enabled = false;
    finish("pending");
    expect(await response).toEqual({ ...input, outcome: "unavailable" });
  });
  it("redacts control errors and rejects unexpected control results", async () => {
    for (const fenceForCleanup of [
      vi.fn(async () => {
        throw Error("SyntheticPrivateDiagnostic");
      }),
      vi.fn(async () => "quiescent" as unknown as "pending"),
    ]) {
      const handler = createCoverLetterCleanupHandler({
        functionArn: arn,
        work: { fenceForCleanup },
        enabled: () => true,
      });
      expect(await handler(input, { invokedFunctionArn: arn })).toEqual({
        ...input,
        outcome: "unavailable",
      });
    }
  });
  it.each([
    arn.replace(":7", ":$LATEST"),
    arn.replace(":7", ":cleanup"),
    arn.replace(":7", ":07"),
    arn.replace("us-east-2", "us-west-2"),
  ])("rejects an unpinned target %s", (functionArn) => {
    expect(() =>
      createCoverLetterCleanupHandler({
        functionArn,
        work: { fenceForCleanup: async () => "pending" },
      }),
    ).toThrow(/^CoverLetterCleanupUnavailable$/u);
  });
});
