import { createHash } from "node:crypto";
import type {
  ApplicationAttempt,
  ApplicationExecutionCommand,
  ApplicationSubmissionResultRequest,
} from "@ai-job-apply/api-contracts";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { afterEach, expect, it, vi } from "vitest";
import { executeApprovedApplication } from "../lib/application-executor";
import type { NativeTransferSelection } from "../lib/native-material-transfer";
import { APP, handoffFixture, LINK } from "./application-handoff-fixture";

const profile = vi.hoisted(() => ({
  variantId: "synthetic-only",
  adapterVersion: "0.1.0",
  implementationSha256: "c".repeat(64),
  submitSelector: "#submit",
  confirmationSelector: "#confirmation",
  confirmationReferenceAttribute: "data-reference",
}));
vi.mock("../lib/greenhouse/profiles", () => ({ greenhouseExecutionProfile: () => profile }));
const EMPLOYER = "https://boards.greenhouse.io/synthetic/jobs/123";
const DOCUMENT = "00000000-0000-7000-8000-000000000007";
const ATTEMPT = "00000000-0000-7000-8000-000000000009";
const json = (body: unknown) => Response.json(body, { headers: { "cache-control": "no-store" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ORIGINAL = new TextEncoder().encode("%PDF-1.4 the candidate's own original resume");
const ORIGINAL_SHA = createHash("sha256").update(ORIGINAL).digest("hex");
const UPLOADED_DOCUMENT = "00000000-0000-7000-8000-000000000030";

/** `original` is the candidate's file the packet binds; `file` is what the executor is handed. */
function setup(
  mode = "success",
  uploaded?: { original?: Uint8Array; file?: { sha256?: string; bytes?: Uint8Array } },
) {
  const originalBytes = uploaded?.original ?? ORIGINAL;
  const originalSha = createHash("sha256").update(originalBytes).digest("hex");
  const fixture = handoffFixture();
  const application = fixture.application;
  const packet = application.currentPacket;
  const material = packet?.temporaryMaterials?.[0];
  const approval = application.approval;
  if (!packet || !material || !approval || !fixture.job.sources[0])
    throw Error("Fixture incomplete");
  fixture.job.sources[0].canonicalUrl = EMPLOYER;
  packet.jobRevision = createHash("sha256")
    .update(activeJobRevisionDigestInput(fixture.job))
    .digest("hex");
  packet.form = {
    adapterId: "greenhouse-application-v1",
    variantId: profile.variantId,
    formHash: "e".repeat(64),
  };
  if (uploaded) {
    delete packet.temporaryMaterials;
    packet.artifactHashes = { resume: originalSha };
    packet.fields.push({
      fieldKey: "documents.resume",
      value: originalSha,
      origin: "confirmed_fact",
      sourceFactIds: [UPLOADED_DOCUMENT],
      confidence: 1,
      disposition: "review",
      reasons: ["explicit_each_time"],
      requiresReview: true,
    });
    approval.acknowledgedFieldKeys.push("documents.resume");
  }
  const selection: NativeTransferSelection = {
    applicationId: APP,
    packetId: packet.id,
    packetHash: packet.packetHash,
    approvalId: approval.id,
    revision: application.revision,
    approvalExpiresAtMs: Date.parse(approval.expiresAt),
    materials: uploaded ? [] : [structuredClone(material)],
    ...(uploaded ? { uploadedResume: { documentId: UPLOADED_DOCUMENT, sha256: originalSha } } : {}),
    reviewLink: LINK,
    jobId: application.canonicalJobId,
    ownerFence: "synthetic-owner",
    tabId: 7,
    documentId: DOCUMENT,
    employerUrl: EMPLOYER,
    variantId: profile.variantId,
  };
  const registry = new AdapterRegistry([
    {
      id: "greenhouse-application-v1",
      provider: "greenhouse",
      version: profile.adapterVersion,
      variants: [profile.variantId],
      capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
    },
  ]);
  vi.spyOn(registry, "executionStatus").mockReturnValue({ mode: "autofill", reasons: [] });
  const controller = new AbortController();
  let reachPage: () => void = () => undefined;
  const pageReached = new Promise<void>((resolve) => {
    reachPage = resolve;
  });
  const posts: string[] = [];
  const results: ApplicationSubmissionResultRequest[] = [];
  const listeners = new Set<Parameters<typeof chrome.runtime.onMessage.addListener>[0]>();
  const commands: ApplicationExecutionCommand[] = [];
  const wireCommands: ApplicationExecutionCommand[] = [];
  let attempt: ApplicationAttempt | undefined;
  const send = vi.fn(async (url: URL | RequestInfo, options?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (options?.method !== "POST") {
      if (path.includes("/authorization"))
        return json(
          mode === "withdrawn" && posts.some((path) => path.endsWith("/dispatch"))
            ? {}
            : fixture.proof,
        );
      if (path.startsWith("/v1/jobs/")) return json(fixture.job);
      if (mode === "changed-attempt" && attempt?.status === "started")
        return json({
          ...application,
          attempts: [{ ...attempt, startedAt: new Date(Date.now() - 10_000).toISOString() }],
        });
      return json(application);
    }
    posts.push(path);
    if (path.endsWith("/submissions")) {
      attempt = {
        id: ATTEMPT,
        sequence: 2,
        status: "started",
        adapterId: "greenhouse-application-v1",
        adapterVersion: profile.adapterVersion,
        startedAt: new Date().toISOString(),
      };
      application.status = "submitting";
      application.currentAction = "submission_in_progress";
      application.revision++;
      delete application.approval;
      application.attempts = [attempt];
      if (mode === "historical-confirmed")
        application.attempts.unshift({
          ...attempt,
          id: "00000000-0000-7000-8000-000000000010",
          sequence: 1,
          status: "confirmed",
        });
      return json({ outcome: "started", attemptId: ATTEMPT, application });
    }
    if (!attempt) throw Error("Attempt missing");
    if (path.endsWith("/dispatch")) {
      attempt.status = "dispatched";
      attempt.dispatchedAt = new Date().toISOString();
      if (mode === "lost-dispatch")
        throw Error("Lost dispatch acknowledgement after durable write");
      return json(attempt);
    }
    const result = JSON.parse(String(options.body)) as ApplicationSubmissionResultRequest;
    results.push(result);
    attempt.status = result.kind === "confirmed" ? "confirmed" : "ambiguous";
    attempt.resolvedAt = new Date().toISOString();
    application.status = result.kind === "confirmed" ? "applied" : "reconciliation_required";
    application.currentAction = result.kind === "confirmed" ? "none" : "confirm_submission_status";
    if (result.kind === "confirmed")
      attempt.confirmation = {
        kind: result.confirmation.kind,
        observedAt: result.confirmation.observedAt,
      };
    if (mode === "lost-result") throw Error("Lost result acknowledgement after durable write");
    if (mode === "wrong-terminal-time")
      attempt.dispatchedAt = new Date(Date.now() - 60_000).toISOString();
    return json(application);
  });
  vi.stubGlobal("fetch", send);
  const sendMessage = vi.fn(
    async (_tab: number, message: { schema: string; nonce?: string }, target: unknown) => {
      expect(target).toEqual({ documentId: DOCUMENT, frameId: 0 });
      if (message.schema === "application-execution-cancel.v1") return { ok: true };
      if (message.schema === "application-execution-inspect.v1")
        return {
          schema: "application-execution-inspection.v1",
          nonce: message.nonce,
          formHash: packet.form?.formHash,
          challengePresent: false,
        };
      const command = message as ApplicationExecutionCommand;
      commands.push(command);
      wireCommands.push(structuredClone(command));
      expect(posts.filter((path) => path.endsWith("/dispatch"))).toHaveLength(1);
      expect(command.fields.map((field) => field.fieldKey)).toEqual([
        "contact.email",
        "authorization.us_authorized",
      ]);
      expect(command.deadline).toBeLessThanOrEqual(
        uploaded ? Date.parse(approval.expiresAt) : material.expiresAtMs,
      );
      expect(application.approval).toBeUndefined();
      if (mode === "lost-command") throw Error("Lost page command acknowledgement");
      if (mode === "worker-loss") {
        controller.abort();
        return new Promise(() => {});
      }
      // The page is still working when the run's budget runs out.
      if (mode === "budget-spent") {
        reachPage();
        return new Promise(() => {});
      }
      const sender = {
        id: "a".repeat(32),
        tab: { id: 7, incognito: false },
        frameId: 0,
        documentId: mode === "foreign-proof" ? "foreign-document" : DOCUMENT,
        url: EMPLOYER,
        origin: new URL(EMPLOYER).origin,
        documentLifecycle: "active",
      };
      let proof: unknown;
      const listener = [...listeners][0];
      if (!listener) throw Error("Proof listener missing");
      const accepted: unknown = listener(
        {
          schema: "application-execution-proof.v1",
          nonce: command.nonce,
          attemptId: command.attemptId,
        },
        sender as chrome.runtime.MessageSender,
        (response) => {
          proof = response;
        },
      );
      if (!accepted) throw Error("Proof rejected");
      for (let i = 0; i < 150 && !proof; i++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(proof).toMatchObject({ ok: true, nonce: command.nonce, attemptId: ATTEMPT });
      return {
        schema: "application-execution-result.v1",
        nonce: mode === "wrong-result-nonce" ? "f".repeat(64) : command.nonce,
        attemptId: ATTEMPT,
        result: {
          kind: "confirmed",
          confirmation: {
            kind: mode === "api-evidence" ? "provider_api_response" : "provider_confirmation_page",
            observedAt: new Date(
              Date.now() + (mode === "future-evidence" ? 60_000 : 0),
            ).toISOString(),
            fingerprintSha256: "f".repeat(64),
            providerReference: "synthetic-receipt",
          },
        },
      };
    },
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "a".repeat(32),
      onMessage: {
        addListener: (listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0]) =>
          listeners.add(listener),
        removeListener: (listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0]) =>
          listeners.delete(listener),
      },
    },
    tabs: { query: vi.fn(async () => [{ id: 7, url: EMPLOYER, incognito: false }]), sendMessage },
    scripting: {
      executeScript: vi.fn(async () => [
        { frameId: 0, documentId: DOCUMENT, result: { url: EMPLOYER, topFrame: true } },
      ]),
    },
  });
  const preflight = vi.fn(async () => undefined);
  return {
    pageReached,
    posts,
    results,
    commands,
    wireCommands,
    listeners,
    sendMessage,
    preflight,
    application,
    run: (extra: { fillOnly?: boolean; ownedMs?: number; identityFor?: () => string } = {}) =>
      executeApprovedApplication({
        ...(extra.fillOnly ? { fillOnly: true } : {}),
        apiOrigin: "https://api.example",
        registry,
        identity: async () => ({
          accessToken: "synthetic-private-credential",
          identityFence: extra.identityFor?.() ?? "synthetic-owner",
        }),
        preflight,
        owned: {
          signal: controller.signal,
          deadline: Date.now() + (extra.ownedMs ?? 30_000),
          selection,
          files: uploaded
            ? [
                {
                  kind: "uploaded_resume" as const,
                  format: "pdf" as const,
                  mediaType: "application/pdf",
                  sha256: uploaded.file?.sha256 ?? originalSha,
                  bytes: new Uint8Array(uploaded.file?.bytes ?? originalBytes),
                },
              ]
            : [
                {
                  kind: "tailored_resume" as const,
                  generationId: material.generationId,
                  format: "pdf" as const,
                  mediaType: "application/pdf",
                  sha256: material.contentSha256,
                  bytes: new TextEncoder().encode("%PDF-SYNTHETIC"),
                },
              ],
        },
      }),
  };
}

