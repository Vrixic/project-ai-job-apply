import { describe, expect, it } from "vitest";
import {
  ApprovalRefusedError,
  approvePacket,
  assemblePacket,
  computePacketHash,
  evaluateBindings,
  PacketInvariantError,
} from "./packet.js";
import { FactBackedPacketSource } from "./packet-source.js";
import { ApplicationsUnavailableError } from "./service.js";
import { StalePacketError } from "./store.js";
import {
  APPLICATION_ID,
  CONSENT_ID,
  definitions,
  FACT_A,
  HASH_A,
  HASH_B,
  HASH_C,
  JOB_ID,
  NOW,
  packetInputs,
  USER_ID,
} from "./test-support.js";
import { decodeVaultValue, type VaultCurrentReference, type VaultSelection } from "./vault.js";

const selection: VaultSelection = {
  id: FACT_A,
  version: 1,
  fieldKey: "authorization.us_authorized",
  context: "us",
  questionHash: HASH_A,
  meaningConfirmed: true,
};
const live: VaultCurrentReference = {
  id: FACT_A,
  version: 1,
  fieldKey: selection.fieldKey,
  context: selection.context,
  validUntilEpochMs: null,
};
const saved: VaultCurrentReference & { valueType: string; value: string } = {
  ...live,
  valueType: "boolean",
  value: "false",
};
const input = {
  ownerUserId: USER_ID,
  application: { id: APPLICATION_ID, canonicalJobId: JOB_ID } as never,
  userEntries: [],
  form: { adapterId: "greenhouse", variantId: "synthetic", formHash: HASH_B },
  vaultSelections: [selection],
};
function source(value = saved, enabled = true) {
  const reads: unknown[] = [];
  const packets = new FactBackedPacketSource({
    definitions,
    clock: () => NOW,
    facts: async () => [],
    jobRevision: async () => HASH_A,
    artifacts: async () => ({ resume: HASH_C }),
    ...(enabled
      ? {
          vault: {
            readSelectedValue: async (owner, reference) => {
              reads.push([owner, reference]);
              return value;
            },
            readCurrentReference: async () => live,
          },
        }
      : {}),
  });
  return { packets, reads };
}

async function selectedPacket() {
  const prepared = await source().packets.prepare(input);
  return assemblePacket(packetInputs({ ...prepared }), definitions);
}

