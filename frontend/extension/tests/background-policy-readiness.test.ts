import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRIBUTION_RECEIPTS_KEY } from "../lib/contribution-receipts";
import type { SanitizedJobCapture } from "../lib/job-capture";
import {
  createPendingIntent,
  fenceMismatchedIntent,
  PENDING_QUEUE_KEY,
} from "../lib/pending-queue";
import {
  contributionCapabilityPolicyDigestInput,
  type ExtensionContributionCapabilityPolicy,
} from "../lib/signed-capability-policy";

const identityFence = "a".repeat(43);
vi.mock("../lib/protocol", () => ({
  authenticatedApiSession: vi.fn(async () => ({
    accessToken: "synthetic-token",
    identityFence: "a".repeat(43),
  })),
  authenticationStatus: vi.fn(async () => ({
    configured: true,
    authenticated: true,
    apiConfigured: true,
    refreshAvailable: false,
  })),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
}));

const keys = generateKeyPairSync("ed25519");
const now = "2026-09-05T12:00:20.000Z";
const policy: ExtensionContributionCapabilityPolicy = {
  schemaVersion: 1,
  revision: "warm-worker-v1",
  issuedAt: "2026-09-05T12:00:00.000Z",
  expiresAt: "2026-09-05T12:01:00.000Z",
  intakeEnabled: true,
  processingEnabled: true,
  clients: { "0.2.0": true },
  providers: { ashby: false, greenhouse: true, lever: false },
  variants: { "ashby-job-board-v1": false, "greenhouse-board-v1": true, "lever-posting-v1": false },
  domains: {
    "boards.greenhouse.io": true,
    "job-boards.greenhouse.io": true,
    "jobs.ashbyhq.com": false,
    "jobs.eu.lever.co": false,
    "jobs.lever.co": false,
  },
};
const capture: SanitizedJobCapture = {
  adapterVersion: "d2-job-page-v1",
  capturedAt: now,
  pageVariant: "greenhouse-board-v1",
  provider: "greenhouse",
  sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
  title: "Synthetic role",
};

function signed(payload = policy) {
  return {
    keyId: "synthetic-key-v1",
    payload,
    signature: sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(payload)),
      keys.privateKey,
    ).toString("base64url"),
  };
}

function response(envelope: unknown, status = 200) {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise not initialized");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function contributionResponse(url: URL | RequestInfo, init?: RequestInit): Response {
  if (String(url).endsWith("/ugc-contribution-consents")) {
    return response(
      {
        documentVersion: "ugc-contribution-preview.v1",
        grantedAt: now,
        id: "01991000-0000-7000-8000-000000000009",
        policyVersion: "synthetic-policy-v1",
        schemaVersion: 1,
        state: "granted",
      },
      201,
    );
  }
  const body = JSON.parse(String(init?.body));
  return response(
    { id: body.contributionId, state: "queued", submittedAt: now, updatedAt: now },
    202,
  );
}

const ownerContributionId = "01991000-0000-7000-8000-000000000001";
function trustResponse(version: number, state = "needs_review", updatedAt = now) {
  return {
    id: "01991000-0000-7000-8000-000000000007",
    contributionId: ownerContributionId,
    state,
    policyVersion: "synthetic-policy-v1",
    version,
    appealed: false,
    createdAt: now,
    updatedAt,
  };
}

interface BackgroundResponse {
  ok: boolean;
  error?: string;
  ownerAction?: string;
  delivery: { contribution: { ready: boolean; reason: string } };
  queue: { blocked: number; pending: number; stopped: number };
  receipts: { contributionId: string }[];
}

function storageArea(records: Map<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(records.get(key)) })),
    set: vi.fn(async (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) records.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    setAccessLevel: vi.fn(async () => undefined),
  };
}