it.each(["success", "historical-confirmed"])(
  "confirms only the exact dispatched attempt (%s), without reopening approval",
  async (mode) => {
    const fixture = setup(mode);
    expect(await fixture.run()).toMatchObject({ ok: true, outcome: "confirmed" });
    expect(fixture.preflight).toHaveBeenCalledTimes(2);
    expect(fixture.posts).toHaveLength(3);
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.wireCommands[0]?.files[0]?.contentBase64).not.toBe("");
    expect(fixture.commands[0]?.files.every((file) => file.contentBase64 === "")).toBe(true);
    expect(fixture.commands[0]?.fields).toEqual([]);
    expect(fixture.listeners.size).toBe(0);
  },
);

it.each([
  "lost-dispatch",
  "lost-command",
  "foreign-proof",
  "wrong-result-nonce",
  "api-evidence",
  "future-evidence",
  "withdrawn",
])("records ambiguity once for %s and never replays the page effect", async (mode) => {
  const fixture = setup(mode);
  expect(await fixture.run()).toMatchObject({
    outcome: mode === "lost-dispatch" ? "unknown" : "review_required",
  });
  expect(fixture.posts.filter((path) => path.endsWith("/dispatch"))).toHaveLength(1);
  expect(fixture.results).toEqual([{ kind: "unrecognized_response" }]);
  expect(fixture.commands.length).toBe(["lost-dispatch", "withdrawn"].includes(mode) ? 0 : 1);
  expect(fixture.listeners.size).toBe(0);
});

