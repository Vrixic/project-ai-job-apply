import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contributionCapabilityPolicyDigestInput,
  type D2ContributionCapabilityPolicy,
  type SignedD2ContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  ConfiguredContributionCapabilityPolicySource,
  ContributionCapabilityPolicySourceUnavailableError,
  contributionCapabilityPolicySourceFromEnvironment,
} from "./contribution-capability-policy-source.js";

const now = new Date("2026-09-02T12:00:00.000Z");

function policy(input: {
  revision: string;
  issuedAt: string;
  expiresAt: string;
}): D2ContributionCapabilityPolicy {
  return {
    schemaVersion: 1,
    ...input,
    intakeEnabled: true,
    processingEnabled: true,
    clients: { "0.2.0": true },
    providers: { ashby: false, greenhouse: false, lever: true },
    variants: {
      "ashby-job-board-v1": false,
      "greenhouse-board-v1": false,
      "lever-posting-v1": true,
    },
    domains: {
      "boards.greenhouse.io": false,
      "job-boards.greenhouse.io": false,
      "jobs.ashbyhq.com": false,
      "jobs.eu.lever.co": false,
      "jobs.lever.co": true,
    },
  };
}

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
  const createEnvelope = (
    payload: D2ContributionCapabilityPolicy,
    keyId = "synthetic-key-v1",
  ): SignedD2ContributionCapabilityPolicy => ({
    keyId,
    payload,
    signature: sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(payload)),
      keys.privateKey,
    ).toString("base64url"),
  });
  return { createEnvelope, publicKeys: { "synthetic-key-v1": publicKey } };
}

describe("configured contribution capability policy source", () => {
  it("serves one verified envelope to public discovery and both structural private loaders", async () => {
    const { createEnvelope, publicKeys } = fixture();
    const envelope = createEnvelope(
      policy({
        revision: "synthetic-revision-1",
        issuedAt: "2026-09-02T11:00:00.000Z",
        expiresAt: "2026-09-02T13:00:00.000Z",
      }),
    );
    const source = new ConfiguredContributionCapabilityPolicySource({
      readEnvelope: async () => envelope,
      publicKeys,
      now: () => now,
    });

    expect(await source.readPublicEnvelope()).toEqual(envelope);
    expect(await source.load()).toEqual({ envelope, publicKeys });
  });

  it("fails closed for absence, malformed signatures, unknown keys, stale, and future policy", async () => {
    const { createEnvelope, publicKeys } = fixture();
    const valid = policy({
      revision: "synthetic-revision-1",
      issuedAt: "2026-09-02T11:00:00.000Z",
      expiresAt: "2026-09-02T13:00:00.000Z",
    });
    const source = (envelope: unknown | null) =>
      new ConfiguredContributionCapabilityPolicySource({
        readEnvelope: async () => envelope,
        publicKeys,
        now: () => now,
      });

    await expect(source(null).load()).resolves.toBeNull();
    await expect(
      source({ ...createEnvelope(valid), signature: "a".repeat(86) }).load(),
    ).rejects.toBeInstanceOf(ContributionCapabilityPolicySourceUnavailableError);
    await expect(source(createEnvelope(valid, "unknown-key-v1")).load()).rejects.toBeInstanceOf(
      ContributionCapabilityPolicySourceUnavailableError,
    );
    await expect(
      source(
        createEnvelope(
          policy({
            revision: "synthetic-stale-1",
            issuedAt: "2026-09-02T10:00:00.000Z",
            expiresAt: now.toISOString(),
          }),
        ),
      ).load(),
    ).rejects.toBeInstanceOf(ContributionCapabilityPolicySourceUnavailableError);
    await expect(
      source(
        createEnvelope(
          policy({
            revision: "synthetic-future-1",
            issuedAt: "2026-09-02T12:00:00.001Z",
            expiresAt: "2026-09-02T13:00:00.001Z",
          }),
        ),
      ).load(),
    ).rejects.toBeInstanceOf(ContributionCapabilityPolicySourceUnavailableError);
  });

  it("rejects process-local rollback, same-time forks, and revision reuse", async () => {
    const { createEnvelope, publicKeys } = fixture();
    let candidate = createEnvelope(
      policy({
        revision: "synthetic-revision-1",
        issuedAt: "2026-09-02T11:00:00.000Z",
        expiresAt: "2026-09-02T13:00:00.000Z",
      }),
    );
    const source = new ConfiguredContributionCapabilityPolicySource({
      readEnvelope: async () => candidate,
      publicKeys,
      now: () => now,
    });
    await source.load();

    candidate = createEnvelope(
      policy({
        revision: "synthetic-revision-0",
        issuedAt: "2026-09-02T10:59:59.999Z",
        expiresAt: "2026-09-02T13:00:00.000Z",
      }),
    );
    await expect(source.load()).rejects.toBeInstanceOf(
      ContributionCapabilityPolicySourceUnavailableError,
    );

    candidate = createEnvelope(
      policy({
        revision: "synthetic-revision-fork",
        issuedAt: "2026-09-02T11:00:00.000Z",
        expiresAt: "2026-09-02T13:00:00.000Z",
      }),
    );
    await expect(source.load()).rejects.toBeInstanceOf(
      ContributionCapabilityPolicySourceUnavailableError,
    );

    candidate = createEnvelope(
      policy({
        revision: "synthetic-revision-1",
        issuedAt: "2026-09-02T11:30:00.000Z",
        expiresAt: "2026-09-02T13:00:00.000Z",
      }),
    );
    await expect(source.load()).rejects.toBeInstanceOf(
      ContributionCapabilityPolicySourceUnavailableError,
    );
  });

  it("has no live environment default and rejects partial or private-key configuration", () => {
    expect(contributionCapabilityPolicySourceFromEnvironment({}, () => now)).toBeNull();
    expect(() =>
      contributionCapabilityPolicySourceFromEnvironment(
        { JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: "{}" },
        () => now,
      ),
    ).toThrow(ContributionCapabilityPolicySourceUnavailableError);
    expect(
      () =>
        new ConfiguredContributionCapabilityPolicySource({
          readEnvelope: async () => null,
          publicKeys: { "synthetic-key-v1": "-----BEGIN PRIVATE KEY-----\nsecret" },
          now: () => now,
        }),
    ).toThrow(ContributionCapabilityPolicySourceUnavailableError);
  });
});