describe("selected answers in immutable packets", () => {
  it("carries the exact saved boolean, version/context/question binding and always requires acknowledgement", async () => {
    const packet = await selectedPacket();
    expect(packet.fields).toHaveLength(1);
    expect(packet.fields[0]).toMatchObject({
      value: false,
      origin: "answer_vault",
      requiresReview: true,
      disposition: "review",
      vaultReference: {
        id: FACT_A,
        version: 1,
        context: "us",
        questionHash: HASH_A,
        meaningConfirmed: true,
        validUntilEpochMs: null,
      },
    });
    expect(() =>
      approvePacket(
        packet,
        { packetHash: packet.packetHash, consentId: CONSENT_ID, acknowledgedFieldKeys: [] },
        NOW,
      ),
    ).toThrow(ApprovalRefusedError);
    expect(
      approvePacket(
        packet,
        {
          packetHash: packet.packetHash,
          consentId: CONSENT_ID,
          acknowledgedFieldKeys: [selection.fieldKey],
        },
        NOW,
      ),
    ).toMatchObject({ packetHash: packet.packetHash });
  });

  it.each([
    { version: 2 },
    { context: "eu" },
    { questionHash: HASH_B },
    { validUntilEpochMs: NOW.getTime() + 1 },
  ])("binds every selected reference change into the hash (%s)", async (change) => {
    const packet = await selectedPacket();
    const changed = structuredClone(packet);
    const field = changed.fields[0];
    if (!field?.vaultReference) throw new Error("MissingSyntheticReference");
    Object.assign(field.vaultReference, change);
    expect(computePacketHash(changed)).not.toBe(packet.packetHash);
  });

  it("keeps the existing packet hash for packets without selected-answer metadata", () => {
    const packet = assemblePacket(packetInputs(), definitions);
    expect(packet.fields[0]).not.toHaveProperty("vaultReference");
    expect(computePacketHash(packet)).toBe(packet.packetHash);
  });

  it.each([
    { refs: undefined },
    { refs: [] },
    { refs: [{ ...live, version: 2 }] },
    { refs: [{ ...live, context: "eu" }] },
    { refs: [live, live] },
  ])("refuses missing, changed or ambiguous live reference receipts (%s)", async ({ refs }) => {
    const packet = await selectedPacket();
    const current = {
      jobRevision: HASH_A,
      formHash: HASH_B,
      resumeHash: HASH_C,
      ...(refs ? { vaultReferences: refs } : {}),
    };
    expect(evaluateBindings(packet, current, NOW)).toEqual(["vault_answer_changed"]);
  });

  it("checks the original expiry at admission, including the exact boundary and invalid clocks", async () => {
    const deadline = NOW.getTime() + 1;
    const prepared = await source({
      ...saved,
      validUntilEpochMs: deadline,
    } as typeof saved).packets.prepare(input);
    const packet = assemblePacket(packetInputs(prepared), definitions);
    const current = {
      jobRevision: HASH_A,
      formHash: HASH_B,
      resumeHash: HASH_C,
      vaultReferences: [{ ...live, validUntilEpochMs: deadline }],
    };
    expect(evaluateBindings(packet, current, NOW)).toEqual([]);
    expect(evaluateBindings(packet, current, new Date(deadline))).toEqual(["vault_answer_changed"]);
    expect(evaluateBindings(packet, current, new Date(Number.NaN))).toEqual([
      "vault_answer_changed",
    ]);
  });

  it.each([
    { form: null },
    { vaultSelections: [{ ...selection, meaningConfirmed: false }] },
    { vaultSelections: [selection, selection] },
    { vaultSelections: [{ ...selection, fieldKey: "attestation.truthful" }] },
    { vaultSelections: [{ ...selection, fieldKey: "job.remote_preference" }] },
    { userEntries: [{ fieldKey: selection.fieldKey, value: true }] },
  ])(
    "rejects invalid or conflicting candidate selections before private reads (%s)",
    async (patch) => {
      const { packets, reads } = source();
      await expect(
        packets.prepare({ ...input, ...patch } as unknown as typeof input),
      ).rejects.toBeInstanceOf(PacketInvariantError);
      expect(reads).toEqual([]);
    },
  );

  it("refuses reuse when the read capability is disabled", async () => {
    await expect(source(saved, false).packets.prepare(input)).rejects.toBeInstanceOf(
      ApplicationsUnavailableError,
    );
  });

  it("does not substitute a newer saved revision", async () => {
    await expect(source({ ...saved, version: 2 }).packets.prepare(input)).rejects.toBeInstanceOf(
      StalePacketError,
    );
  });

  it.each(["True", " false", "0", "yes"])("refuses a noncanonical boolean (%s)", async (value) => {
    await expect(source({ ...saved, value }).packets.prepare(input)).rejects.toBeInstanceOf(
      PacketInvariantError,
    );
  });

  it("decodes only the exact declared type and lossless canonical representation", () => {
    const def = definitions.get("job.salary_expectation");
    if (!def) throw new Error("MissingSyntheticDefinition");
    expect(decodeVaultValue(def, { valueType: "decimal", value: "1.5" })).toBe(1.5);
    for (const value of ["1.50", " 1.5", "Infinity", "9007199254740993"]) {
      expect(decodeVaultValue(def, { valueType: "decimal", value })).toBeUndefined();
    }
    expect(decodeVaultValue(def, { valueType: "string", value: "1.5" })).toBeUndefined();
  });
});
