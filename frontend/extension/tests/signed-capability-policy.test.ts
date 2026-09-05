import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SanitizedJobCapture } from "../lib/job-capture";
import {
  contributionCapabilityPolicyDigestInput,
  ContributionCapabilityPolicyTransportError,
  evaluateExtensionContributionCapability,
  ExtensionContributionPolicyRuntime,
  fetchSignedContributionCapabilityPolicy,
  type ExtensionContributionCapabilityPolicy,
  type SignedExtensionContributionCapabilityPolicy,
  verifySignedContributionCapabilityPolicy,
} from "../lib/signed-capability-policy";

const keyPair = generateKeyPairSync("ed25519");
const publicKeys = {
  "synthetic-key-v1": keyPair.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url"),
};

const basePolicy: ExtensionContributionCapabilityPolicy = {
  schemaVersion: 1,
  revision: "d2-synthetic-capability-v1",
  issuedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2026-09-02T12:00:00.000Z",
  intakeEnabled: true,
  processingEnabled: false,
  clients: { "0.2.0": true, "0.2.1": false },
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

const leverCapture: SanitizedJobCapture = {
  adapterVersion: "d2-job-page-v1",
  capturedAt: "2026-09-01T12:05:00.000Z",
  pageVariant: "lever-posting-v1",
  provider: "lever",
  sourceUrl: "https://jobs.lever.co/example/job",
  title: "Synthetic role",
};

function signed(
  payload: ExtensionContributionCapabilityPolicy = basePolicy,
): SignedExtensionContributionCapabilityPolicy {
  return {
    keyId: "synthetic-key-v1",
    payload,
    signature: sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(payload)),
      keyPair.privateKey,
    ).toString("base64url"),
  };
}

function response(envelope: unknown, overrides: ResponseInit = {}): Response {
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    ...overrides,
  });
}

class MemoryCache {
  value: unknown;

  async read(): Promise<unknown> {
    return structuredClone(this.value);
  }

  async remove(): Promise<void> {
    this.value = undefined;
  }

  async write(envelope: SignedExtensionContributionCapabilityPolicy): Promise<void> {
    this.value = structuredClone(envelope);
  }
}

