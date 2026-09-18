import { describe, expect, it } from "vitest";
import { canonicalJson, NonCanonicalValueError } from "./canonical.js";
import { classifyField } from "./field-policy.js";
import {
  ApprovalRefusedError,
  approvePacket,
  assemblePacket,
  type CurrentBindings,
  computePacketHash,
  evaluateApproval,
  MAX_APPROVAL_AGE_MS,
  PacketInvariantError,
  verifyPacketHash,
} from "./packet.js";
import {
  CONSENT_ID,
  definitions,
  FACT_B,
  HASH_A,
  HASH_B,
  HASH_C,
  NOW,
  packetInputs,
  proposal,
} from "./test-support.js";

const current: CurrentBindings = { jobRevision: HASH_A, formHash: HASH_B, resumeHash: HASH_C };

describe("canonical JSON", () => {
  it("sorts keys and is stable across insertion order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("refuses values that could hash differently across runtimes", () => {
    for (const bad of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, () => 1, new Date()]) {
      expect(() => canonicalJson({ bad })).toThrow(NonCanonicalValueError);
    }
  });
});

describe("field review classification", () => {
  const email = definitions.get("contact.email");

  it("lets a confirmed, high-confidence deterministic fact through without review", () => {
    expect(classifyField(email, proposal())).toMatchObject({ disposition: "auto", usable: true });
  });

  it("always shows restricted answers even when they come from the confirmed vault", () => {
    const result = classifyField(
      definitions.get("authorization.us_authorized"),
      proposal({ fieldKey: "authorization.us_authorized", value: true, origin: "answer_vault" }),
    );
    expect(result.disposition).toBe("review");
    expect(result.reasons).toEqual(expect.arrayContaining(["restricted_answer", "never_infer"]));
    expect(result.usable).toBe(true);
  });

  it("never carries a never_infer answer that is not candidate supplied", () => {
    for (const origin of ["confirmed_fact", "derived", "generated"] as const) {
      const result = classifyField(
        definitions.get("authorization.us_authorized"),
        proposal({ fieldKey: "authorization.us_authorized", value: true, origin }),
      );
      expect(result).toMatchObject({ disposition: "user_action", usable: false });
    }
  });

  it("routes attestations, signatures, and challenges to direct candidate action", () => {
    for (const fieldKey of ["attestation.truthful", "signature.electronic", "captcha.token"]) {
      const result = classifyField(
        definitions.get(fieldKey),
        proposal({ fieldKey, value: true, origin: "derived" }),
      );
      expect(result.disposition).toBe("user_action");
      expect(result.reasons).toContain("direct_user_action");
    }
    const supplied = classifyField(
      definitions.get("attestation.truthful"),
      proposal({
        fieldKey: "attestation.truthful",
        value: true,
        origin: "user_entered",
        sourceFactIds: [],
      }),
    );
    expect(supplied.disposition).toBe("review");
  });

  it("refuses unsupported, unconfirmed, and unknown fields", () => {
    expect(classifyField(email, proposal({ sourceFactIds: [] })).reasons).toContain(
      "unsupported_value",
    );
    expect(classifyField(email, proposal({ sourceConfirmed: false })).reasons).toContain(
      "unconfirmed_source",
    );
    expect(classifyField(undefined, proposal({ fieldKey: "made.up" })).disposition).toBe(
      "user_action",
    );
  });

  it("flags low and non-numeric confidence for review", () => {
    expect(classifyField(email, proposal({ confidence: 0.5 })).disposition).toBe("review");
    expect(classifyField(email, proposal({ confidence: Number.NaN })).reasons).toContain(
      "low_confidence",
    );
  });

  it("requires review for generated content", () => {
    const result = classifyField(
      definitions.get("questions.why_company"),
      proposal({ fieldKey: "questions.why_company", value: "text", origin: "generated" }),
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(["generated_content", "explicit_each_time"]),
    );
  });
});