async function background(
  fetcher: typeof fetch,
  development = false,
  configuration: { providers?: unknown; capture?: SanitizedJobCapture; detector?: unknown } = {},
) {
  const currentCapture = configuration.capture ?? capture;
  vi.stubGlobal("__DEVELOPMENT_CONTRIBUTIONS__", development);
  vi.stubGlobal("__DEVELOPMENT_CONTRIBUTION_PROVIDERS__", configuration.providers);
  vi.stubGlobal(
    "__DETECTOR_ACTIVATION_POLICY__",
    configuration.detector ?? {
      schemaVersion: 1,
      revision: "synthetic-detector-v1",
      extensionVersion: "0.2.0",
      enabledProviders: policy.providers,
      enabledVariants: policy.variants,
      enabledDomains: policy.domains,
    },
  );
  vi.stubGlobal("__AUTH0_AUDIENCE__", "ai-job-apply-api");
  vi.stubGlobal("__AUTH0_CLIENT_ID__", "synthetic-native-client");
  vi.stubGlobal("__AUTH0_DOMAIN__", "tenant.example.test");
  vi.stubGlobal("__EXTENSION_API_ORIGIN__", "https://api.example.test");
  vi.stubGlobal("__PENDING_RETENTION_MILLISECONDS__", 86_400_000);
  vi.stubGlobal(
    "__CAPABILITY_POLICY_PUBLIC_KEYS__",
    development
      ? {}
      : {
          "synthetic-key-v1": keys.publicKey
            .export({ format: "der", type: "spki" })
            .toString("base64url"),
        },
  );
  vi.stubGlobal("__UGC_CONTRIBUTION_POLICY_VERSION__", "synthetic-policy-v1");
  vi.stubGlobal("fetch", fetcher);

  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>([
    ["d2LastJobCaptureV1", { capture: currentCapture, tabId: 7, tabUrl: currentCapture.sourceUrl }],
  ]);
  const queued = createPendingIntent({
    approvedFields: ["title"],
    capture: currentCapture,
    identityFence,
    intent: "contribute",
    retentionMilliseconds: 86_400_000,
  });
  local.set(PENDING_QUEUE_KEY, [
    queued,
    fenceMismatchedIntent({ ...queued, identityFence: "b".repeat(43) }),
  ]);
  const receipt = {
    contributionId: "01991000-0000-7000-8000-000000000001",
    identityFence,
    state: "awaiting_independent_verification",
    submittedAt: now,
    updatedAt: now,
  };
  local.set(CONTRIBUTION_RECEIPTS_KEY, [
    receipt,
    {
      ...receipt,
      contributionId: "01991000-0000-7000-8000-000000000002",
      identityFence: "b".repeat(43),
    },
  ]);
  const originalQueue = structuredClone(local.get(PENDING_QUEUE_KEY));
  const originalReceipts = structuredClone(local.get(CONTRIBUTION_RECEIPTS_KEY));
  let messageListener!: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: BackgroundResponse) => void,
  ) => boolean;
  const browser = {
    runtime: {
      id: "synthetic-extension",
      getManifest: () => ({ version: "0.2.0" }),
      getURL: (path: string) => `chrome-extension://synthetic-extension/${path}`,
      onMessage: {
        addListener: vi.fn((listener: typeof messageListener) => {
          messageListener = listener;
        }),
      },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    storage: { local: storageArea(local), session: storageArea(session) },
    tabs: { query: vi.fn(async () => [{ id: 7, url: currentCapture.sourceUrl }]) },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true), onAlarm: { addListener: vi.fn() } },
  };
  vi.stubGlobal("chrome", browser);
  await import("../entrypoints/background");
  return {
    local,
    session,
    originalQueue,
    originalReceipts,
    browser,
    send: (message: unknown) =>
      new Promise<BackgroundResponse>((resolve) => {
        messageListener(
          message,
          { id: browser.runtime.id, url: browser.runtime.getURL("popup.html") },
          resolve,
        );
      }),
    status: () =>
      new Promise<BackgroundResponse>((resolve) => {
        messageListener(
          { action: "status" },
          { id: browser.runtime.id, url: browser.runtime.getURL("popup.html") },
          resolve,
        );
      }),
  };
}

