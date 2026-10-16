import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedHandoff, parseHandoffLink, readApprovedHandoff } from "../lib/application-handoff";
import { APP, EMPLOYER, handoffFixture, LINK, WEB } from "./application-handoff-fixture";

const API = "https://api.example";
const json = (value: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("manual application handoff", () => {
  it("accepts only one exact first-party link with both identifiers", () => {
    expect(parseHandoffLink(LINK, WEB)?.applicationId).toBe(APP);
    for (const link of [
      `${LINK}&extra=true`,
      `${LINK}#fragment`,
      `${LINK}&job=other`,
      LINK.replace(WEB, "https://foreign.example"),
      LINK.replace("/jobs?", "/other?"),
      LINK.replace("application=", "application=invalid"),
      LINK.replace("https://", "https://user:pass@"),
    ])
      expect(parseHandoffLink(link, WEB)).toBeUndefined();
  });
  it("preserves false, excludes attestations, and never extends the original expiry", () => {
    const { application } = handoffFixture();
    const packet = application.currentPacket;
    assert(packet);
    packet.fields.push({
      fieldKey: "documents.resume",
      value: "b".repeat(64),
      origin: "confirmed_fact",
      sourceFactIds: [],
      confidence: 1,
      disposition: "auto",
      reasons: [],
      requiresReview: false,
    });
    const result = approvedHandoff(application, Date.now());
    expect(result.fields.map((field) => [field.fieldKey, field.value])).toEqual([
      ["contact.email", "synthetic@example.test"],
      ["authorization.us_authorized", "No"],
    ]);
    expect(result.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
    const material = application.currentPacket?.temporaryMaterials?.[0];
    assert(material);
    material.expiresAtMs = Date.now();
    expect(() => approvedHandoff(application, Date.now())).toThrow();
  });
  it("accepts a native generated resume field bound to its artifact digest without copying it", () => {
    const { application } = handoffFixture();
    const packet = application.currentPacket;
    const approval = application.approval;
    assert(packet && approval);
    const digestField: (typeof packet.fields)[number] = {
      fieldKey: "documents.resume",
      value: packet.artifactHashes.resume ?? null,
      origin: "generated",
      sourceFactIds: [],
      confidence: 1,
      disposition: "review",
      reasons: ["explicit_each_time"],
      requiresReview: true,
    };
    packet.fields.push(digestField);
    approval.acknowledgedFieldKeys.push("documents.resume");
    expect(approvedHandoff(application, Date.now()).fields.map((field) => field.fieldKey)).toEqual([
      "contact.email",
      "authorization.us_authorized",
    ]);
    digestField.value = "c".repeat(64);
    expect(() => approvedHandoff(application, Date.now())).toThrow();
  });
  it.each([
    "status",
    "hash",
    "acknowledgement",
    "generated",
    "duplicate",
    "deadline",
    "material-hash",
    "attempt",
    "vault",
    "restricted-review",
    "restricted-prefix",
  ])("refuses %s changes", (kind) => {
    const { application } = handoffFixture();
    const packet = application.currentPacket;
    const approval = application.approval;
    assert(packet && approval);
    const first = packet.fields[0];
    const second = packet.fields[1];
    assert(first && second);
    if (kind === "status") application.status = "cancelled";
    if (kind === "hash") approval.packetHash = "c".repeat(64);
    if (kind === "acknowledgement") approval.acknowledgedFieldKeys = [];
    if (kind === "generated") first.origin = "generated";
    if (kind === "duplicate") packet.fields.push(first);
    if (kind === "deadline") approval.expiresAt = new Date(Date.now()).toISOString();
    if (kind === "material-hash") packet.artifactHashes.resume = "c".repeat(64);
    if (kind === "attempt")
      application.attempts.push({
        id: APP,
        sequence: 1,
        status: "ambiguous",
        adapterId: "manual",
        adapterVersion: "1",
        startedAt: application.createdAt,
      });
    if (kind === "vault") second.origin = "answer_vault";
    if (kind === "restricted-review") second.requiresReview = false;
    if (kind === "restricted-prefix") {
      second.reasons = [];
      second.requiresReview = false;
    }
    expect(() => approvedHandoff(application, Date.now())).toThrow();
  });
  it("shows the exact saved context and caps the preview at the saved answer's own expiry", () => {
    const { application } = handoffFixture();
    const field = application.currentPacket?.fields[1];
    assert(field);
    const expires = Date.now() + 10_000;
    field.origin = "answer_vault";
    field.vaultReference = {
      id: APP,
      version: 2,
      context: "jurisdiction.us",
      questionHash: "c".repeat(64),
      meaningConfirmed: true,
      validUntilEpochMs: expires,
    };
    const result = approvedHandoff(application, Date.now());
    expect(result.deadline).toBe(expires);
    expect(result.fields[1]).toMatchObject({
      value: "No",
      restricted: true,
      context: "jurisdiction.us",
    });
  });
  it("uses bounded owner reads, current job hash, native withdrawal proof, and a final packet read", async () => {
    const fixture = handoffFixture();
    const responses = [fixture.application, fixture.job, fixture.proof, fixture.application];
    const send = vi.fn(async () => json(responses.shift()));
    vi.stubGlobal("fetch", send);
    const link = parseHandoffLink(LINK, WEB);
    assert(link);
    const result = await readApprovedHandoff(link, EMPLOYER, API, "synthetic-token");
    expect(result.id).toBe(APP);
    expect(send).toHaveBeenCalledTimes(4);
    for (const [, options] of send.mock.calls as unknown as [URL, RequestInit][])
      expect(options).toMatchObject({
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
  });
  it.each([
    "owner",
    "job",
    "destination",
    "proof",
    "withdrawn",
    "withheld",
    "replaced",
    "oversized",
    "cache",
    "closed-schema",
  ])("refuses %s responses", async (kind) => {
    const f = handoffFixture();
    const final = structuredClone(f.application);
    if (kind === "owner") f.application.id = "00000000-0000-7000-8000-000000000099";
    if (kind === "job") f.job.title = "Changed job";
    if (kind === "destination") {
      const source = f.job.sources[0];
      assert(source);
      source.canonicalUrl = "https://other.example/";
    }
    if (kind === "proof") f.proof.packetHash = "c".repeat(64);
    if (kind === "replaced") final.revision++;
    if (kind === "withheld") {
      delete final.currentPacket;
      delete final.approval;
      final.packetAvailability = "withheld";
      final.currentAction = "re_review";
    }
    let index = 0;
    const values = [f.application, f.job, f.proof, final];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        index++;
        if (kind === "withdrawn" && index === 3) return new Response(null, { status: 409 });
        if (kind === "oversized")
          return new Response(`"${"x".repeat(524289)}"`, {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        if (kind === "closed-schema") return json({ ...f.application, secret: "forbidden" });
        return json(values[index - 1], kind === "cache" ? { "cache-control": "public" } : {});
      }),
    );
    const link = parseHandoffLink(LINK, WEB);
    assert(link);
    await expect(readApprovedHandoff(link, EMPLOYER, API, "synthetic-token")).rejects.toThrow();
  });
  it("bounds stalled fetch and ignores a late response after abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise(() => undefined));
    const link = parseHandoffLink(LINK, WEB);
    assert(link);
    const result = readApprovedHandoff(link, EMPLOYER, API, "synthetic-token");
    const rejected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_001);
    await rejected;
  });
});
