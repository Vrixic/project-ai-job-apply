import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { assemblePacket, computePacketHash, verifyPacketHash } from "./packet.js";
import type { RestrictedPacketPlaintext } from "./restricted-packet-cipher.js";
import { ApplicationsUnavailableError, toApiApplication } from "./service.js";
import type { ApplicationView } from "./store.js";
import {
  APPLICATION_ID,
  definitions,
  FACT_A,
  HASH_A,
  HASH_B,
  JOB_ID,
  NOW,
  PACKET_ID,
  packetInputs,
  proposal,
  USER_ID,
} from "./test-support.js";

function fixture() {
  const original = assemblePacket(
    packetInputs({
      fields: [
        proposal(),
        proposal({
          fieldKey: "authorization.us_authorized",
          value: true,
          origin: "user_entered",
          sourceFactIds: [],
        }),
      ],
    }),
    definitions,
  );
  const content = {
    ...original,
    fields: original.fields.map((field) =>
      field.fieldKey === "authorization.us_authorized"
        ? { ...field, value: null, protectedValue: true as const }
        : field,
    ),
    restrictedValues: { id: PACKET_ID, metadataSha256: HASH_A, ciphertextSha256: HASH_B },
  };
  const packet = { ...content, packetHash: computePacketHash(content) };
  const view: ApplicationView = {
    application: {
      id: APPLICATION_ID,
      ownerUserId: USER_ID,
      canonicalJobId: JOB_ID,
      revision: 2,
      status: "review_required",
      currentPacketId: packet.id,
      createdAt: NOW,
      updatedAt: NOW,
    },
    currentPacket: packet,
    approval: null,
    attempts: [],
    currentAction: "review_and_approve",
  };
  const plaintext: RestrictedPacketPlaintext = {
    ownerUserId: USER_ID,
    applicationId: APPLICATION_ID,
    packetId: packet.id,
    packetHash: packet.packetHash,
    values: new Map([["authorization.us_authorized", true]]),
  };
  return { view, plaintext, packet };
}
const validate = compileComponentValidator("Application");
describe("immediate restricted packet public projection", () => {
  it("returns exact owner values through the existing strict API shape and retains metadata-only hashing", () => {
    const { view, plaintext, packet } = fixture();
    const api = toApiApplication(view, plaintext);
    expect(validate(api), JSON.stringify(validate.errors)).toBe(true);
    expect(
      api.currentPacket?.fields.find((field) => field.fieldKey === "authorization.us_authorized")
        ?.value,
    ).toBe(true);
    expect(
      api.currentPacket?.fields.find((field) => field.fieldKey === "contact.email")?.value,
    ).toBe("candidate@example.test");
    expect(JSON.stringify(api)).not.toContain("protectedValue");
    expect(JSON.stringify(api)).not.toContain("restrictedValues");
    expect(JSON.stringify(api)).not.toContain("ciphertextSha256");
    expect(packet.fields.find((field) => field.protectedValue)?.value).toBeNull();
    expect(verifyPacketHash(packet)).toBe(true);
  });
  it("fails unavailable when an exact restricted reader has not been composed", () => {
    expect(() => toApiApplication(fixture().view)).toThrow(ApplicationsUnavailableError);
  });
  it.each(["ownerUserId", "applicationId", "packetId", "packetHash"] as const)(
    "refuses a plaintext map moved from another %s",
    (field) => {
      const { view, plaintext } = fixture();
      plaintext[field] = field === "packetHash" ? HASH_A : FACT_A;
      expect(() => toApiApplication(view, plaintext)).toThrow(ApplicationsUnavailableError);
    },
  );
  it.each(["owner", "application", "current packet", "packet hash"])(
    "refuses inconsistent source view: %s",
    (kind) => {
      const { view, plaintext, packet } = fixture();
      if (kind === "owner") view.application.ownerUserId = FACT_A;
      if (kind === "application") view.application.id = FACT_A;
      if (kind === "current packet") view.application.currentPacketId = FACT_A;
      if (kind === "packet hash") packet.packetHash = HASH_A;
      expect(() => toApiApplication(view, plaintext)).toThrow(ApplicationsUnavailableError);
    },
  );
  it.each(["missing", "extra", "null", "nonfinite", "object"])(
    "refuses incomplete or unsafe immediate values: %s",
    (kind) => {
      const { view, plaintext } = fixture();
      const values = new Map(plaintext.values);
      if (kind === "missing") values.clear();
      if (kind === "extra") values.set("contact.email", "extra@example.test");
      if (kind === "null") values.set("authorization.us_authorized", null);
      if (kind === "nonfinite") values.set("authorization.us_authorized", Number.NaN);
      if (kind === "object")
        Object.assign(plaintext, {
          values: new Map([["authorization.us_authorized", { rawBody: "synthetic" }]]),
        });
      else plaintext.values = values;
      expect(() => toApiApplication(view, plaintext)).toThrow(ApplicationsUnavailableError);
    },
  );
  it("keeps ordinary projections compatible and rejects unsolicited restricted values", () => {
    const { view, plaintext } = fixture();
    const packet = assemblePacket(packetInputs(), definitions);
    view.currentPacket = packet;
    expect(validate(toApiApplication(view)), JSON.stringify(validate.errors)).toBe(true);
    expect(() => toApiApplication(view, plaintext)).toThrow(ApplicationsUnavailableError);
  });
});
