// @vitest-environment jsdom

import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationView } from "../lib/apply-flow";
import {
  CoverLetterSection,
  GeneratedCoverLetterPanel,
  GeneratedResumePanel,
} from "./generated-resume-panel";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const PACKET = "00000000-0000-7000-8000-000000000003";
const GEN = "00000000-0000-7000-8000-000000000020";
const PACKET_HASH = "b".repeat(64);
const CONTENT_HASH = "a".repeat(64);
const AT = "2026-10-20T12:00:00.000Z";
const NOW = Date.now();

function material(): ApplicationTemporaryMaterial {
  return {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: GEN,
    version: 1,
    contentSha256: CONTENT_HASH,
    completedAtMs: NOW - 5 * 60_000,
    expiresAtMs: NOW - 5 * 60_000 + 1_800_000,
  };
}

function application(packetExtras: Record<string, unknown> = {}): Application {
  return {
    id: APP,
    canonicalJobId: JOB,
    status: "review_required",
    revision: 3,
    currentAction: "review_and_approve",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    currentPacket: {
      id: PACKET,
      version: 1,
      packetHash: PACKET_HASH,
      jobRevision: PACKET_HASH,
      artifactHashes: { resume: CONTENT_HASH },
      fields: [],
      createdAt: AT,
      ...packetExtras,
    },
  } as unknown as Application;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const previewBody = (bound: ApplicationTemporaryMaterial | undefined) => ({
  status: "ready",
  matchesPacket: true,
  tailoringVersion: "1",
  contentSha256: CONTENT_HASH,
  ...(bound ? { temporaryMaterial: bound } : {}),
  sections: [
    {
      kind: "experience",
      heading: "Experience",
      entries: [{ lines: ["Engineer"], bullets: [{ text: "Built things", change: "kept" }] }],
    },
  ],
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

interface Handlers {
  onGenerate: ReturnType<typeof vi.fn<() => void>>;
  onApplyWithUploaded: ReturnType<typeof vi.fn<() => void>>;
  onPreviewShown: ReturnType<typeof vi.fn<(contentSha256: string) => void>>;
}

async function render(
  view: GenerationView,
  options: {
    application?: Application | undefined;
    nativeMaterials?: boolean;
    busy?: boolean;
    send?: typeof fetch;
  } = {},
): Promise<Handlers> {
  const handlers: Handlers = {
    onGenerate: vi.fn<() => void>(),
    onApplyWithUploaded: vi.fn<() => void>(),
    onPreviewShown: vi.fn<(contentSha256: string) => void>(),
  };
  await act(async () =>
    root.render(
      <GeneratedResumePanel
        application={options.application}
        view={view}
        nativeMaterials={options.nativeMaterials ?? true}
        nowMs={NOW}
        busy={options.busy ?? false}
        onGenerate={handlers.onGenerate}
        onApplyWithUploaded={handlers.onApplyWithUploaded}
        onPreviewShown={handlers.onPreviewShown}
        {...(options.send ? { fetchImplementation: options.send } : {})}
      />,
    ),
  );
  return handlers;
}

const buttons = () => Array.from(container.querySelectorAll("button"));
const button = (label: string | RegExp) =>
  buttons().find((element) =>
    typeof label === "string"
      ? element.textContent === label
      : label.test(element.textContent ?? ""),
  );

describe("GeneratedResumePanel", () => {
  it("offers Generate before anything is requested, and calls it once", async () => {
    const handlers = await render({ kind: "idle" }, { application: undefined });
    expect(container.textContent).toContain("We never add or reword anything");
    await act(async () => button("Generate resume")?.click());
    expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/Check generated resume|may still be preparing/u);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("shows an honest loading state with no manual check button", async () => {
    const handlers = await render({ kind: "preparing", requestedAtMs: NOW - 42_000 });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Generating your resume");
    expect(status?.textContent).toContain("usually takes 1 to 2 minutes");
    expect(status?.textContent).toContain("Started 0:42 ago");
    expect(status?.textContent).toContain("updates by itself");
    expect(container.querySelector(".spinner")?.getAttribute("aria-hidden")).toBe("true");
    expect(button("Generate resume")).toBeUndefined();
    expect(button(/Check/u)).toBeUndefined();
    await act(async () => button("Skip and apply with my uploaded resume")?.click());
    expect(handlers.onApplyWithUploaded).toHaveBeenCalledTimes(1);
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it.each([
    ["generation_failed", "could not generate your resume this time", true],
    ["generation_timed_out", "took longer than expected", true],
    ["no_resume", "could not find an uploaded resume", false],
  ] as const)("shows a clear %s failure with the right recovery", async (code, copy, retry) => {
    const handlers = await render({ kind: "failed", code });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(copy);
    expect(container.textContent).not.toContain("may still be preparing");
    expect(Boolean(button("Try again"))).toBe(retry);
    if (retry) {
      await act(async () => button("Try again")?.click());
      expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
    }
    await act(async () => button("Apply with my uploaded resume")?.click());
    expect(handlers.onApplyWithUploaded).toHaveBeenCalledTimes(1);
  });

  it("shows expiry clearly with one-click regeneration", async () => {
    const handlers = await render({ kind: "expired" });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "expired and was deleted",
    );
    await act(async () => button("Generate again")?.click());
    expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("disables actions while another is in flight", async () => {
    await render({ kind: "expired" }, { busy: true });
    expect(button("Generate again")?.disabled).toBe(true);
    expect(button("Apply with my uploaded resume")?.disabled).toBe(true);
  });

  describe("ready", () => {
    function native() {
      const bound = material();
      const calls: string[] = [];
      const send = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("format=preview")) return json(previewBody(bound));
        return json({
          format: "pdf",
          mediaType: "application/pdf",
          fileName: "tailored-resume.pdf",
          sha256: "c".repeat(64),
          sizeBytes: 4,
          contentSha256: CONTENT_HASH,
          contentBase64: "JVBERg==",
          temporaryMaterial: bound,
        });
      });
      return {
        bound,
        calls,
        send,
        app: application({ temporaryMaterials: [bound] }),
      };
    }

    it("loads the exact preview through the BFF, shows expiry, and reports the shown hash", async () => {
      const { bound, send, app, calls } = native();
      const handlers = await render({ kind: "ready", material: bound }, { application: app, send });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`/api/platform/applications/${APP}/resume/content?`);
      expect(container.textContent).toContain("Built things");
      expect(container.textContent).toContain("deleted 30 minutes after it was made");
      expect(container.textContent).toContain("in about 25 min");
      expect(handlers.onPreviewShown).toHaveBeenCalledWith(CONTENT_HASH);
      expect(container.textContent).not.toMatch(/Sign in|Disconnect|DOCX|Word/u);
      expect((await axe.run(container)).violations).toEqual([]);
    });

    it("downloads only a verified PDF", async () => {
      const { bound, send, app } = native();
      const created: Blob[] = [];
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: (blob: Blob) => {
          created.push(blob);
          return "blob:synthetic";
        },
        revokeObjectURL: vi.fn(),
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(button(/Word|DOCX/u)).toBeUndefined();
      await act(async () => button("Download PDF")?.click());
      await act(async () => undefined);
      // "JVBERg==" decodes to %PDF; its real digest differs from the stub's, so it is refused.
      expect(container.textContent).toContain("could not be downloaded");
      expect(created).toHaveLength(0);
      expect(click).not.toHaveBeenCalled();
      click.mockRestore();
    });

    it("offers a retry when the resume cannot be loaded", async () => {
      const { bound, app } = native();
      const send = vi.fn<typeof fetch>(async () => json({ code: "x" }, 503));
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be loaded right now",
      );
      await act(async () => button("Try loading again")?.click());
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("regenerates from the ready state", async () => {
      const { bound, send, app } = native();
      const handlers = await render({ kind: "ready", material: bound }, { application: app, send });
      await act(async () => button("Generate again")?.click());
      expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
    });

    it("uses the synchronous tailored resume when native materials are off", async () => {
      const send = vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === `/api/platform/applications/${APP}/resume`) return json(previewBody(undefined));
        return json({ code: "x" }, 404);
      });
      const handlers = await render(
        { kind: "ready" },
        { application: application(), nativeMaterials: false, send },
      );
      expect(send).toHaveBeenCalledWith(
        `/api/platform/applications/${APP}/resume`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(container.textContent).toContain("Built things");
      expect(container.textContent).toContain("Tailored resume ready");
      expect(handlers.onPreviewShown).toHaveBeenCalledWith(CONTENT_HASH);
    });
  });
});

describe("GeneratedCoverLetterPanel", () => {
  const letter = (): ApplicationTemporaryMaterial => ({
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: GEN,
    version: 1,
    contentSha256: CONTENT_HASH,
    completedAtMs: NOW - 60_000,
    expiresAtMs: NOW - 60_000 + 1_800_000,
  });
  const body = (bound: ApplicationTemporaryMaterial) => ({
    status: "ready",
    documentId: APP,
    version: 1,
    contentSha256: CONTENT_HASH,
    matchesPacket: true,
    reviewRequired: true,
    paragraphs: [{ text: "Dear hiring team", factIds: [JOB] }],
    model: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" },
    promptVersion: "1",
    temporaryMaterial: bound,
  });

  async function mountLetter(app: Application, send: typeof fetch) {
    await act(async () =>
      root.render(<GeneratedCoverLetterPanel application={app} fetchImplementation={send} />),
    );
    await act(async () => undefined);
  }

  it("shows the opt-in cover letter read through the BFF, independent of the resume", async () => {
    const bound = letter();
    const send = vi.fn<typeof fetch>(async () => json(body(bound)));
    await mountLetter(application({ temporaryMaterials: [bound] }), send);
    expect(String(send.mock.calls[0]?.[0])).toContain("/cover-letter/content?");
    expect(container.textContent).toContain("Dear hiring team");
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("renders nothing without a cover letter", async () => {
    const send = vi.fn<typeof fetch>();
    await mountLetter(application(), send);
    expect(container.textContent).toBe("");
    expect(send).not.toHaveBeenCalled();
  });

  it("says plainly when the cover letter expired, without reading it", async () => {
    const expired = { ...letter(), completedAtMs: NOW - 3_600_000, expiresAtMs: NOW - 1_800_000 };
    const send = vi.fn<typeof fetch>();
    await mountLetter(application({ temporaryMaterials: [expired] }), send);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "cover letter expired",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("offers a retry when it cannot be loaded", async () => {
    const bound = letter();
    const send = vi.fn<typeof fetch>(async () => json({ code: "x" }, 503));
    await mountLetter(application({ temporaryMaterials: [bound] }), send);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent === "Try loading again")
        ?.click(),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("CoverLetterSection", () => {
  async function mountSection(props: Partial<Parameters<typeof CoverLetterSection>[0]> = {}) {
    await act(async () =>
      root.render(
        <CoverLetterSection
          application={application()}
          enabled
          busy={false}
          onGenerate={() => undefined}
          {...props}
        />,
      ),
    );
  }

  it("is a minimal step like the resume one: a line, collapsed details and one button", async () => {
    const onGenerate = vi.fn();
    await mountSection({ onGenerate });
    expect(container.querySelector("h3")?.textContent).toBe("Cover letter (optional)");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("details")?.textContent).toContain("OpenAI");
    await act(async () => container.querySelector("button")?.click());
    expect(onGenerate).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("is disabled while busy and absent when the feature is off", async () => {
    await mountSection({ busy: true });
    expect(container.querySelector("button")?.disabled).toBe(true);
    await mountSection({ enabled: false });
    expect(container.textContent).toBe("");
  });

  it("offers to generate again after the cover letter expired", async () => {
    const expired = {
      schemaVersion: 1,
      kind: "cover_letter",
      generationId: GEN,
      version: 1,
      contentSha256: CONTENT_HASH,
      completedAtMs: NOW - 3_600_000,
      expiresAtMs: NOW - 1_800_000,
    } as ApplicationTemporaryMaterial;
    const onGenerate = vi.fn();
    await mountSection({ application: application({ temporaryMaterials: [expired] }), onGenerate });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("expired");
    await act(async () => container.querySelector("button")?.click());
    expect(onGenerate).toHaveBeenCalledOnce();
  });
});
