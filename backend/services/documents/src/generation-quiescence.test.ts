import { describe, expect, it, vi } from "vitest";
import {
  decideGenerationQuiescence,
  type GenerationQuiescenceEvidence,
  GenerationQuiescenceProof,
  PostgresGenerationQuiescenceReader,
} from "./generation-quiescence.js";

const documentId = "019d04cf-1f80-7000-8000-000000000001";
const evidence = (overrides: Partial<GenerationQuiescenceEvidence> = {}) => ({
  letter: { ownerAccountState: "quarantined" },
  workStates: ["settled", "settled", "revoked"],
  responseStates: ["disposed"],
  ...overrides,
});

describe("decideGenerationQuiescence", () => {
  it("confirms a quarantined owner whose writers settled and provider copies were disposed", () => {
    expect(decideGenerationQuiescence(evidence())).toBe(true);
    expect(decideGenerationQuiescence(evidence({ workStates: [], responseStates: [] }))).toBe(true);
    // An unclaimed issued authorization cannot start once the owner is quarantined.
    expect(decideGenerationQuiescence(evidence({ workStates: ["issued", "settled"] }))).toBe(true);
  });

  it.each([
    [
      "an active owner can still claim issued work",
      evidence({ letter: { ownerAccountState: "active" } }),
    ],
    ["an unknown owner state", evidence({ letter: { ownerAccountState: null } })],
    ["a claimed writer that has not settled", evidence({ workStates: ["settled", "running"] })],
    ["an unknown work state", evidence({ workStates: ["pending"] })],
    ["a reserved provider response", evidence({ responseStates: ["reserved"] })],
    [
      "an acknowledged but undisposed provider response",
      evidence({ responseStates: ["disposed", "acknowledged"] }),
    ],
    ["an unknown provider state", evidence({ responseStates: ["unknown"] })],
  ])("refuses %s", (_name, value) => {
    expect(decideGenerationQuiescence(value)).toBe(false);
  });

  it("treats a removed letter as quiescent only when no dependent evidence remains", () => {
    expect(decideGenerationQuiescence({ letter: null, workStates: [], responseStates: [] })).toBe(
      true,
    );
    expect(
      decideGenerationQuiescence({ letter: null, workStates: ["running"], responseStates: [] }),
    ).toBe(false);
    expect(
      decideGenerationQuiescence({ letter: null, workStates: [], responseStates: ["reserved"] }),
    ).toBe(false);
  });
});

describe("GenerationQuiescenceProof", () => {
  const signal = () => new AbortController().signal;

  it("answers only from the reader's positive evidence", async () => {
    const read = vi.fn(async () => evidence());
    expect(await new GenerationQuiescenceProof({ read }).confirm(documentId, signal())).toBe(true);
    expect(read).toHaveBeenCalledWith(documentId);
    read.mockResolvedValueOnce(evidence({ workStates: ["running"] }));
    expect(await new GenerationQuiescenceProof({ read }).confirm(documentId, signal())).toBe(false);
  });

  it("is unconfirmed for invalid identifiers, aborts and read failures, without reading", async () => {
    const read = vi.fn(async () => evidence());
    const proof = new GenerationQuiescenceProof({ read });
    for (const id of [
      "",
      "not-a-uuid",
      `${documentId}'; DROP TABLE x; --`,
      documentId.toUpperCase(),
    ]) {
      expect(await proof.confirm(id, signal())).toBe(false);
    }
    const aborted = new AbortController();
    aborted.abort();
    expect(await proof.confirm(documentId, aborted.signal)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    const failing = new GenerationQuiescenceProof({
      read: async () => {
        throw new Error("connection secret");
      },
    });
    expect(await failing.confirm(documentId, signal())).toBe(false);
  });

  it("refuses a result that arrives after the caller's deadline", async () => {
    const controller = new AbortController();
    const proof = new GenerationQuiescenceProof({
      read: async () => {
        controller.abort();
        return evidence();
      },
    });
    expect(await proof.confirm(documentId, controller.signal)).toBe(false);
  });
});

describe("PostgresGenerationQuiescenceReader", () => {
  it("reads three ledgers in one read-only repeatable-read snapshot with a bound document id", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const rows = [
      [{ ownerAccountState: "quarantined" }],
      [{ state: "settled" }, { state: "revoked" }],
      [{ state: "disposed" }],
    ];
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve(rows[calls.length - 1]);
    };
    const begin = vi.fn(
      async (options: string, work: (transaction: unknown) => Promise<unknown>) => {
        expect(options).toBe("isolation level repeatable read read only");
        return work(tx);
      },
    );
    const reader = new PostgresGenerationQuiescenceReader({ begin } as never);
    expect(await reader.read(documentId)).toEqual({
      letter: { ownerAccountState: "quarantined" },
      workStates: ["settled", "revoked"],
      responseStates: ["disposed"],
    });
    expect(calls.map((call) => call.values)).toEqual([[documentId], [documentId], [documentId]]);
    expect(calls.map((call) => /documents\.(\w+)/u.exec(call.text)?.[1])).toEqual([
      "cover_letters",
      "cover_letter_work_authorizations",
      "cover_letter_provider_responses",
    ]);
    for (const call of calls) expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/iu);
  });

  it("reports a missing letter as null", async () => {
    const tx = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const reader = new PostgresGenerationQuiescenceReader({
      begin: async (_options: string, work: (transaction: unknown) => Promise<unknown>) => work(tx),
    } as never);
    expect(await reader.read(documentId)).toEqual({
      letter: null,
      workStates: [],
      responseStates: [],
    });
  });
});