describe("warm background worker signed-policy readiness", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const api = await import("../lib/protocol");
    vi.mocked(api.login).mockReset();
    vi.mocked(api.logout).mockReset();
    vi.mocked(api.refresh).mockReset();
    vi.mocked(api.authenticatedApiSession).mockReset().mockResolvedValue({
      accessToken: "synthetic-token",
      identityFence,
    });
    vi.mocked(api.authenticationStatus).mockReset().mockResolvedValue({
      configured: true,
      authenticated: true,
      apiConfigured: true,
      refreshAvailable: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("refuses oversized selected UTF-8 fields before queue persistence or consent and keeps the preview", async () => {
    const fullDescription = "漢".repeat(50_000);
    const fetcher = vi.fn<typeof fetch>(async (url, init) => contributionResponse(url, init));
    const worker = await background(fetcher, true, {
      capture: { ...capture, description: fullDescription },
    });
    const result = await worker.send({
      action: "enqueue",
      intent: "contribute",
      approvedFields: ["description"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Selected fields exceed the 64 KiB delivery limit. Deselect Description or another optional field, then add the job again. No shortened text was shared.",
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(worker.session.get("d2LastJobCaptureV1")).toMatchObject({
      capture: { description: fullDescription },
    });
    const retryWithSelectedFields = await worker.send({
      action: "enqueue",
      intent: "contribute",
      approvedFields: [],
    });
    expect(retryWithSelectedFields.ok).toBe(true);
    expect(fetcher).toHaveBeenCalled();
    for (const [, init] of fetcher.mock.calls) {
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("posting.description");
    }
    expect(worker.session.get("d2LastJobCaptureV1")).toMatchObject({
      capture: { description: fullDescription },
    });
  });

  it("stops an already queued oversized intent without modifying its selected payload or retrying HTTP", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const worker = await background(fetcher, true);
    const oversized = createPendingIntent({
      approvedFields: ["description"],
      capture: { ...capture, description: "漢".repeat(50_000) },
      identityFence,
      intent: "contribute",
      retentionMilliseconds: 86_400_000,
    });
    worker.local.set(PENDING_QUEUE_KEY, [oversized]);
    const result = await worker.send({ action: "retry" });
    expect(result.queue).toMatchObject({ pending: 0, stopped: 1 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual([
      { ...oversized, attempt: 1, state: "terminal", lastError: "request_too_large" },
    ]);
  });

  it.each([
    ["greenhouse", "greenhouse-board-v1", "boards.greenhouse.io"],
    ["greenhouse", "greenhouse-board-v1", "job-boards.greenhouse.io"],
    ["lever", "lever-posting-v1", "jobs.lever.co"],
    ["lever", "lever-posting-v1", "jobs.eu.lever.co"],
    ["ashby", "ashby-job-board-v1", "jobs.ashbyhq.com"],
  ] as const)(
    "wires exact build selection into %s %s %s delivery without policy calls",
    async (provider, pageVariant, domain) => {
      const currentCapture: SanitizedJobCapture = {
        ...capture,
        provider,
        pageVariant,
        sourceUrl: `https://${domain}/synthetic${provider === "greenhouse" ? "/jobs" : ""}/123`,
      };
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).endsWith("/ugc-contribution-consents")) {
          return response(
            {
              documentVersion: "ugc-contribution-preview.v1",
              grantedAt: now,
              id: "01991000-0000-7000-8000-000000000009",
              policyVersion: "synthetic-policy-v1",
              schemaVersion: 1,
              state: "granted",
            },
            201,
          );
        }
        if (String(url).endsWith("/jobs/contributions")) {
          return response(
            { id: body.contributionId, state: "queued", submittedAt: now, updatedAt: now },
            202,
          );
        }
        throw new Error("Unexpected request");
      });
      const worker = await background(fetcher, true, {
        providers: [provider],
        capture: currentCapture,
        detector: {
          schemaVersion: 1,
          revision: "synthetic-provider-v1",
          extensionVersion: "0.2.0",
          enabledProviders: { ...policy.providers, [provider]: true },
          enabledVariants: { ...policy.variants, [pageVariant]: true },
          enabledDomains: { ...policy.domains, [domain]: true },
        },
      });
      expect((await worker.status()).delivery.contribution.ready).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      const result = await worker.send({ action: "retry" });
      expect(result.queue).toMatchObject({ pending: 0, stopped: 0, blocked: 1 });
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        "https://api.example.test/v1/profile/ugc-contribution-consents",
        "https://api.example.test/v1/jobs/contributions",
      ]);
      const contribution = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
      expect(contribution.source).toMatchObject({
        provider,
        pageVariant,
        sourceUrl: currentCapture.sourceUrl,
      });
      expect(worker.browser.storage.local.get).not.toHaveBeenCalledWith(
        "d2SignedContributionCapabilityPolicyV1",
      );
    },
  );

  it.each(
    [[], ["lever"], ["unknown"], ["greenhouse", "greenhouse"], null].map((providers) => [
      providers,
    ]),
  )(
    "keeps a Greenhouse item undelivered for disabled or malformed injected provider selection %j",
    async (providers) => {
      const fetcher = vi.fn<typeof fetch>();
      const worker = await background(fetcher, true, { providers });
      expect((await worker.status()).delivery.contribution.ready).toBe(false);
      await worker.send({ action: "retry" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("has persistent development readiness without fetching policy or accessing its signed cache", async () => {
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    const worker = await background(fetcher, true);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await worker.status()).delivery.contribution).toEqual({
        ready: true,
        reason: "ready",
      });
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(worker.browser.storage.local.get).not.toHaveBeenCalledWith(
      "d2SignedContributionCapabilityPolicyV1",
    );
    expect(worker.browser.storage.local.remove).not.toHaveBeenCalledWith(
      "d2SignedContributionCapabilityPolicyV1",
    );
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(worker.originalReceipts);
  });

  it("keeps development delivery pending on network failure without policy fetches or token disclosure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError("private-network-error");
    });
    const worker = await background(fetcher, true);
    const result = await worker.send({ action: "retry" });
    expect(result.queue).toMatchObject({ pending: 1, stopped: 0, blocked: 1 });
    expect(fetcher).toHaveBeenCalled();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("contribution-capability-policy")),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
    expect(JSON.stringify(result)).not.toContain("private-network-error");
    expect(JSON.stringify([...worker.local.values()])).not.toContain("synthetic-token");
  });

  it("delivers selected development fields through the unchanged authenticated consent and contribution path", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/ugc-contribution-consents"))
        return response(
          {
            documentVersion: "ugc-contribution-preview.v1",
            grantedAt: now,
            id: "01991000-0000-7000-8000-000000000099",
            policyVersion: "synthetic-policy-v1",
            schemaVersion: 1,
            state: "granted",
          },
          201,
        );
      if (String(url).endsWith("/jobs/contributions")) {
        const body = JSON.parse(String(init?.body));
        return response(
          { id: body.contributionId, state: "queued", submittedAt: now, updatedAt: now },
          202,
        );
      }
      throw new Error("Unexpected synthetic request");
    });
    const worker = await background(fetcher, true);
    const result = await worker.send({ action: "retry" });
    expect(result.queue).toMatchObject({ pending: 0, stopped: 0, blocked: 1 });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.example.test/v1/profile/ugc-contribution-consents",
      "https://api.example.test/v1/jobs/contributions",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({ authorization: "Bearer synthetic-token" });
      expect(init?.redirect).toBe("error");
    }
    expect(JSON.stringify([...worker.local.values()])).not.toContain("synthetic-token");
  });

  it.each([
    ["configured", false, "identity_configuration_required"],
    ["authenticated", false, "sign_in_required"],
    ["apiConfigured", false, "api_configuration_required"],
  ] as const)("still gates development readiness on %s", async (key, value, reason) => {
    const fetcher = vi.fn<typeof fetch>();
    const worker = await background(fetcher, true);
    const protocol = await import("../lib/protocol");
    const previous = await protocol.authenticationStatus();
    vi.mocked(protocol.authenticationStatus).mockResolvedValue({ ...previous, [key]: value });
    try {
      expect((await worker.status()).delivery.contribution).toEqual({ ready: false, reason });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.mocked(protocol.authenticationStatus).mockResolvedValue(previous);
    }
  });

  it("still requires explicit retention, preview and UGC authorization in development", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const worker = await background(fetcher, true);
    const { extensionConfiguration } = await import("../lib/config");
    delete extensionConfiguration.pendingRetentionMilliseconds;
    expect((await worker.status()).delivery.contribution.reason).toBe(
      "retention_configuration_required",
    );
    extensionConfiguration.pendingRetentionMilliseconds = 86_400_000;
    delete extensionConfiguration.ugcContributionPolicyVersion;
    expect((await worker.status()).delivery.contribution.reason).toBe(
      "policy_configuration_required",
    );
    extensionConfiguration.ugcContributionPolicyVersion = "synthetic-policy-v1";
    worker.session.delete("d2LastJobCaptureV1");
    expect((await worker.status()).delivery.contribution.reason).toBe("preview_required");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not remove the signing-key requirement from the default path", async () => {
    const worker = await background(vi.fn(async () => response(signed())));
    const { extensionConfiguration } = await import("../lib/config");
    extensionConfiguration.capabilityPolicyPublicKeys = {};
    expect((await worker.status()).delivery.contribution).toEqual({
      ready: false,
      reason: "policy_configuration_required",
    });
  });

  it("cancels an acknowledged pre-verification item without a Trust case or enabled intake policy", async () => {
    const contributionId = "01991000-0000-7000-8000-000000000001";
    const fetcher = vi.fn(async (url: URL | RequestInfo) =>
      String(url).endsWith("/cancel")
        ? response({
            id: contributionId,
            state: "consent_invalid",
            submittedAt: now,
            updatedAt: now,
          })
        : response(signed({ ...policy, intakeEnabled: false, processingEnabled: false })),
    );
    const worker = await background(fetcher);
    const result = await worker.send({
      action: "cancel_contribution",
      contributionId,
      confirmed: true,
    });
    expect(result).toMatchObject({
      ok: true,
      ownerAction: "ok",
      delivery: { contribution: { ready: false } },
    });
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual([
      expect.objectContaining({ contributionId, state: "consent_invalid", identityFence }),
      expect.objectContaining({
        identityFence: "b".repeat(43),
        state: "awaiting_independent_verification",
      }),
    ]);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/cancel"))).toHaveLength(1);
    await worker.send({
      action: "cancel_contribution",
      contributionId: "01991000-0000-7000-8000-000000000002",
      confirmed: true,
    });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/cancel"))).toHaveLength(1);
  });

  it("does not restore a cancelled receipt after logout wins the in-flight action", async () => {
    const contributionId = "01991000-0000-7000-8000-000000000001";
    let resolveCancel!: (response: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const worker = await background(async (url) => {
      if (String(url).endsWith("/cancel")) {
        markStarted();
        return new Promise<Response>((resolve) => {
          resolveCancel = resolve;
        });
      }
      return response(signed());
    });
    const cancel = worker.send({ action: "cancel_contribution", contributionId, confirmed: true });
    await started;
    await worker.send({ action: "logout" });
    resolveCancel(
      response({ id: contributionId, state: "consent_invalid", submittedAt: now, updatedAt: now }),
    );
    expect(await cancel).toMatchObject({ ok: false, ownerAction: "rejected" });
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual([]);
  });

  it.each(["logout", "login"] as const)(
    "fences remaining queued sends and receipts after %s during intake",
    async (action) => {
      const started = deferred<void>();
      const release = deferred<void>();
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        if (String(url).endsWith("/jobs/contributions")) {
          started.resolve();
          await release.promise;
        }
        return contributionResponse(url, init);
      });
      const worker = await background(fetcher, true);
      const extra = createPendingIntent({
        approvedFields: ["title"],
        capture,
        identityFence,
        intent: "contribute",
        retentionMilliseconds: 86_400_000,
      });
      worker.local.set(PENDING_QUEUE_KEY, [...(worker.originalQueue as unknown[]), extra]);
      const before = structuredClone(worker.local.get(PENDING_QUEUE_KEY));
      const retry = worker.send({ action: "retry" });
      await started.promise;
      const api = await import("../lib/protocol");
      if (action === "login")
        vi.mocked(api.login).mockImplementationOnce(async () => {
          vi.mocked(api.authenticatedApiSession).mockResolvedValue({
            accessToken: "synthetic-other-token",
            identityFence: "c".repeat(43),
          });
        });
      await worker.send({ action });
      release.resolve();
      const stale = await retry;
      expect(stale.ok).toBe(false);
      expect(stale).not.toHaveProperty("receipts");
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith("/jobs/contributions")),
      ).toHaveLength(1);
      expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(action === "logout" ? [] : before);
      expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(
        action === "logout" ? [] : worker.originalReceipts,
      );
    },
  );

  it("fences intake after logout while the same intent's consent request is pending", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      started.resolve();
      await release.promise;
      return contributionResponse(url, init);
    });
    const worker = await background(fetcher, true);
    const retry = worker.send({ action: "retry" });
    await started.promise;
    await worker.send({ action: "logout" });
    release.resolve();
    expect((await retry).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual([]);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual([]);
  });

  it("coalesces overlapping retry dispatch without duplicating consent or intake", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/jobs/contributions")) {
        started.resolve();
        await release.promise;
      }
      return contributionResponse(url, init);
    });
    const worker = await background(fetcher, true);
    const first = worker.send({ action: "retry" });
    await started.promise;
    const second = worker.send({ action: "retry" });
    release.resolve();
    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not restore Remove all items or persist their late acknowledgement", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const worker = await background(async (url, init) => {
      if (String(url).endsWith("/jobs/contributions")) {
        started.resolve();
        await release.promise;
      }
      return contributionResponse(url, init);
    }, true);
    const retry = worker.send({ action: "retry" });
    await started.promise;
    await worker.send({ action: "clear_queue" });
    release.resolve();
    await retry;
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual([]);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(worker.originalReceipts);
  });

  it("preserves a newly enqueued item when an older dispatch commits", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const worker = await background(async (url, init) => {
      if (String(url).endsWith("/jobs/contributions")) {
        started.resolve();
        await release.promise;
      }
      return contributionResponse(url, init);
    }, true);
    const retry = worker.send({ action: "retry" });
    await started.promise;
    const enqueued = deferred<void>();
    const originalSet = worker.browser.storage.local.set.getMockImplementation();
    if (!originalSet) throw new Error("Storage fixture missing");
    worker.browser.storage.local.set.mockImplementation(async (entries) => {
      await originalSet(entries);
      if (Array.isArray(entries[PENDING_QUEUE_KEY]) && entries[PENDING_QUEUE_KEY].length === 3)
        enqueued.resolve();
    });
    const adding = worker.send({
      action: "enqueue",
      intent: "contribute",
      approvedFields: ["title"],
    });
    await enqueued.promise;
    release.resolve();
    await Promise.all([retry, adding]);
    const remaining = worker.local.get(PENDING_QUEUE_KEY) as { id: string; state: string }[];
    expect(remaining).toHaveLength(2);
    expect(remaining.filter((item) => item.state === "pending")).toHaveLength(1);
    expect(remaining.filter((item) => item.state === "blocked")).toHaveLength(1);
  });

  it.each([false, true])(
    "orders logout after delayed receipt storage even if a newer login cancels: %s",
    async (cancelNewLogin) => {
      const worker = await background(
        async () =>
          response({
            id: ownerContributionId,
            state: "consent_invalid",
            submittedAt: now,
            updatedAt: now,
          }),
        true,
      );
      const started = deferred<void>();
      const release = deferred<void>();
      const originalSet = worker.browser.storage.local.set.getMockImplementation();
      if (!originalSet) throw new Error("Storage fixture missing");
      worker.browser.storage.local.set.mockImplementationOnce(async (entries) => {
        started.resolve();
        await release.promise;
        await originalSet(entries);
      });
      const cancel = worker.send({
        action: "cancel_contribution",
        contributionId: ownerContributionId,
        confirmed: true,
      });
      await started.promise;
      const signingOut = worker.send({ action: "logout" });
      const api = await import("../lib/protocol");
      if (cancelNewLogin)
        vi.mocked(api.login).mockRejectedValueOnce(new Error("authorization_cancelled"));
      const login = cancelNewLogin ? worker.send({ action: "login" }) : Promise.resolve();
      release.resolve();
      await Promise.all([cancel, signingOut, login]);
      expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual([]);
      expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual([]);
      expect(worker.session.has("d2LastJobCaptureV1")).toBe(false);
    },
  );

  it("does not let an old logout's network completion clear newer owner state", async () => {
    const worker = await background(vi.fn<typeof fetch>(), true);
    const api = await import("../lib/protocol");
    const started = deferred<void>();
    const release = deferred<void>();
    vi.mocked(api.logout).mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
    });
    const signingOut = worker.send({ action: "logout" });
    await started.promise;
    await worker.send({ action: "login" });
    worker.local.set(PENDING_QUEUE_KEY, worker.originalQueue);
    worker.local.set(CONTRIBUTION_RECEIPTS_KEY, worker.originalReceipts);
    release.resolve();
    expect((await signingOut).ok).toBe(false);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(worker.originalReceipts);
  });

  it("drops an old-owner response when logout wins its final status await", async () => {
    const worker = await background(vi.fn<typeof fetch>(), true);
    const api = await import("../lib/protocol");
    const started = deferred<void>();
    const release = deferred<void>();
    const status = await api.authenticationStatus();
    vi.mocked(api.authenticationStatus).mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return status;
    });
    const pending = worker.status();
    await started.promise;
    await worker.send({ action: "logout" });
    release.resolve();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("receipts");
    expect(result).not.toHaveProperty("capture");
    expect(result).not.toHaveProperty("queue");
  });

  it("ignores an older processing read completed after cancellation while retaining Trust fields", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const later = "2026-09-05T12:00:21.000Z";
    const worker = await background(async (url) => {
      if (String(url).includes("/trust/")) return response(trustResponse(1));
      if (String(url).endsWith("/cancel"))
        return response({
          id: ownerContributionId,
          state: "consent_invalid",
          submittedAt: now,
          updatedAt: later,
        });
      started.resolve();
      await release.promise;
      return response({
        id: ownerContributionId,
        state: "awaiting_independent_verification",
        submittedAt: now,
        updatedAt: now,
      });
    }, true);
    const reading = worker.send({
      action: "contribution_refresh",
      contributionId: ownerContributionId,
    });
    await started.promise;
    await worker.send({
      action: "cancel_contribution",
      contributionId: ownerContributionId,
      confirmed: true,
    });
    await worker.send({ action: "trust_refresh", contributionId: ownerContributionId });
    release.resolve();
    expect((await reading).ownerAction).toBe("ok");
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toContainEqual(
      expect.objectContaining({
        contributionId: ownerContributionId,
        state: "consent_invalid",
        updatedAt: later,
        trust: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it.each([false, true])(
    "does not regress Trust from an inverse-order old response, equal conflicting version: %s",
    async (equalVersion) => {
      const started = deferred<void>();
      const release = deferred<void>();
      let reads = 0;
      const worker = await background(async () => {
        if (++reads === 1) {
          started.resolve();
          await release.promise;
          return response(trustResponse(equalVersion ? 2 : 1));
        }
        return response(trustResponse(2, "withdrawn", "2026-09-05T12:00:21.000Z"));
      }, true);
      const old = worker.send({ action: "trust_refresh", contributionId: ownerContributionId });
      await started.promise;
      await worker.send({ action: "trust_refresh", contributionId: ownerContributionId });
      release.resolve();
      expect((await old).ownerAction).toBe(equalVersion ? "rejected" : "ok");
      expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toContainEqual(
        expect.objectContaining({
          contributionId: ownerContributionId,
          state: "awaiting_independent_verification",
          trust: expect.objectContaining({ state: "withdrawn", version: 2 }),
        }),
      );
    },
  );

  it("recognizes renewal through explicit status without reloading, enqueueing, or touching account-held work", async () => {
    let envelope: unknown = signed();
    const fetcher = vi.fn(async () => response(envelope));
    const worker = await background(fetcher);
    expect((await worker.status()).delivery.contribution.ready).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetcher).toHaveBeenCalledTimes(1); // No background readiness timer.
    expect((await worker.status()).delivery.contribution).toEqual({
      ready: false,
      reason: "signed_policy_unavailable",
    });

    envelope = signed({
      ...policy,
      revision: "warm-worker-v2",
      issuedAt: policy.expiresAt,
      expiresAt: "2026-09-05T12:02:00.000Z",
    });
    expect((await worker.status()).delivery.contribution.ready).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2); // Repeated checks share the cooldown.
    await vi.advanceTimersByTimeAsync(15_000);
    const renewed = await worker.status();
    expect(renewed.delivery.contribution).toEqual({ ready: true, reason: "ready" });
    expect(renewed.queue).toMatchObject({ blocked: 1, pending: 1, stopped: 0 });
    expect(renewed.receipts).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const call of fetcher.mock.calls)
      expect(call).toEqual([
        new URL("https://api.example.test/v1/extension/contribution-capability-policy"),
        expect.objectContaining({ credentials: "omit", method: "GET" }),
      ]);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(worker.originalReceipts);
    expect(worker.browser.storage.session.set).not.toHaveBeenCalled();
    expect(worker.browser.storage.session.remove).not.toHaveBeenCalled();
    expect(worker.browser.alarms.create).not.toHaveBeenCalled();
  });

  it("denies expired offline readiness and recovers on a later user check without a restart", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(signed()));
    const worker = await background(fetcher);
    expect((await worker.status()).delivery.contribution.ready).toBe(true);
    fetcher.mockRejectedValue(new TypeError("offline"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await worker.status()).delivery.contribution.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await worker.status()).delivery.contribution.ready).toBe(false);
    fetcher.mockImplementation(async () =>
      response(
        signed({
          ...policy,
          revision: "warm-worker-v2",
          issuedAt: policy.expiresAt,
          expiresAt: "2026-09-05T12:02:00.000Z",
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await worker.status()).delivery.contribution.ready).toBe(true);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
    expect(worker.local.get(CONTRIBUTION_RECEIPTS_KEY)).toEqual(worker.originalReceipts);
  });

  it("does not let signed rollback or tampered renewal enable a warm worker", async () => {
    let envelope: unknown = signed({
      ...policy,
      issuedAt: "2026-09-05T12:00:10.000Z",
      revision: "warm-worker-v2",
    });
    const fetcher = vi.fn(async () => response(envelope));
    const worker = await background(fetcher);
    expect((await worker.status()).delivery.contribution.ready).toBe(true);
    envelope = { ...signed(), signature: "A".repeat(86) };
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await worker.status()).delivery.contribution.ready).toBe(false);
    envelope = signed();
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await worker.status()).delivery.contribution.ready).toBe(false);
    expect(worker.local.get(PENDING_QUEUE_KEY)).toEqual(worker.originalQueue);
  });
});