describe("signed extension contribution capability policy", () => {
  it("verifies the server-compatible Ed25519 envelope and rejects tampering and unknown keys", async () => {
    const envelope = signed();
    await expect(verifySignedContributionCapabilityPolicy(envelope, publicKeys)).resolves.toEqual({
      envelope,
      policy: basePolicy,
    });
    await expect(
      verifySignedContributionCapabilityPolicy(
        { ...envelope, payload: { ...basePolicy, intakeEnabled: false } },
        publicKeys,
      ),
    ).rejects.toThrow(/signature/u);
    await expect(
      verifySignedContributionCapabilityPolicy(
        { ...envelope, keyId: "untrusted-key-v1" },
        publicKeys,
      ),
    ).rejects.toThrow(/unknown/u);
    await expect(
      verifySignedContributionCapabilityPolicy(
        { ...envelope, remoteCode: "https://attacker.example/script.js" },
        publicKeys,
      ),
    ).rejects.toThrow(/envelope/u);
  });

  it("rejects incomplete maps, unknown domains, noncanonical timestamps, and lifetimes over 24 hours", () => {
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...basePolicy,
        providers: { ashby: false, lever: true },
      }),
    ).toThrow(/incomplete/u);
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...basePolicy,
        domains: { ...basePolicy.domains, "attacker.example": true },
      }),
    ).toThrow(/incomplete/u);
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...basePolicy,
        issuedAt: "2026-09-01T12:00:00Z",
      }),
    ).toThrow(/timestamp/u);
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...basePolicy,
        expiresAt: "2026-09-02T12:00:00.001Z",
      }),
    ).toThrow(/lifetime/u);
    for (const version of ["01.2.3", "1234567.2.3", "1.2.3-abcdefghijklmnopq", "1.2.3-"]) {
      expect(() =>
        contributionCapabilityPolicyDigestInput({
          ...basePolicy,
          clients: { [version]: true },
        }),
      ).toThrow(/map/u);
    }
  });

  it("enforces global, exact client, provider, variant, and domain controls independently", () => {
    const now = new Date("2026-09-01T13:00:00.000Z");
    const decide = (
      policy: ExtensionContributionCapabilityPolicy,
      capture = leverCapture,
      clientVersion = "0.2.0",
    ) => evaluateExtensionContributionCapability(policy, { capture, clientVersion, now });

    expect(decide(basePolicy)).toEqual({
      allowed: true,
      policyRevision: "d2-synthetic-capability-v1",
    });
    expect(decide({ ...basePolicy, intakeEnabled: false })).toEqual({
      allowed: false,
      reason: "global_disabled",
    });
    expect(decide(basePolicy, leverCapture, "0.2.1")).toEqual({
      allowed: false,
      reason: "client_disabled",
    });
    expect(decide(basePolicy, { ...leverCapture, provider: "ashby" })).toEqual({
      allowed: false,
      reason: "provider_disabled",
    });
    expect(decide(basePolicy, { ...leverCapture, pageVariant: "greenhouse-board-v1" })).toEqual({
      allowed: false,
      reason: "variant_disabled",
    });
    expect(
      decide(basePolicy, {
        ...leverCapture,
        sourceUrl: "https://jobs.eu.lever.co/example/job",
      }),
    ).toEqual({ allowed: false, reason: "domain_disabled" });
    expect(
      evaluateExtensionContributionCapability(basePolicy, {
        capture: leverCapture,
        clientVersion: "0.2.0",
        now: new Date(basePolicy.issuedAt),
      }).allowed,
    ).toBe(true);
    expect(
      evaluateExtensionContributionCapability(basePolicy, {
        capture: leverCapture,
        clientVersion: "0.2.0",
        now: new Date(basePolicy.expiresAt),
      }),
    ).toEqual({ allowed: false, reason: "policy_expired" });
  });

  it("uses only an exact bounded no-store JSON fetch", async () => {
    const fetcher = vi.fn(async () => response(signed()));
    await expect(
      fetchSignedContributionCapabilityPolicy("https://api.example.test", fetcher),
    ).resolves.toEqual(signed());
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.example.test/v1/extension/contribution-capability-policy"),
      {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
    await expect(
      fetchSignedContributionCapabilityPolicy("https://api.example.test", async () =>
        response(signed(), { headers: { "content-type": "application/json" } }),
      ),
    ).rejects.toThrow(/response/u);
    await expect(
      fetchSignedContributionCapabilityPolicy(
        "https://api.example.test",
        async () =>
          new Response("x".repeat(64 * 1_024 + 1), {
            status: 200,
            headers: { "cache-control": "no-store", "content-type": "application/json" },
          }),
      ),
    ).rejects.toThrow(/large/u);
    await expect(
      fetchSignedContributionCapabilityPolicy("https://api.example.test", async () => {
        throw new TypeError("network unavailable");
      }),
    ).rejects.toBeInstanceOf(ContributionCapabilityPolicyTransportError);
    for (const status of [408, 425, 429, 500, 503]) {
      await expect(
        fetchSignedContributionCapabilityPolicy(
          "https://api.example.test",
          async () => new Response(null, { status }),
        ),
      ).rejects.toBeInstanceOf(ContributionCapabilityPolicyTransportError);
    }
    await expect(
      fetchSignedContributionCapabilityPolicy(
        "https://api.example.test",
        async () => new Response(null, { status: 410 }),
      ),
    ).rejects.not.toBeInstanceOf(ContributionCapabilityPolicyTransportError);
  });

  it("re-verifies a current signed cache across restart and bounded offline refresh", async () => {
    const cache = new MemoryCache();
    const first = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => signed());
    await expect(first.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(true);
    expect(first.decision(leverCapture, "0.2.0", new Date("2026-09-01T13:00:00.000Z"))).toEqual({
      allowed: true,
      policyRevision: basePolicy.revision,
    });

    const restarted = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => {
      throw new ContributionCapabilityPolicyTransportError();
    });
    await expect(restarted.restore(new Date("2026-09-01T13:05:00.000Z"))).resolves.toBe(true);
    expect(
      restarted.decision(leverCapture, "0.2.0", new Date("2026-09-01T13:05:00.000Z")).allowed,
    ).toBe(true);
    await expect(restarted.refresh(new Date("2026-09-01T13:05:00.000Z"))).resolves.toBe(true);
    expect(restarted.decision(leverCapture, "0.2.0", new Date("2026-09-01T13:05:00.000Z"))).toEqual(
      { allowed: true, policyRevision: basePolicy.revision },
    );
    expect(cache.value).toEqual(signed());
  });

  it("fails closed when an offline restart has only an expired cache", async () => {
    const cache = new MemoryCache();
    cache.value = signed();
    const runtime = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => {
      throw new ContributionCapabilityPolicyTransportError();
    });
    await expect(runtime.start(new Date("2026-09-02T12:00:00.000Z"))).resolves.toBe(false);
    expect(runtime.decision(leverCapture, "0.2.0")).toEqual({
      allowed: false,
      reason: "policy_missing",
    });
    expect(cache.value).toBeUndefined();
  });

  it("retains current cache on transient HTTP failure but clears on deliberate absence", async () => {
    const cache = new MemoryCache();
    cache.value = signed();
    const unavailable = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () =>
      fetchSignedContributionCapabilityPolicy(
        "https://api.example.test",
        async () => new Response(null, { status: 503 }),
      ),
    );
    await expect(unavailable.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(true);
    expect(
      unavailable.decision(leverCapture, "0.2.0", new Date("2026-09-01T13:00:00.000Z")),
    ).toEqual({ allowed: true, policyRevision: basePolicy.revision });

    const removed = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () =>
      fetchSignedContributionCapabilityPolicy(
        "https://api.example.test",
        async () => new Response(null, { status: 410 }),
      ),
    );
    await expect(removed.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(false);
    expect(removed.decision(leverCapture, "0.2.0")).toEqual({
      allowed: false,
      reason: "policy_missing",
    });
    expect(cache.value).toBeUndefined();
  });

  it("applies a signed update and lets a received invalid policy override valid cache", async () => {
    const cache = new MemoryCache();
    cache.value = signed();
    const disabled = {
      ...basePolicy,
      revision: "d2-synthetic-capability-v2",
      issuedAt: "2026-09-01T12:30:00.000Z",
      expiresAt: "2026-09-02T12:30:00.000Z",
      domains: { ...basePolicy.domains, "jobs.lever.co": false },
    };
    const runtime = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () =>
      signed(disabled),
    );
    await expect(runtime.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(true);
    expect(runtime.decision(leverCapture, "0.2.0", new Date("2026-09-01T13:00:00.000Z"))).toEqual({
      allowed: false,
      reason: "domain_disabled",
    });

    cache.value = signed();
    const tampered = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => ({
      ...signed(),
      signature: "A".repeat(86),
    }));
    await expect(tampered.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(false);
    expect(cache.value).toBeUndefined();
  });

  it("denies a signed rollback or same-issued-at policy fork", async () => {
    const cache = new MemoryCache();
    const newer = {
      ...basePolicy,
      revision: "d2-synthetic-capability-v2",
      issuedAt: "2026-09-01T12:30:00.000Z",
      expiresAt: "2026-09-02T12:30:00.000Z",
    };
    const runtime = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () =>
      signed(newer),
    );
    await expect(runtime.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(true);
    const older = signed(basePolicy);
    const rollback = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => older);
    await expect(rollback.restore(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(true);
    await expect(rollback.refresh(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(false);
    expect(rollback.decision(leverCapture, "0.2.0")).toEqual({
      allowed: false,
      reason: "policy_missing",
    });

    cache.value = signed(newer);
    const forked = {
      ...newer,
      revision: "d2-synthetic-capability-fork",
      intakeEnabled: false,
    };
    const fork = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () =>
      signed(forked),
    );
    await expect(fork.start(new Date("2026-09-01T13:00:00.000Z"))).resolves.toBe(false);
    expect(cache.value).toBeUndefined();
  });

  it("bounds a stalled policy request and its response body to ten seconds", async () => {
    vi.useFakeTimers();
    try {
      for (const stalledBody of [false, true]) {
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          if (stalledBody) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
                },
              }),
              {
                headers: { "cache-control": "no-store", "content-type": "application/json" },
              },
            );
          }
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        });
        const request = fetchSignedContributionCapabilityPolicy(
          "https://api.example.test",
          fetcher,
        );
        const result = expect(request).rejects.toBeInstanceOf(
          ContributionCapabilityPolicyTransportError,
        );
        await vi.advanceTimersByTimeAsync(9_999);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await result;
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces readiness and delivery refreshes and bounds readiness requests without polling", async () => {
    const cache = new MemoryCache();
    const fetcher = vi.fn<() => Promise<unknown>>(async () => signed());
    const runtime = new ExtensionContributionPolicyRuntime(publicKeys, cache, fetcher);
    const firstCheck = new Date("2026-09-01T13:00:00.000Z");
    await runtime.start(firstCheck);
    await Promise.all(Array.from({ length: 20 }, () => runtime.refreshForReadiness(firstCheck)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await runtime.refreshForReadiness(new Date(firstCheck.getTime() + 14_999));
    expect(fetcher).toHaveBeenCalledTimes(1);

    let finishFetch!: (envelope: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFetch = resolve;
        }),
    );
    const nextCheck = new Date(firstCheck.getTime() + 15_000);
    const checks = Array.from({ length: 20 }, () => runtime.refreshForReadiness(nextCheck));
    const delivery = runtime.refresh(nextCheck);
    expect(fetcher).toHaveBeenCalledTimes(2);
    finishFetch(signed());
    await expect(Promise.all([...checks, delivery])).resolves.toEqual(Array(21).fill(true));
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Cooldown does not grant validity, and reading the decision never starts network work.
    expect(runtime.decision(leverCapture, "0.2.0", new Date(basePolicy.expiresAt))).toEqual({
      allowed: false,
      reason: "policy_expired",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the rollback floor after invalidation during repeated readiness refresh", async () => {
    const cache = new MemoryCache();
    const newer = { ...basePolicy, issuedAt: "2026-09-01T12:30:00.000Z", revision: "renewed-v2" };
    let envelope: unknown = signed(newer);
    const runtime = new ExtensionContributionPolicyRuntime(publicKeys, cache, async () => envelope);
    await runtime.start(new Date("2026-09-01T13:00:00.000Z"));
    envelope = { ...signed(newer), signature: "A".repeat(86) };
    await expect(runtime.refreshForReadiness(new Date("2026-09-01T13:01:00.000Z"))).resolves.toBe(
      false,
    );
    envelope = signed();
    await expect(runtime.refreshForReadiness(new Date("2026-09-01T13:02:00.000Z"))).resolves.toBe(
      false,
    );
    envelope = signed({ ...newer, revision: "forked-v2" });
    await expect(runtime.refreshForReadiness(new Date("2026-09-01T13:03:00.000Z"))).resolves.toBe(
      false,
    );
    expect(cache.value).toBeUndefined();
    expect(runtime.decision(leverCapture, "0.2.0")).toEqual({
      allowed: false,
      reason: "policy_missing",
    });
    envelope = signed({ ...newer, issuedAt: "2026-09-01T13:03:00.000Z", revision: "renewed-v3" });
    await expect(runtime.refreshForReadiness(new Date("2026-09-01T13:04:00.000Z"))).resolves.toBe(
      true,
    );
  });
});
