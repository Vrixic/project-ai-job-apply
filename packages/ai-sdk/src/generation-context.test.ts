import type { GraphFact } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import { coverLetterContext } from "./generation.js";

const now = new Date("2026-10-02T12:00:00.000Z");
const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
const fact: GraphFact = {
  id: "synthetic-fact",
  kind: "skill",
  key: "skill",
  value: "TypeScript",
  verification: "confirmed",
  sensitivity: "standard",
  source: { type: "user", reference: "synthetic" },
  version: 1,
};
const bind = (facts: readonly GraphFact[], posting = job, clock = now) =>
  coverLetterContext({ facts, job: posting, now: clock });

describe("cover-letter evidence and job bindings", () => {
  it("is deterministic across owner fact ordering and returns only digests", () => {
    const second = { ...fact, id: "another-fact", value: "PostgreSQL" };
    expect(bind([fact, second])).toEqual(bind([second, fact]));
    expect(bind([fact, fact])).toEqual(bind([fact]));
    expect(bind([fact])).toEqual({
      confirmedFactsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      jobContextHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("uses the latest fact version and changes for evidence or confidence changes", () => {
    const updated = { ...fact, version: 2, value: "Rust" };
    expect(bind([fact, updated])).toEqual(bind([updated]));
    expect(bind([fact, { ...fact, version: 2, kind: "contact" }])).toEqual(bind([]));
    expect(bind([updated]).confirmedFactsHash).not.toBe(bind([fact]).confirmedFactsHash);
    expect(
      bind([{ ...fact, source: { type: "derived", reference: "synthetic" } }]).confirmedFactsHash,
    ).not.toBe(bind([fact]).confirmedFactsHash);
  });

  it("excludes restricted, unconfirmed and non-career facts exactly like generation", () => {
    for (const excluded of [
      { ...fact, sensitivity: "restricted" as const },
      { ...fact, verification: "proposed" as const },
      { ...fact, kind: "contact" },
    ]) {
      expect(bind([excluded])).toEqual(bind([]));
    }
  });

  it("invalidates when selected evidence expires or is security-held", () => {
    const expiring = { ...fact, effectiveTo: "2026-10-02" };
    expect(bind([expiring])).toEqual(bind([fact]));
    expect(bind([expiring], job, new Date("2026-10-03T00:00:00Z"))).toEqual(bind([]));
    expect(
      bind([
        {
          ...fact,
          availability: { state: "invalidated", reasonCode: "source_security_hold" },
        },
      ]),
    ).toEqual(bind([]));
  });

  it("binds the complete posting, including content beyond prompt truncation", () => {
    const longJob = { ...job, description: "x".repeat(6_000) };
    const original = bind([fact], longJob);
    for (const posting of [
      { ...longJob, description: `${longJob.description} changed` },
      { ...longJob, title: "Changed" },
      { ...longJob, company: "Changed" },
    ]) {
      expect(bind([fact], posting).jobContextHash).not.toBe(original.jobContextHash);
      expect(bind([fact], posting).confirmedFactsHash).toBe(original.confirmedFactsHash);
    }
  });

  it("binds only the bounded forty selected facts", () => {
    const selected = Array.from({ length: 40 }, (_, index) => ({
      ...fact,
      id: `fact-${String(index).padStart(2, "0")}`,
    }));
    const overflow = { ...fact, id: "zzz-overflow", value: "Other" };
    expect(bind([...selected, overflow])).toEqual(bind(selected));
    expect(bind([...selected, { ...overflow, id: "aaa-first" }]).confirmedFactsHash).not.toBe(
      bind(selected).confirmedFactsHash,
    );
  });
});
