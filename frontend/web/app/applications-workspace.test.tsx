// @vitest-environment jsdom

import { createHash } from "node:crypto";
import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationsWorkspace } from "./applications-workspace";
import { CandidateNameProvider } from "./candidate-name-context";

// The viewer needs a canvas that jsdom does not have; it is proven in a real browser separately.
vi.mock("./resume-pdf-viewer", async () => {
  const react = await import("react");
  return {
    ResumePdfViewer: ({ label, onRendered }: { label: string; onRendered(): void }) => {
      react.useEffect(() => onRendered(), [onRendered]);
      return react.createElement("div", { role: "img", "aria-label": label });
    },
  };
});

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const DOC = "00000000-0000-7000-8000-000000000030";
const GEN = "00000000-0000-7000-8000-000000000020";
const CONTENT_HASH = "c".repeat(64);
const PDF_BYTES = Buffer.from("%PDF-1.4 synthetic resume");
const PDF_BASE64 = PDF_BYTES.toString("base64");
const PDF_SHA256 = createHash("sha256").update(PDF_BYTES).digest("hex");
const UPLOADED_HASH = "d".repeat(64);
const APPLY_URL = "https://boards.example.test/jobs/1";
const EXTENSION_ID = "a".repeat(32);

type Mode = "ready" | "failed" | "no_resume" | "timed_out" | "never";

/** An in-memory stand-in for the Applications BFF. Nothing here reaches a network or a provider. */
class FakeBff {
  app: Application | undefined;
  mode: Mode = "ready";
  /** GET reads of the application that pass before a generation resolves. */
  pollsUntilResolved = 2;
  polls = 0;
  revision = 1;
  packetCounter = 0;
  needsInput = false;
  sensitive = false;
  calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  material: ApplicationTemporaryMaterial | undefined;
  failPreview = false;

  private packet(resume: "generate" | "uploaded") {
    this.packetCounter += 1;
    const hash = (this.packetCounter.toString(16).padStart(2, "0") + "e".repeat(62)).slice(0, 64);
    const fields: Record<string, unknown>[] = [
      {
        fieldKey: "contact.email",
        value: "candidate@example.test",
        origin: "confirmed_fact",
        sourceFactIds: [DOC],
        confidence: 1,
        disposition: "auto",
        reasons: [],
        requiresReview: false,
      },
    ];
    if (this.sensitive)
      fields.push({
        fieldKey: "authorization.work_in_country",
        value: true,
        origin: "user_entered",
        sourceFactIds: [],
        confidence: 1,
        disposition: "review",
        reasons: ["restricted_answer", "never_infer"],
        requiresReview: true,
      });
    if (this.needsInput)
      fields.push({
        fieldKey: "questions.why_company",
        value: null,
        origin: "confirmed_fact",
        sourceFactIds: [],
        confidence: 0.4,
        disposition: "user_action",
        reasons: ["unsupported_value"],
        requiresReview: true,
      });
    if (resume === "uploaded")
      fields.push({
        fieldKey: "documents.resume",
        value: UPLOADED_HASH,
        origin: "confirmed_fact",
        sourceFactIds: [DOC],
        confidence: 1,
        disposition: "review",
        reasons: ["explicit_each_time"],
        requiresReview: true,
      });
    return {
      id: `00000000-0000-7000-8000-0000000001${String(this.packetCounter).padStart(2, "0")}`,
      version: this.packetCounter,
      packetHash: hash,
      jobRevision: hash,
      artifactHashes: resume === "uploaded" ? { resume: UPLOADED_HASH } : {},
      fields,
      createdAt: new Date().toISOString(),
    };
  }

  private base(status: Application["status"], extras: Record<string, unknown> = {}) {
    this.revision += 1;
    const now = new Date().toISOString();
    return {
      id: APP,
      canonicalJobId: JOB,
      status,
      revision: this.revision,
      currentAction:
        status === "approved"
          ? "ready_to_submit"
          : status === "review_required"
            ? "review_and_approve"
            : "prepare_packet",
      attempts: [],
      createdAt: now,
      updatedAt: now,
      ...extras,
    } as unknown as Application;
  }

