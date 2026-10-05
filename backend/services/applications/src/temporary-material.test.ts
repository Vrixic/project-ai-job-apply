import type { TemporaryMaterialReference } from "@ai-job-apply/domain";
import { describe, expect, it } from "vitest";
import {
  approvePacket,
  assemblePacket,
  computePacketHash,
  evaluateBindings,
  verifyPacketHash,
} from "./packet.js";
import { carryTemporaryMaterialBindings } from "./temporary-material.js";
import {
  APPLICATION_ID,
  CONSENT_ID,
  definitions,
  FACT_A,
  HASH_A,
  HASH_B,
  HASH_C,
  NOW,
  packetInputs,
  USER_ID,
} from "./test-support.js";

const reference: TemporaryMaterialReference = {
  schemaVersion: 1,
  kind: "tailored_resume",
  generationId: FACT_A,
  ownerUserId: USER_ID,
  applicationId: APPLICATION_ID,
  version: 1,
  contentSha256: HASH_C,
  completedAtMs: NOW.getTime(),
  expiresAtMs: NOW.getTime() + 1_800_000,
};
const current = {
  jobRevision: HASH_A,
  formHash: HASH_B,
  resumeHash: HASH_C,
  temporaryMaterials: [reference],
};
const make = (materials = [reference]) =>
  assemblePacket(
    {
      ...packetInputs(),
      createdAt: new Date(Math.max(NOW.getTime(), ...materials.map((item) => item.completedAtMs))),
      temporaryMaterials: materials,
    },
    definitions,
  );
const request = (packetHash: string) => ({
  packetHash,
  consentId: CONSENT_ID,
  acknowledgedFieldKeys: ["contact.email"],
});