describe("packet assembly and hash", () => {
  it("is deterministic and independent of field order, id, and timestamp", () => {
    const fieldA = proposal();
    const fieldB = proposal({
      fieldKey: "job.remote_preference",
      value: "remote",
      sourceFactIds: [FACT_B],
    });
    const first = assemblePacket(packetInputs({ fields: [fieldA, fieldB] }), definitions);
    const second = assemblePacket(
      packetInputs({
        id: "0192f7c2-0000-7000-8000-0000000000ff",
        createdAt: new Date("2030-01-01T00:00:00Z"),
        fields: [fieldB, fieldA],
      }),
      definitions,
    );
    expect(first.packetHash).toBe(second.packetHash);
    expect(verifyPacketHash(first)).toBe(true);
  });

  it("changes when any bound input changes", () => {
    const base = assemblePacket(packetInputs(), definitions).packetHash;
    const variants = [
      packetInputs({ jobRevision: HASH_B }),
      packetInputs({
        form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_C },
      }),
      packetInputs({ artifactHashes: { resume: HASH_A } }),
      packetInputs({ artifactHashes: { resume: HASH_C, coverLetter: HASH_A } }),
      packetInputs({ version: 2 }),
      packetInputs({ fields: [proposal({ value: "other@example.test" })] }),
    ];
    for (const variant of variants) {
      expect(assemblePacket(variant, definitions).packetHash).not.toBe(base);
    }
  });

  it("removes values that fail policy or type validation instead of carrying them", () => {
    const packet = assemblePacket(
      packetInputs({
        fields: [
          proposal({
            fieldKey: "authorization.us_authorized",
            value: true,
            origin: "confirmed_fact",
          }),
          proposal({ fieldKey: "employment.start_date", value: "2026-02-31" }),
          proposal({ fieldKey: "job.remote_preference", value: "moon" }),
        ],
      }),
      definitions,
    );
    expect(packet.fields.every((field) => field.value === null)).toBe(true);
    expect(packet.fields.every((field) => field.disposition === "user_action")).toBe(true);
  });

  it("rejects duplicate keys, bad versions, and malformed hashes", () => {
    expect(() =>
      assemblePacket(packetInputs({ fields: [proposal(), proposal()] }), definitions),
    ).toThrow(PacketInvariantError);
    expect(() => assemblePacket(packetInputs({ version: 0 }), definitions)).toThrow(
      PacketInvariantError,
    );
    expect(() => assemblePacket(packetInputs({ jobRevision: "XYZ" }), definitions)).toThrow(
      PacketInvariantError,
    );
  });

  it("is frozen and detects tampering", () => {
    const packet = assemblePacket(packetInputs(), definitions);
    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(packet.fields[0])).toBe(true);
    const tampered = { ...packet, jobRevision: HASH_B };
    expect(verifyPacketHash(tampered)).toBe(false);
    expect(computePacketHash(packet)).toBe(packet.packetHash);
  });
});

describe("approval", () => {
  const reviewed = () =>
    assemblePacket(
      packetInputs({
        fields: [
          proposal(),
          proposal({
            fieldKey: "authorization.us_authorized",
            value: true,
            origin: "answer_vault",
          }),
        ],
      }),
      definitions,
    );

  it("requires every reviewable field, including restricted answers, to be acknowledged", () => {
    const packet = reviewed();
    expect(() =>
      approvePacket(
        packet,
        { packetHash: packet.packetHash, consentId: CONSENT_ID, acknowledgedFieldKeys: [] },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "UNACKNOWLEDGED_FIELD" }));
    const approval = approvePacket(
      packet,
      {
        packetHash: packet.packetHash,
        consentId: CONSENT_ID,
        acknowledgedFieldKeys: ["authorization.us_authorized"],
      },
      NOW,
    );
    expect(approval.expiresAt.getTime() - approval.approvedAt.getTime()).toBe(MAX_APPROVAL_AGE_MS);
  });

  it("refuses approval while a field still needs direct candidate action", () => {
    const packet = assemblePacket(
      packetInputs({
        fields: [proposal({ fieldKey: "attestation.truthful", value: true, origin: "derived" })],
      }),
      definitions,
    );
    expect(() =>
      approvePacket(
        packet,
        {
          packetHash: packet.packetHash,
          consentId: CONSENT_ID,
          acknowledgedFieldKeys: ["attestation.truthful"],
        },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "UNRESOLVED_FIELD" }));
  });

  it("refuses a stale hash or a tampered packet", () => {
    const packet = reviewed();
    expect(() =>
      approvePacket(
        packet,
        { packetHash: HASH_A, consentId: CONSENT_ID, acknowledgedFieldKeys: [] },
        NOW,
      ),
    ).toThrow(ApprovalRefusedError);
    expect(() =>
      approvePacket(
        { ...packet, jobRevision: HASH_B },
        {
          packetHash: packet.packetHash,
          consentId: CONSENT_ID,
          acknowledgedFieldKeys: ["authorization.us_authorized"],
        },
        NOW,
      ),
    ).toThrow(expect.objectContaining({ code: "PACKET_TAMPERED" }));
  });

  it("expires on any material job, form, artifact change or age", () => {
    const packet = reviewed();
    const approval = approvePacket(
      packet,
      {
        packetHash: packet.packetHash,
        consentId: CONSENT_ID,
        acknowledgedFieldKeys: ["authorization.us_authorized"],
      },
      NOW,
    );
    expect(evaluateApproval(packet, approval, current, NOW)).toEqual({ valid: true });
    const reasonsFor = (change: Partial<CurrentBindings>, at = NOW) => {
      const result = evaluateApproval(packet, approval, { ...current, ...change }, at);
      return result.valid ? [] : result.reasons;
    };
    expect(reasonsFor({ jobRevision: HASH_B })).toEqual(["job_changed"]);
    expect(reasonsFor({ formHash: HASH_A })).toEqual(["form_changed"]);
    expect(reasonsFor({ formHash: null })).toEqual(["form_changed"]);
    expect(reasonsFor({ resumeHash: HASH_A })).toEqual(["resume_changed"]);
    expect(reasonsFor({ coverLetterHash: HASH_A })).toEqual(["cover_letter_changed"]);
    expect(reasonsFor({}, new Date(NOW.getTime() + MAX_APPROVAL_AGE_MS))).toEqual([
      "approval_expired",
    ]);
  });
});