  private resolveGeneration() {
    const app = this.app;
    const packet = app?.currentPacket;
    if (!app || !packet || app.resumeGeneration?.state !== "preparing") return;
    this.polls += 1;
    if (this.polls < this.pollsUntilResolved || this.mode === "never") return;
    const requestedAt = app.resumeGeneration.requestedAt;
    if (this.mode === "ready") {
      this.material = {
        schemaVersion: 1,
        kind: "tailored_resume",
        generationId: GEN,
        version: 1,
        contentSha256: CONTENT_HASH,
        completedAtMs: Date.now(),
        expiresAtMs: Date.now() + 1_800_000,
      };
      const next = this.packet("generate");
      next.artifactHashes = { resume: CONTENT_HASH };
      next.fields.push({
        fieldKey: "documents.resume",
        value: CONTENT_HASH,
        origin: "generated",
        sourceFactIds: [],
        confidence: 1,
        disposition: "review",
        reasons: ["explicit_each_time", "generated_content"],
        requiresReview: true,
      });
      this.app = this.base("review_required", {
        currentPacket: { ...next, temporaryMaterials: [this.material] },
        resumeGeneration: { state: "ready", requestedAt },
      });
      return;
    }
    this.app = this.base("review_required", {
      currentPacket: packet,
      resumeGeneration: {
        state: "failed",
        errorCode:
          this.mode === "no_resume"
            ? "no_resume"
            : this.mode === "timed_out"
              ? "generation_timed_out"
              : "generation_failed",
        requestedAt,
      },
    });
  }

  fetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    this.calls.push({ method, url, ...(body ? { body } : {}) });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: {
          "content-type": status >= 400 ? "application/problem+json" : "application/json",
          "cache-control": "no-store",
        },
      });
    if (url === "/api/platform/applications/search")
      return json({ items: this.app ? [this.app] : [] });
    if (url === "/api/platform/applications" && method === "POST") {
      this.app = this.base("preparing");
      return json(this.app, 201);
    }
    if (!this.app || !url.startsWith(`/api/platform/applications/${APP}`))
      return json({ code: "application_not_found" }, 404);
    const rest = url.slice(`/api/platform/applications/${APP}`.length);
    if (rest === "" && method === "GET") {
      this.resolveGeneration();
      return json(this.app);
    }
    if (rest === "/packets" && method === "POST") {
      if (this.app.status === "approved") return json({ code: "application_state_conflict" }, 409);
      const resume = body?.resume === "uploaded" ? "uploaded" : "generate";
      const packet = this.packet(resume);
      this.polls = 0;
      this.app = this.base("review_required", {
        currentPacket: packet,
        ...(resume === "generate"
          ? { resumeGeneration: { state: "preparing", requestedAt: new Date().toISOString() } }
          : {}),
      });
      return json(this.app, 201);
    }
    if (rest === "/reopen" && method === "POST") {
      this.app = this.base("review_required", { currentPacket: this.app.currentPacket });
      return json(this.app);
    }
    if (rest === "/approval" && method === "POST") {
      const packet = this.app.currentPacket;
      const acknowledged = (body?.acknowledgedFieldKeys ?? []) as string[];
      const missing = (packet?.fields ?? []).filter(
        (field) => field.requiresReview && !acknowledged.includes(field.fieldKey),
      );
      if (!packet || body?.packetHash !== packet.packetHash || missing.length)
        return json({ code: "application_approval_refused" }, 409);
      this.app = this.base("approved", {
        currentPacket: packet,
        ...(this.app.resumeGeneration ? { resumeGeneration: this.app.resumeGeneration } : {}),
        approval: {
          id: "00000000-0000-7000-8000-000000000011",
          packetHash: packet.packetHash,
          approvedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          acknowledgedFieldKeys: acknowledged,
        },
      });
      return json(this.app);
    }
    if (rest === "/manual-submissions" && method === "POST") {
      this.app = this.base("takeover", {
        currentPacket: this.app.currentPacket,
        attempts: [
          {
            id: "00000000-0000-7000-8000-000000000012",
            sequence: 1,
            status: "taken_over",
            adapterId: "manual",
            adapterVersion: "none",
            startedAt: new Date().toISOString(),
          },
        ],
      });
      return json({ outcome: "started", application: this.app }, 201);
    }
    if (rest.endsWith("/reconciliation") && method === "POST") {
      this.app = this.base("applied", {});
      return json(this.app);
    }
    if (rest.startsWith("/resume/content") && method === "GET") {
      const query = new URL(url, "http://localhost").searchParams;
      const packet = this.app.currentPacket;
      if (this.failPreview) return json({ code: "applications_unavailable" }, 503);
      if (!packet || !this.material || query.get("packetHash") !== packet.packetHash)
        return json({ code: "application_packet_stale" }, 409);
      if (query.get("format") === "pdf")
        return json({
          format: "pdf",
          mediaType: "application/pdf",
          fileName: "tailored-resume.pdf",
          sha256: PDF_SHA256,
          sizeBytes: PDF_BYTES.byteLength,
          contentSha256: CONTENT_HASH,
          contentBase64: PDF_BASE64,
          temporaryMaterial: this.material,
        });
      return json({ code: "not_found" }, 404);
    }
    return json({ code: "application_not_found" }, 404);
  });

  /** The request bodies of every packet the candidate caused to be prepared. */
  packetRequests() {
    return this.calls.filter((call) => call.url.endsWith("/packets")).map((call) => call.body);
  }
  approvals() {
    return this.calls.filter((call) => call.url.endsWith("/approval")).map((call) => call.body);
  }
}

