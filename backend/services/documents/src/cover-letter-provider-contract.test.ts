import { describe, expect, it, vi } from "vitest";
import {
  COVER_LETTER_PROVIDER_MODEL,
  CoverLetterProviderTransportError,
  coverLetterProviderByteLimits,
  coverLetterProviderKey,
  coverLetterProviderSha256,
  decodeCoverLetterProviderObject,
  encodeCoverLetterProviderObject,
  validateCoverLetterProviderInput,
  validateCoverLetterProviderOutput,
  validateCoverLetterProviderReference,
} from "./cover-letter-provider-contract.js";

const documentId = "019d04cf-1f80-7000-8000-000000000001";
const request = {
  schemaVersion: 1,
  documentId,
  noticeVersion: "openai-cover-letter.v1",
  promptVersion: "1.0.0",
  jobContextHash: "a".repeat(64),
  confirmedFactsHash: "b".repeat(64),
  approvedAt: "2026-10-02T12:00:00.000Z",
  expiresAt: "2026-10-02T12:15:00.000Z",
  system: "Synthetic grounded cover letter rules",
  user: "Synthetic TypeScript career fact",
  maxOutputChars: 8_000,
};
const reference = {
  objectVersion: "synthetic-version",
  etag: '"synthetic-etag"',
  sha256: "c".repeat(64),
  sizeBytes: 100,
};
const dispatch = {
  schemaVersion: 1,
  documentId,
  requestSha256: "d".repeat(64),
  state: "claimed",
  dispatchedAt: request.approvedAt,
};