it.each(["lost-result", "wrong-terminal-time", "worker-loss"])(
  "leaves %s unknown without retrying a result or command",
  async (mode) => {
    const fixture = setup(mode);
    expect(await fixture.run()).toMatchObject({ ok: false, outcome: "unknown" });
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.results.length).toBe(mode === "worker-loss" ? 0 : 1);
    expect(fixture.listeners.size).toBe(0);
  },
);

it("still reports a dispatched attempt whose run ran out of budget, so the application is not stranded", async () => {
  vi.useFakeTimers();
  try {
    const fixture = setup("budget-spent");
    const run = fixture.run();
    // Let the run reach the page, then let its budget run out while the page is still working.
    await fixture.pageReached;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await run).toMatchObject({
      ok: true,
      outcome: "review_required",
      result: "unrecognized_response",
    });
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.results).toEqual([{ kind: "unrecognized_response" }]);
    expect(fixture.posts.filter((path) => path.endsWith("/result"))).toHaveLength(1);
    expect(fixture.listeners.size).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("gives a fill-only run longer than the short lease, and a run that can submit does not get it", async () => {
  const fillOnly = setup("success");
  expect(await fillOnly.run({ fillOnly: true, ownedMs: 4 * 60_000 })).toMatchObject({
    ok: true,
  });
  const reach = (fillOnly.commands[0]?.deadline ?? 0) - Date.now();
  expect(reach).toBeGreaterThan(2 * 60_000);
  expect(reach).toBeLessThanOrEqual(5 * 60_000);
  expect((fillOnly.commands[0] as { fillOnly?: boolean }).fillOnly).toBe(true);

  const submit = setup("success");
  expect(await submit.run({ ownedMs: 4 * 60_000 })).toMatchObject({ ok: true });
  expect((submit.commands[0]?.deadline ?? 0) - Date.now()).toBeLessThanOrEqual(60_000);
  expect((submit.commands[0] as { fillOnly?: boolean }).fillOnly).toBeUndefined();
});

it("does not report an attempt for a different signed-in account", async () => {
  vi.useFakeTimers();
  try {
    const fixture = setup("budget-spent");
    let reached = false;
    void fixture.pageReached.then(() => {
      reached = true;
    });
    // The same account while the run starts and is checked, another one when it is reported.
    const run = fixture.run({
      identityFor: () => (reached ? "another-owner" : "synthetic-owner"),
    });
    await fixture.pageReached;
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await run).toMatchObject({ ok: false, outcome: "unknown" });
    expect(fixture.results).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("refuses a changed owning attempt before dispatch or any page action", async () => {
  const fixture = setup("changed-attempt");
  expect(await fixture.run()).toMatchObject({ ok: false, outcome: "review_required" });
  expect(fixture.posts).toHaveLength(1);
  expect(fixture.commands).toEqual([]);
});

it("sends the candidate's own original as an uploaded resume, with no generation, then confirms", async () => {
  const fixture = setup("success", {});
  expect(await fixture.run()).toMatchObject({ ok: true, outcome: "confirmed" });
  const file = fixture.wireCommands[0]?.files[0];
  expect(file).toMatchObject({
    kind: "uploaded_resume",
    format: "pdf",
    mediaType: "application/pdf",
    sha256: ORIGINAL_SHA,
  });
  expect(file).not.toHaveProperty("generationId");
  expect(Buffer.from(file?.contentBase64 ?? "", "base64")).toEqual(Buffer.from(ORIGINAL));
  expect(fixture.commands[0]?.files.every((entry) => entry.contentBase64 === "")).toBe(true);
  expect(fixture.posts).toHaveLength(3);
});

it.each([
  ["another digest than the approved packet binds", { sha256: "d".repeat(64) }],
  ["bytes that are not the bound original", { bytes: new TextEncoder().encode("%PDF-1.4 other") }],
])("refuses an uploaded resume with %s before any attempt exists", async (_name, file) => {
  const fixture = setup("success", { file });
  expect(await fixture.run()).toMatchObject({ ok: false });
  // Nothing was started, dispatched, sent to the page, or recorded.
  expect(fixture.posts).toEqual([]);
  expect(fixture.commands).toEqual([]);
  expect(fixture.results).toEqual([]);
});

it("carries a candidate original above the generated-file limit within the wire limit", async () => {
  const big = new Uint8Array(1_500_000);
  big.set(new TextEncoder().encode("%PDF-1.4"));
  const fixture = setup("success", { original: big });
  expect(await fixture.run()).toMatchObject({ ok: true, outcome: "confirmed" });
  expect(fixture.wireCommands[0]?.files[0]?.contentBase64.length).toBeGreaterThan(1_900_000);
});