let container: HTMLDivElement;
let root: Root;
let openedTab: {
  opener: unknown;
  closed: boolean;
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_NATIVE_MATERIAL_UI", "enabled");
  openedTab = {
    opener: window,
    closed: false,
    location: { replace: vi.fn() },
    close: vi.fn(() => {
      openedTab.closed = true;
    }),
  };
  vi.spyOn(window, "open").mockImplementation(() => openedTab as unknown as Window);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "chrome");
});

async function mount(
  bff: FakeBff,
  props: Partial<Parameters<typeof ApplicationsWorkspace>[0]> = {},
) {
  await act(async () => {
    root.render(
      <CandidateNameProvider value="Vrij Patel">
        <ApplicationsWorkspace
          jobId={JOB}
          applyUrl={APPLY_URL}
          fetchImplementation={bff.fetch}
          coverLetterPreparationEnabled={false}
          {...props}
        />
      </CandidateNameProvider>,
    );
  });
  await settle();
}

async function settle(rounds = 30) {
  for (let round = 0; round < rounds; round += 1)
    await act(async () => {
      await Promise.resolve();
    });
}

function button(label: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((element) =>
    typeof label === "string"
      ? element.textContent === label
      : label.test(element.textContent ?? ""),
  );
}

async function click(label: string | RegExp) {
  const target = button(label);
  if (!target) throw new Error(`No button ${String(label)}`);
  await act(async () => target.click());
  await settle();
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

function statusText() {
  return Array.from(container.querySelectorAll("[role=status]"))
    .map((element) => element.textContent)
    .join(" ");
}

const REMOVED_COPY = [
  "Sign in to view generated materials",
  "Disconnect material access",
  "Approve this packet",
  "I reviewed this generated",
  "Cancel application",
  "Replace the current preparation",
  "Check generated resume",
  "may still be preparing",
  "Edit again",
  "Word (DOCX)",
];

function expectNoRemovedCopy() {
  for (const text of REMOVED_COPY) expect(container.textContent).not.toContain(text);
}

describe("ApplicationsWorkspace: generate, then apply", () => {
  it("starts with Generate resume and Apply, with no approval ceremony", async () => {
    const bff = new FakeBff();
    await mount(bff);
    expect(button("Generate resume")).toBeDefined();
    expect(button("Apply")?.disabled).toBe(false);
    expect(container.textContent).toContain("Apply will use your own uploaded resume, unchanged.");
    expectNoRemovedCopy();
    expect(bff.calls.map((call) => call.url)).toEqual(["/api/platform/applications/search"]);
    expect(
      (await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it("disables Apply when the job has no safe employer link", async () => {
    await mount(new FakeBff(), { applyUrl: "javascript:alert(1)" });
    expect(button("Apply")?.disabled).toBe(true);
    expect(container.textContent).toContain("We do not have a safe link");
  });

  it("Generate shows a loading state that resolves to the resume by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    await mount(bff);
    await click("Generate resume");
    expect(bff.packetRequests()).toEqual([{ expectedRevision: 2 }]);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Generating your resume");
    expect(status?.textContent).toContain("1 to 2 minutes");
    // Apply stays available while generating: it then uses the uploaded resume, and says so.
    expect(button("Apply")?.disabled).toBe(false);
    expect(container.textContent).toContain("Apply now uses your own uploaded resume");
    expectNoRemovedCopy();
    await advance(3_100);
    expect(container.textContent).toContain("Generating your resume");
    await advance(3_100);
    expect(container.querySelector('[role="img"]')).not.toBeNull();
    expect(container.textContent).toContain("deleted 30 minutes after it was made");
    expect(container.textContent).not.toContain("Generating your resume");
    expect(button("Apply")?.disabled).toBe(false);
    expect(container.textContent).toContain("Apply will use your generated resume (PDF)");
    expectNoRemovedCopy();
    // The only reads are the application itself and the BFF-proxied preview: no sign-in step.
    expect(
      bff.calls.filter((call) => call.url.includes("/content")).map((call) => call.url),
    ).toHaveLength(1);
    expect(bff.calls.some((call) => /location|authorization/u.test(call.url))).toBe(false);
  });

  it.each([
    ["failed", "failed", "could not generate your resume this time", true],
    ["timed_out", "timed_out", "took longer than expected", true],
    ["no_resume", "no_resume", "could not find an uploaded resume", false],
  ] as const)(
    "shows a clear %s failure instead of 'still preparing'",
    async (_name, mode, copy, retry) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const bff = new FakeBff();
      bff.mode = mode;
      await mount(bff);
      await click("Generate resume");
      await advance(6_500);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(copy);
      expectNoRemovedCopy();
      expect(Boolean(button("Try again"))).toBe(retry);
      // Polling stopped once the state resolved.
      const reads = bff.calls.length;
      await advance(10_000);
      expect(bff.calls.length).toBe(reads);
      expect(button("Apply with my uploaded resume")).toBeDefined();
    },
  );

  it("retries a failed generation with a fresh preparation request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    bff.mode = "failed";
    await mount(bff);
    await click("Generate resume");
    await advance(6_500);
    bff.mode = "ready";
    await click("Try again");
    expect(bff.packetRequests()).toHaveLength(2);
    await advance(6_500);
    expect(container.querySelector('[role="img"]')).not.toBeNull();
  });

  it("shows expiry and regenerates in one click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    await mount(bff);
    await click("Generate resume");
    await advance(6_500);
    expect(container.querySelector('[role="img"]')).not.toBeNull();
    await advance(1_800_000);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "expired and was deleted",
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).toContain("Apply will use your own uploaded resume");
    expect(button("Apply")?.disabled).toBe(false);
    await click("Generate again");
    expect(bff.packetRequests()).toHaveLength(2);
  });

  it("stops waiting after the polling limit and reports a timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    bff.mode = "never";
    await mount(bff);
    await click("Generate resume");
    await advance(13 * 60_000);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "took longer than expected",
    );
  });

  it("says generation is unavailable when the server never started one", async () => {
    const bff = new FakeBff();
    const base = bff.fetch.getMockImplementation();
    bff.fetch.mockImplementation(async (input, init) => {
      const response = await base?.(input, init);
      if (!response || !String(input).endsWith("/packets")) return response as Response;
      const value = await response.json();
      delete value.resumeGeneration;
      return new Response(JSON.stringify(value), response);
    });
    await mount(bff);
    await click("Generate resume");
    expect(container.textContent).toContain("Resume generation is not available right now");
  });
});