describe("isolated cover-letter provider transport contract", () => {
  it("keeps invocation/result envelopes reference-only with no candidate or prompt fields", () => {
    const input = { schemaVersion: 1, documentId, request: reference };
    const output = { schemaVersion: 1, documentId, outcome: "ready", result: reference };
    expect(validateCoverLetterProviderInput(input)).toBe(true);
    expect(validateCoverLetterProviderOutput(output)).toBe(true);
    for (const value of [
      { ...input, system: request.system },
      { ...input, ownerUserId: documentId },
      { ...input, objectKey: "arbitrary" },
    ])
      expect(validateCoverLetterProviderInput(value)).toBe(false);
    expect(validateCoverLetterProviderOutput({ ...output, text: request.user })).toBe(false);
    expect(JSON.stringify([input, output])).not.toContain("TypeScript");
  });
  it.each(["failed", "in_progress"])("accepts fixed %s without result/error data", (outcome) => {
    expect(validateCoverLetterProviderOutput({ schemaVersion: 1, documentId, outcome })).toBe(true);
    expect(
      validateCoverLetterProviderOutput({
        schemaVersion: 1,
        documentId,
        outcome,
        error: "synthetic",
      }),
    ).toBe(false);
    expect(
      validateCoverLetterProviderOutput({
        schemaVersion: 1,
        documentId,
        outcome,
        result: reference,
      }),
    ).toBe(false);
  });
  it("derives exactly three slots beneath the reserved normalized document prefix", () => {
    for (const slot of ["request", "dispatch", "result"] as const)
      expect(coverLetterProviderKey(documentId, slot)).toBe(
        `normalized/${documentId}/generation/${slot}.v1.json`,
      );
    expect(() => coverLetterProviderKey("../foreign", "request")).toThrow(
      CoverLetterProviderTransportError,
    );
    expect(() => coverLetterProviderKey(documentId.toUpperCase(), "result")).toThrow(
      CoverLetterProviderTransportError,
    );
  });
  it("canonicalizes key order and pins the original consent/context identity", () => {
    const bytes = encodeCoverLetterProviderObject("request", request);
    const reordered = Object.fromEntries(Object.entries(request).reverse());
    expect(encodeCoverLetterProviderObject("request", reordered)).toEqual(bytes);
    expect(decodeCoverLetterProviderObject("request", bytes)).toEqual(request);
    expect(coverLetterProviderSha256(bytes)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      coverLetterProviderSha256(
        encodeCoverLetterProviderObject("request", { ...request, jobContextHash: "e".repeat(64) }),
      ),
    ).not.toBe(coverLetterProviderSha256(bytes));
  });
  it("round-trips claims/results with only a request hash and original dispatch timestamp", () => {
    expect(
      decodeCoverLetterProviderObject(
        "dispatch",
        encodeCoverLetterProviderObject("dispatch", dispatch),
      ),
    ).toEqual(dispatch);
    const result = {
      ...dispatch,
      state: "ready",
      text: '{"paragraphs":[]}',
      model: COVER_LETTER_PROVIDER_MODEL,
      outputCharacters: 17,
    };
    expect(
      decodeCoverLetterProviderObject("result", encodeCoverLetterProviderObject("result", result)),
    ).toEqual(result);
  });
  it("canonicalizes provenance and rejects undisclosed model identity or invalid output size", () => {
    const result = {
      ...dispatch,
      state: "ready",
      text: '{"paragraphs":[]}',
      model: COVER_LETTER_PROVIDER_MODEL,
      outputCharacters: 17,
    };
    const bytes = encodeCoverLetterProviderObject("result", result);
    expect(
      encodeCoverLetterProviderObject("result", {
        ...result,
        model: Object.fromEntries(Object.entries(COVER_LETTER_PROVIDER_MODEL).reverse()),
      }),
    ).toEqual(bytes);
    for (const changed of [
      { model: { ...COVER_LETTER_PROVIDER_MODEL, provider: "other" } },
      { model: { ...COVER_LETTER_PROVIDER_MODEL, model: "other" } },
      { model: { ...COVER_LETTER_PROVIDER_MODEL, version: "other" } },
      { model: { ...COVER_LETTER_PROVIDER_MODEL, privateData: "synthetic" } },
      { outputCharacters: 0 },
      { outputCharacters: 8_001 },
      { outputCharacters: 1.5 },
    ])
      expect(() => encodeCoverLetterProviderObject("result", { ...result, ...changed })).toThrow(
        CoverLetterProviderTransportError,
      );
    const getter = vi.fn(() => "openai");
    const model = { ...COVER_LETTER_PROVIDER_MODEL };
    Object.defineProperty(model, "provider", { get: getter, enumerable: true });
    expect(() => encodeCoverLetterProviderObject("result", { ...result, model })).toThrow(
      CoverLetterProviderTransportError,
    );
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([
    { noticeVersion: "other" },
    { promptVersion: "other" },
    { provider: "other" },
    { approvedAt: "2026-02-30T12:00:00.000Z" },
    { expiresAt: "2026-10-02T12:15:00.001Z" },
    { jobContextHash: "bad" },
    { maxOutputChars: 8_001 },
    { maxOutputChars: 0 },
    { system: "" },
    { user: "x".repeat(40_001) },
  ])("rejects malformed, renewed or over-bound requests", (changed) => {
    expect(() => encodeCoverLetterProviderObject("request", { ...request, ...changed })).toThrow(
      CoverLetterProviderTransportError,
    );
  });
  it("checks serialized byte bounds as well as prompt character bounds", () => {
    expect(() =>
      encodeCoverLetterProviderObject("request", {
        ...request,
        system: "x",
        user: String.fromCharCode(0).repeat(39_999),
      }),
    ).toThrow(CoverLetterProviderTransportError);
    expect(() =>
      encodeCoverLetterProviderObject("result", {
        ...dispatch,
        state: "ready",
        model: COVER_LETTER_PROVIDER_MODEL,
        outputCharacters: 8_000,
        text: "x".repeat(8_001),
      }),
    ).toThrow(CoverLetterProviderTransportError);
    expect(coverLetterProviderByteLimits.request).toBe(196_608);
  });
  it.each([
    { objectVersion: "null" },
    { etag: "*" },
    { etag: "unquoted" },
    { etag: '"one", "two"' },
    { etag: `"synthetic${String.fromCharCode(10)}"` },
    { objectVersion: "" },
    { objectVersion: `synthetic${String.fromCharCode(10)}` },
    { sizeBytes: 0 },
    { sizeBytes: 196_609 },
    { sizeBytes: 1.5 },
    { sha256: "bad" },
  ])("rejects malformed or unversioned references", (changed) => {
    expect(validateCoverLetterProviderReference({ ...reference, ...changed }, "request")).toBe(
      false,
    );
  });
  it("never evaluates accessors or accepts hidden/symbol fields", () => {
    const getter = vi.fn(() => request.user);
    const value = { ...request };
    Object.defineProperty(value, "user", { get: getter, enumerable: true });
    expect(() => encodeCoverLetterProviderObject("request", value)).toThrow(
      CoverLetterProviderTransportError,
    );
    const hidden = { ...request };
    Object.defineProperty(hidden, "secret", { value: "synthetic", enumerable: false });
    expect(() => encodeCoverLetterProviderObject("request", hidden)).toThrow(
      CoverLetterProviderTransportError,
    );
    expect(() =>
      encodeCoverLetterProviderObject("request", { ...request, [Symbol("secret")]: "synthetic" }),
    ).toThrow(CoverLetterProviderTransportError);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["dispatch", "result"] as const)("round-trips only valid %s states", (slot) => {
    const initial = {
      schemaVersion: 1,
      documentId,
      requestSha256: dispatch.requestSha256,
      state: slot === "dispatch" ? "issued" : "pending",
    };
    expect(
      decodeCoverLetterProviderObject(slot, encodeCoverLetterProviderObject(slot, initial)),
    ).toEqual(initial);
    for (const invalid of [
      { ...initial, state: "other" },
      { ...initial, dispatchedAt: request.approvedAt },
      { ...initial, text: "synthetic" },
      { ...initial, state: slot === "dispatch" ? "claimed" : "ready" },
    ])
      expect(() => encodeCoverLetterProviderObject(slot, invalid)).toThrow(
        CoverLetterProviderTransportError,
      );
    const getter = vi.fn(() => initial.state);
    Object.defineProperty(initial, "state", { get: getter, enumerable: true });
    expect(() => encodeCoverLetterProviderObject(slot, initial)).toThrow(
      CoverLetterProviderTransportError,
    );
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects invalid UTF-8, duplicate keys, noncanonical JSON and cross-slot content", () => {
    const bytes = encodeCoverLetterProviderObject("request", request);
    const json = new TextDecoder().decode(bytes);
    for (const invalid of [
      new Uint8Array([255]),
      new TextEncoder().encode(` ${json}`),
      new TextEncoder().encode(
        json.replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'),
      ),
    ])
      expect(() => decodeCoverLetterProviderObject("request", invalid)).toThrow(
        CoverLetterProviderTransportError,
      );
    expect(() => decodeCoverLetterProviderObject("result", bytes)).toThrow(
      CoverLetterProviderTransportError,
    );
  });
});