describe("original temporary material packet admission", () => {
  it("leaves packets without temporary materials byte-compatible", () => {
    const legacy = assemblePacket(packetInputs(), definitions);
    expect(make([]).packetHash).toBe(legacy.packetHash);
    expect(make([]).temporaryMaterials).toBeUndefined();
  });
  it("binds original identity and time even when replacement text hashes identically", () => {
    const original = make();
    const fresh = make([
      {
        ...reference,
        generationId: USER_ID,
        completedAtMs: reference.completedAtMs + 1,
        expiresAtMs: reference.expiresAtMs + 1,
      },
    ]);
    expect(original.packetHash).not.toBe(fresh.packetHash);
    expect(
      evaluateBindings(
        original,
        { ...current, temporaryMaterials: fresh.temporaryMaterials ?? [] },
        NOW,
      ),
    ).toContain("temporary_material_changed");
  });
  it.each(["owner", "application", "hash", "window", "duplicate", "content"])(
    "refuses invalid original metadata before assembly: %s",
    (fault) => {
      const bad = structuredClone(reference);
      if (fault === "owner") bad.ownerUserId = FACT_A;
      if (fault === "application") bad.applicationId = FACT_A;
      if (fault === "hash") bad.contentSha256 = HASH_B;
      if (fault === "window") bad.expiresAtMs += 1;
      if (fault === "content") Object.assign(bad, { text: "synthetic forbidden content" });
      expect(() => make(fault === "duplicate" ? [bad, bad] : [bad])).toThrow(
        "Invalid original temporary material binding",
      );
    },
  );
  it("caps approval at the original deadline", () => {
    const packet = make();
    const approval = approvePacket(packet, request(packet.packetHash), NOW);
    expect(approval.expiresAt.getTime()).toBe(reference.expiresAtMs);
  });
  it.each([-1, 0, 1])("evaluates the exact expiry boundary, offset %s", (offset) => {
    const packet = make();
    const at = new Date(reference.expiresAtMs + offset);
    expect(evaluateBindings(packet, current, at)).toEqual(
      offset < 0 ? [] : ["temporary_material_expired"],
    );
    if (offset >= 0)
      expect(() => approvePacket(packet, request(packet.packetHash), at)).toThrow(
        "TEMPORARY_MATERIAL_EXPIRED",
      );
  });
  it("refuses missing live content reference while the metadata deadline is still valid", () => {
    expect(evaluateBindings(make(), { ...current, temporaryMaterials: [] }, NOW)).toEqual([
      "temporary_material_changed",
    ]);
  });
  it("refuses malformed stored references even if the hash is recomputed", () => {
    const packet = structuredClone(make());
    const material = packet.temporaryMaterials?.[0];
    if (!material) throw Error("SyntheticFixtureMissing");
    material.expiresAtMs += 1;
    packet.packetHash = computePacketHash(packet);
    expect(verifyPacketHash(packet)).toBe(false);
  });
  it("refuses creation at expiry and before original completion", () => {
    for (const at of [reference.completedAtMs - 1, reference.expiresAtMs]) {
      expect(() =>
        assemblePacket(
          { ...packetInputs(), createdAt: new Date(at), temporaryMaterials: [reference] },
          definitions,
        ),
      ).toThrow();
    }
  });
  it("orders both kinds canonically and caps authority at the earliest original expiry", () => {
    const letter: TemporaryMaterialReference = {
      ...reference,
      kind: "cover_letter",
      contentSha256: HASH_B,
      completedAtMs: reference.completedAtMs - 10,
      expiresAtMs: reference.expiresAtMs - 10,
    };
    const inputs = { ...packetInputs(), artifactHashes: { resume: HASH_C, coverLetter: HASH_B } };
    const first = assemblePacket(
      { ...inputs, temporaryMaterials: [reference, letter] },
      definitions,
    );
    const second = assemblePacket(
      { ...inputs, temporaryMaterials: [letter, reference] },
      definitions,
    );
    expect(first.packetHash).toBe(second.packetHash);
    expect(approvePacket(first, request(first.packetHash), NOW).expiresAt.getTime()).toBe(
      letter.expiresAtMs,
    );
  });
  it("carries omitted metadata without renewing the clock and requires replacement authority", () => {
    expect(carryTemporaryMaterialBindings([reference], [], { resume: HASH_C })).toEqual([
      reference,
    ]);
    expect(() => carryTemporaryMaterialBindings([reference], [], { resume: HASH_B })).toThrow(
      "TemporaryMaterialReplacementBindingRequired",
    );
    expect(carryTemporaryMaterialBindings([reference], [], {})).toEqual([]);
  });
  it.each(["renew", "rollback", "same_version_new_hash"])(
    "refuses an unauthorized descendant: %s",
    (fault) => {
      const original = { ...reference, version: 2 };
      const replacement = { ...original };
      if (fault === "renew") {
        replacement.completedAtMs++;
        replacement.expiresAtMs++;
      }
      if (fault === "rollback") replacement.version--;
      if (fault === "same_version_new_hash") replacement.contentSha256 = HASH_B;
      expect(() =>
        carryTemporaryMaterialBindings([original], [replacement], { resume: HASH_C }),
      ).toThrow("TemporaryMaterialOriginalBindingImmutable");
    },
  );
  it("allows a reviewed descendant with the original deadline or an explicit fresh generation", () => {
    const descendant = { ...reference, version: 2, contentSha256: HASH_B };
    expect(carryTemporaryMaterialBindings([reference], [descendant], { resume: HASH_B })).toEqual([
      descendant,
    ]);
    const fresh = {
      ...reference,
      generationId: USER_ID,
      completedAtMs: reference.completedAtMs + 1,
      expiresAtMs: reference.expiresAtMs + 1,
    };
    expect(carryTemporaryMaterialBindings([reference], [fresh], { resume: HASH_C })).toEqual([
      fresh,
    ]);
  });
  it("refuses unavailable, malformed and duplicate current references without evaluating accessors", () => {
    const getter = Object.defineProperty({}, "kind", {
      enumerable: true,
      get() {
        throw Error("AccessorMustNotRun");
      },
    });
    for (const refs of [[getter], [reference, reference], [null]]) {
      expect(
        evaluateBindings(
          make(),
          { ...current, temporaryMaterials: refs as TemporaryMaterialReference[] },
          NOW,
        ),
      ).toContain("temporary_material_changed");
    }
    expect(evaluateBindings(make(), current, new Date(Number.NaN))).toContain(
      "temporary_material_expired",
    );
  });
  it("snapshots and freezes caller references", () => {
    const detached = structuredClone(reference);
    const packet = make([detached]);
    detached.completedAtMs += 1;
    expect(packet.temporaryMaterials?.[0]?.completedAtMs).toBe(reference.completedAtMs);
    expect(Object.isFrozen(packet.temporaryMaterials?.[0])).toBe(true);
  });
});