describe("ApplicationsWorkspace: cover letter", () => {
  it("has its own Generate step with no consent checkbox, and sends the disclosure on that click", async () => {
    const bff = new FakeBff();
    await mount(bff, { coverLetterPreparationEnabled: true });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).toContain("Cover letter (optional)");
    expect(container.textContent).not.toMatch(/using these terms|requires a new choice/u);
    await click("Generate cover letter");
    expect(bff.packetRequests().at(-1)).toMatchObject({
      coverLetter: { disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true } },
    });
  });

  it("does not request a cover letter when only the resume is generated", async () => {
    const bff = new FakeBff();
    await mount(bff, { coverLetterPreparationEnabled: true });
    await click("Generate resume");
    expect(bff.packetRequests().at(-1)).not.toHaveProperty("coverLetter");
  });
});

describe("ApplicationsWorkspace: Apply", () => {
  it("applies directly with the uploaded resume: packet, approval, then the employer page", async () => {
    const bff = new FakeBff();
    await mount(bff);
    await click("Apply");
    expect(bff.packetRequests()).toEqual([{ expectedRevision: 2, resume: "uploaded" }]);
    expect(bff.approvals()).toEqual([
      expect.objectContaining({ acknowledgedFieldKeys: ["documents.resume"] }),
    ]);
    // The tab was opened on the click, severed from this page, and only then pointed at the job.
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(openedTab.opener).toBeNull();
    expect(openedTab.location.replace).toHaveBeenCalledWith(APPLY_URL);
    expect(container.textContent).toContain("Finish on the employer's page");
    expect(container.textContent).toContain("Record submission");
    expectNoRemovedCopy();
  });

  it("applies with the generated PDF once it is ready and shown, without a new packet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    await mount(bff);
    await click("Generate resume");
    await advance(6_500);
    expect(button("Apply")?.disabled).toBe(false);
    await click("Apply");
    expect(bff.packetRequests()).toHaveLength(1);
    expect(bff.approvals()).toEqual([
      expect.objectContaining({ acknowledgedFieldKeys: ["documents.resume"] }),
    ]);
    expect(openedTab.location.replace).toHaveBeenCalledWith(APPLY_URL);
  });

  it("will not apply with a generated resume whose exact preview was not shown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    bff.failPreview = true;
    await mount(bff);
    await click("Generate resume");
    await advance(6_500);
    expect(container.textContent).toContain("could not be loaded right now");
    expect(button("Apply")?.disabled).toBe(true);
  });

  it("falls back to the uploaded resume when the generated one expired", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    await mount(bff);
    await click("Generate resume");
    await advance(6_500);
    await advance(1_800_000);
    await click("Apply");
    // The expired packet is replaced by one bound to the uploaded file, never the expired file.
    expect(bff.packetRequests().at(-1)).toMatchObject({ resume: "uploaded" });
    const approval = bff.approvals().at(-1);
    expect(approval).toBeDefined();
    expect(bff.app?.currentPacket?.temporaryMaterials).toBeUndefined();
    expect(bff.app?.status).toBe("approved");
  });

  it("lets the candidate skip a slow generation and apply with the uploaded resume", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const bff = new FakeBff();
    bff.mode = "never";
    await mount(bff);
    await click("Generate resume");
    await advance(3_100);
    await click("Skip and apply with my uploaded resume");
    expect(bff.packetRequests().at(-1)).toMatchObject({ resume: "uploaded" });
    expect(bff.app?.status).toBe("approved");
    expect(openedTab.location.replace).toHaveBeenCalledWith(APPLY_URL);
  });

  it("opens the outcome dialog by itself after Apply, with no button to find", async () => {
    const bff = new FakeBff();
    await mount(bff);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click("Apply");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Did you submit the application",
    );
  });

  it("keeps just the word Submitted once the submission is logged", async () => {
    const bff = new FakeBff();
    await mount(bff);
    await click("Apply");
    await click("I submitted it");
    expect(container.textContent).toBe("Submitted");
  });

  it("hands the submitted state to its caller instead of drawing it", async () => {
    const bff = new FakeBff();
    const onApplied = vi.fn();
    await mount(bff, { onApplied });
    await click("Apply");
    await click("I submitted it");
    expect(onApplied).toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("blocks Apply until empty answers are given and sensitive answers are checked", async () => {
    const bff = new FakeBff();
    bff.needsInput = true;
    bff.sensitive = true;
    await mount(bff);
    // Preparing the packet is part of Apply; with answers needed it stops before approval.
    await click("Apply");
    expect(bff.approvals()).toEqual([]);
    expect(container.textContent).toContain("We need your answer");
    expect(container.textContent).toContain("Check these answers");
    expect(button("Apply")?.disabled).toBe(true);
    expect(container.textContent).toContain("1 answer(s) still need your input.");
    expect(container.textContent).toContain("1 answer(s) still need your check.");
    expect(openedTab.location.replace).not.toHaveBeenCalled();
    expect(openedTab.close).toHaveBeenCalled();
  });

  it("requires the sensitive answer check and sends exactly what was checked", async () => {
    const bff = new FakeBff();
    bff.sensitive = true;
    await mount(bff);
    await click("Generate resume");
    // Make the generated state irrelevant: apply with the uploaded resume once the packet exists.
    bff.mode = "never";
    await click("Skip and apply with my uploaded resume");
    expect(bff.approvals()).toEqual([]);
    expect(button("Apply")?.disabled).toBe(true);
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => box?.click());
    expect(button("Apply")?.disabled).toBe(false);
    await click("Apply");
    expect(bff.approvals()).toEqual([
      expect.objectContaining({
        acknowledgedFieldKeys: ["authorization.work_in_country", "documents.resume"],
      }),
    ]);
  });

  it("closes the pre-opened tab and shows fixed copy when Apply fails", async () => {
    const bff = new FakeBff();
    const base = bff.fetch.getMockImplementation();
    bff.fetch.mockImplementation(async (input, init) =>
      String(input).endsWith("/approval")
        ? new Response(JSON.stringify({ code: "application_approval_refused", detail: "SECRET" }), {
            status: 409,
            headers: { "content-type": "application/problem+json" },
          })
        : (base?.(input, init) as Promise<Response>),
    );
    await mount(bff);
    await click("Apply");
    expect(container.textContent).toContain("That approval was not accepted");
    expect(container.textContent).not.toContain("SECRET");
    expect(openedTab.location.replace).not.toHaveBeenCalled();
    expect(openedTab.close).toHaveBeenCalled();
  });

  it("ignores a second click while Apply is working", async () => {
    const bff = new FakeBff();
    await mount(bff);
    await act(async () => {
      button("Apply")?.click();
      button("Apply")?.click();
    });
    await settle(8);
    expect(bff.packetRequests()).toHaveLength(1);
    expect(bff.approvals()).toHaveLength(1);
    // The second click must not leave a second, blank employer tab behind.
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it("does not carry checks over to a packet rebuilt during Apply", async () => {
    const bff = new FakeBff();
    bff.sensitive = true;
    bff.mode = "never";
    await mount(bff);
    await click("Generate resume");
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => box?.click());
    // The generated packet is still preparing, so Apply rebuilds it for the uploaded resume. The
    // candidate checked the old packet's answers, not the new one's.
    await click("Apply");
    expect(bff.approvals()).toEqual([]);
    expect(container.textContent).toContain("Your answers were updated");
    expect(openedTab.location.replace).not.toHaveBeenCalled();
    expect(openedTab.close).toHaveBeenCalled();
  });

  it("opens an already approved application at the employer step", async () => {
    const bff = new FakeBff();
    await mount(bff);
    await click("Apply");
    act(() => root.unmount());
    root = createRoot(container);
    await mount(bff);
    expect(container.textContent).toContain("Finish on the employer's page");
    expect(button("Apply")).toBeUndefined();
  });
});

