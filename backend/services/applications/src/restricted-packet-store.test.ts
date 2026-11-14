import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { RestrictedPacketCipher } from "./restricted-packet-cipher.js";
import { PostgresApplicationStore, RestrictedPacketStoreUnavailableError } from "./store.js";
import {
  APPLICATION_ID,
  definitions,
  HASH_A,
  HASH_B,
  HASH_C,
  proposal,
  USER_ID,
} from "./test-support.js";

const keyArn = "arn:aws:kms:us-east-1:111111111111:key/11111111-1111-4111-8111-111111111111";
const base = {
  ownerUserId: USER_ID,
  applicationId: APPLICATION_ID,
  expectedRevision: 1,
  idempotencyKey: "synthetic-protection-key",
};
const packet = {
  jobRevision: HASH_A,
  form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
  artifactHashes: { resume: HASH_C },
  fields: [proposal()],
};
const request = {
  expectedRevision: 1,
  coverLetter: {
    disclosure: {
      noticeVersion: "bedrock-cover-letter.v1" as const,
      acknowledged: true as const,
    },
  },
};

describe("restricted packet store refuses unavailable protection", () => {
  it.each(["missing", "disabled", "invalid authority"])(
    "refuses all new packet/preparation work with %s configuration before SQL or crypto",
    async (kind) => {
      const query = vi.fn(() => {
        throw Error("Unexpected database access");
      });
      const begin = vi.fn(() => {
        throw Error("Unexpected transaction");
      });
      const client = Object.assign(query, { begin }) as unknown as postgres.Sql;
      const cipher: RestrictedPacketCipher = {
        encrypt: vi.fn(async () => {
          throw Error("Unexpected encryption");
        }),
        decrypt: vi.fn(async () => {
          throw Error("Unexpected decryption");
        }),
        fingerprint: vi.fn(async () => {
          throw Error("Unexpected MAC");
        }),
      };
      const store = new PostgresApplicationStore(client, undefined, {
        definitions,
        ...(kind === "missing"
          ? {}
          : {
              restrictedPackets: {
                cipher,
                fingerprintKeyArn: kind === "invalid authority" ? "alias/current" : keyArn,
                enabled: () => kind !== "disabled",
              },
            }),
      });
      await expect(store.createPacket({ ...base, packet })).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
      await expect(
        store.createPacket({
          ...base,
          packet: {
            ...packet,
            fields: [
              proposal({
                fieldKey: "authorization.us_authorized",
                value: true,
                origin: "user_entered",
                sourceFactIds: [],
              }),
            ],
          },
        }),
      ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
      await expect(store.replayPreparation({ ...base, request })).rejects.toThrow(
        RestrictedPacketStoreUnavailableError,
      );
      await expect(
        store.queuePreparation({
          ...base,
          request,
          packet,
          context: { jobContextHash: HASH_A, confirmedFactsHash: HASH_B },
        }),
      ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
      await expect(
        store.readCurrentPacketValues({ ...base, packetId: APPLICATION_ID, packetHash: HASH_A }),
      ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
      await expect(
        store.readExportPacketValues({
          ownerUserId: USER_ID,
          exportId: APPLICATION_ID,
          operationId: APPLICATION_ID,
          policyVersion: "synthetic-v1",
          applicationId: APPLICATION_ID,
          packetId: APPLICATION_ID,
          packetHash: HASH_A,
        }),
      ).rejects.toThrow(RestrictedPacketStoreUnavailableError);
      expect(query).not.toHaveBeenCalled();
      expect(begin).not.toHaveBeenCalled();
      expect(cipher.encrypt).not.toHaveBeenCalled();
      expect(cipher.decrypt).not.toHaveBeenCalled();
      expect(cipher.fingerprint).not.toHaveBeenCalled();
    },
  );
});