describe("ApplicationsWorkspace: extension hand-off", () => {
  function extension(answers: Array<"unselected" | "ok">) {
    const messages: Array<Record<string, unknown>> = [];
    const queue = [...answers];
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: {
        runtime: {
          sendMessage(
            target: string,
            message: Record<string, unknown>,
            callback: (value: unknown) => void,
          ) {
            expect(target).toBe(EXTENSION_ID);
            messages.push(message);
            if (message.schema === "application-apply-intent.v1")
              callback({
                schema: "application-apply-intent-receipt.v1",
                expiresAtMs: Date.now() + 600_000,
              });
            else if (message.schema === "application-native-transfer-begin.v1") {
              if (queue.shift() === "unselected") callback({ error: "unavailable" });
              else
                callback({
                  ...message,
                  schema: "application-native-transfer-admission.v1",
                  nonce: "f".repeat(64),
                  expiresAtMs: Date.now() + 30_000,
                  approvalId: "00000000-0000-7000-8000-000000000011",
                  revision: extensionRevision(),
                  materials: extensionMaterials(),
                });
            } else if (message.schema === "application-native-transfer-commit.v1") {
              const admission = message.admission as Record<string, unknown>;
              callback({
                schema: "application-native-transfer-receipt.v1",
                nonce: admission.nonce,
                applicationId: admission.applicationId,
                packetId: admission.packetId,
                packetHash: admission.packetHash,
                expiresAtMs: Math.min(
                  Date.now() + 1_800_000,
                  ...(admission.materials as ApplicationTemporaryMaterial[]).map(
                    (item) => item.expiresAtMs,
                  ),
                ),
              });
            } else callback({ ok: true });
          },
        },
      },
    });
    return messages;
  }

  let currentBff: FakeBff;
  const extensionRevision = () => currentBff.app?.revision ?? 0;
  const extensionMaterials = () => (currentBff.material ? [currentBff.material] : []);

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_TRANSFER_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APPLICATION_EXTENSION_ID", EXTENSION_ID);
  });

  it("arms the extension with identifiers only when applying with the uploaded resume", async () => {
    currentBff = new FakeBff();
    const messages = extension([]);
    await mount(currentBff);
    await click("Apply");
    const intent = messages.find((message) => message.schema === "application-apply-intent.v1");
    expect(intent).toEqual({
      schema: "application-apply-intent.v1",
      applicationId: APP,
      jobId: JOB,
      packetId: currentBff.app?.currentPacket?.id,
      packetHash: currentBff.app?.currentPacket?.packetHash,
    });
    // The page identifies itself by its review link, and nothing else is sent for an uploaded file.
    expect(window.location.pathname + window.location.search).toBe(
      `/jobs?application=${APP}&job=${JOB}`,
    );
    expect(messages.some((message) => String(message.schema).includes("transfer"))).toBe(false);
    expect(statusText()).toContain("uploaded resume");
    expect(JSON.stringify(messages)).not.toMatch(/token|authorization|candidate@example/iu);
  });

  it("sends the generated PDF once the extension asks, and only as PDF", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    currentBff = new FakeBff();
    const messages = extension(["unselected", "unselected", "ok"]);
    await mount(currentBff, { jobTitle: "Billing Engineer" });
    await click("Generate resume");
    await advance(6_500);
    await click("Apply");
    expect(container.textContent).toContain("open the ApplyDash extension");
    await advance(2_100);
    await advance(2_100);
    await advance(2_100);
    const schemas = messages.map((message) => message.schema);
    expect(
      schemas.filter((schema) => schema === "application-native-transfer-begin.v1").length,
    ).toBeGreaterThanOrEqual(3);
    const commit = messages.find(
      (message) => message.schema === "application-native-transfer-commit.v1",
    );
    expect(commit).toBeDefined();
    const files = (commit?.files ?? []) as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    // The employer sees the User_Job_Name_ID name, not the generator's own file name.
    expect(files[0]).toMatchObject({
      format: "pdf",
      mediaType: "application/pdf",
      fileName: `Vrij_Patel_Billing_Engineer_${APP}.pdf`,
    });
    expect(JSON.stringify(messages)).not.toMatch(/docx|wordprocessingml/iu);
    expect(container.textContent).toContain("It will use your generated resume (PDF)");
  });

  it("tells the candidate to finish by hand when no extension answers", async () => {
    currentBff = new FakeBff();
    Object.defineProperty(window, "chrome", {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (_t: string, _m: unknown, cb: (v: unknown) => void) => cb(undefined),
        },
      },
    });
    await mount(currentBff);
    await click("Apply");
    expect(container.textContent).toContain("The extension did not answer");
  });
});
