// @vitest-environment jsdom

import { createHash } from "node:crypto";
import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationView } from "../lib/apply-flow";
import { dropUploadedResume } from "../lib/uploaded-resume-cache";
import {
  CoverLetterSection,
  GeneratedCoverLetterPanel,
  GeneratedResumePanel,
} from "./generated-resume-panel";

// The viewer needs a canvas that jsdom does not have; it is proven in a real browser separately.
const viewer = vi.hoisted(() => ({ fails: false }));
vi.mock("./resume-pdf-viewer", async () => {
  const react = await import("react");
  return {
    ResumePdfViewer: ({
      bytes,
      label,
      onRendered,
      onFailed,
    }: {
      bytes: Uint8Array;
      label: string;
      onRendered(): void;
      onFailed(): void;
    }) => {
      react.useEffect(() => {
        if (viewer.fails) onFailed();
        else onRendered();
      }, [onRendered, onFailed]);
      return react.createElement("div", {
        role: "img",
        "aria-label": label,
        "data-bytes": bytes.byteLength,
      });
    },
  };
});

// The comparison needs PDF.js and a canvas; its line matching is proven in lib/resume-diff.test.ts.
vi.mock("./resume-diff-viewer", async () => {
  const react = await import("react");
  return {
    ResumeDiffViewer: ({
      originalBytes,
      tailoredBytes,
      onClose,
    }: {
      originalBytes: Uint8Array;
      tailoredBytes: Uint8Array;
      onClose(): void;
    }) =>
      react.createElement(
        "section",
        {
          "aria-label": "Comparison",
          "data-original": originalBytes.byteLength,
          "data-tailored": tailoredBytes.byteLength,
        },
        react.createElement("button", { type: "button", onClick: onClose }, "Hide comparison"),
      ),
  };
});

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const PACKET = "00000000-0000-7000-8000-000000000003";
const GEN = "00000000-0000-7000-8000-000000000020";
const PACKET_HASH = "b".repeat(64);
const CONTENT_HASH = "a".repeat(64);
const AT = "2026-10-20T12:00:00.000Z";
const NOW = Date.now();
const FILE_NAME = `Vrij_Patel_Software_Engineer_${APP}.pdf`;

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

const PDF_BYTES = Buffer.from("%PDF-1.4\n%synthetic resume\n%%EOF\n", "latin1");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");
const pdfBody = (bound: ApplicationTemporaryMaterial | undefined, sha256 = PDF_SHA) => ({
  format: "pdf",
  mediaType: "application/pdf",
  fileName: "tailored-resume.pdf",
  sha256,
  sizeBytes: PDF_BYTES.byteLength,
  contentSha256: CONTENT_HASH,
  contentBase64: PDF_BYTES.toString("base64"),
  ...(bound ? { temporaryMaterial: bound } : {}),
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
  dropUploadedResume();
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
        fileName={FILE_NAME}
        onGenerate={handlers.onGenerate}
        onApplyWithUploaded={handlers.onApplyWithUploaded}
        onPreviewShown={handlers.onPreviewShown}
        {...(options.send ? { fetchImplementation: options.send } : {})}
      />,
    ),
  );
  // The read, its digest check and the first drawing take several ticks.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
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
    function native(body: (bound: ApplicationTemporaryMaterial) => unknown = pdfBody) {
      const bound = material();
      const calls: string[] = [];
      const send = vi.fn<typeof fetch>(async (input) => {
        calls.push(String(input));
        return json(body(bound));
      });
      return { bound, calls, send, app: application({ temporaryMaterials: [bound] }) };
    }

    beforeEach(() => {
      viewer.fails = false;
    });

    it("shows the exact PDF read through the BFF, with its expiry, and reports the shown hash", async () => {
      const { bound, send, app, calls } = native();
      const handlers = await render({ kind: "ready", material: bound }, { application: app, send });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain(`/api/platform/applications/${APP}/resume/content?`);
      expect(calls[0]).toContain("format=pdf");
      const preview = container.querySelector('[role="img"]');
      expect(preview?.getAttribute("aria-label")).toBe("Preview of your tailored resume");
      expect(preview?.getAttribute("data-bytes")).toBe(String(PDF_BYTES.byteLength));
      expect(container.textContent).toContain("deleted 30 minutes after it was made");
      expect(container.textContent).toContain("in about 25 min");
      expect(container.textContent).not.toMatch(/Kept|Moved up|Left out|Sign in|DOCX|Word/u);
      expect(handlers.onPreviewShown).toHaveBeenCalledWith(CONTENT_HASH);
      expect((await axe.run(container)).violations).toEqual([]);
    });

    it("downloads the shown PDF under the User_Job_Name_ID name", async () => {
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
      const names: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        names.push(this.download);
      });
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(button(/Word|DOCX/u)).toBeUndefined();
      await act(async () => button("Download PDF")?.click());
      // The file is the one already read and shown: no second read, and the generator's own name
      // ("tailored-resume.pdf") is never used.
      expect(send).toHaveBeenCalledTimes(1);
      expect(names).toEqual([FILE_NAME]);
      expect(created).toHaveLength(1);
      expect(created[0]?.type).toBe("application/pdf");
      expect(container.textContent).toContain(`${FILE_NAME} downloaded.`);
      click.mockRestore();
    });

    describe("comparison with the uploaded resume", () => {
      const ORIGINAL_BYTES = Buffer.from("%PDF-1.4\n%the candidate's own file\n%%EOF\n", "latin1");
      const ORIGINAL_SHA = createHash("sha256").update(ORIGINAL_BYTES).digest("hex");
      const uploadedBody = (overrides: Record<string, unknown> = {}) => ({
        documentId: "00000000-0000-7000-8000-000000000040",
        fileName: "my-resume.pdf",
        format: "pdf",
        mediaType: "application/pdf",
        sha256: ORIGINAL_SHA,
        sizeBytes: ORIGINAL_BYTES.byteLength,
        contentBase64: ORIGINAL_BYTES.toString("base64"),
        ...overrides,
      });
      function withUploaded(uploaded: (() => Response) | Record<string, unknown> = uploadedBody()) {
        const bound = material();
        const calls: string[] = [];
        const send = vi.fn<typeof fetch>(async (input) => {
          calls.push(String(input));
          if (String(input).includes("/resume/original"))
            return typeof uploaded === "function" ? uploaded() : json(uploaded);
          return json(pdfBody(bound));
        });
        return { bound, calls, send, app: application({ temporaryMaterials: [bound] }) };
      }

      it("reads the candidate's own file only when asked, then shows the comparison and can hide it", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        expect(calls.some((call) => call.includes("/resume/original"))).toBe(false);
        await act(async () => button("See what changed")?.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
        expect(calls.filter((call) => call.endsWith(`/${APP}/resume/original`))).toHaveLength(1);
        const comparison = container.querySelector('[aria-label="Comparison"]');
        expect(comparison?.getAttribute("data-original")).toBe(String(ORIGINAL_BYTES.byteLength));
        expect(comparison?.getAttribute("data-tailored")).toBe(String(PDF_BYTES.byteLength));
        expect(button("See what changed")).toBeUndefined();
        await act(async () => button("Hide comparison")?.click());
        expect(container.querySelector('[aria-label="Comparison"]')).toBeNull();
        expect(button("See what changed")).toBeDefined();
      });

      it("reads the original through its own route, never the attach route that refuses a generated resume", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
        expect(calls.some((call) => call.endsWith(`/${APP}/resume/original`))).toBe(true);
        expect(calls.some((call) => call.includes("/resume/uploaded"))).toBe(false);
      });

      const uploadedReads = (calls: string[]) =>
        calls.filter((call) => call.endsWith(`/${APP}/resume/original`)).length;
      const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

      it("reads the original once: hiding and showing the comparison again asks the server for nothing", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        await act(async () => button("Hide comparison")?.click());
        await act(async () => button("See what changed")?.click());
        await settle();
        expect(container.querySelector('[aria-label="Comparison"]')).not.toBeNull();
        expect(uploadedReads(calls)).toBe(1);
      });

      it("keeps the original in memory across the panel going away and coming back", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        expect(uploadedReads(calls)).toBe(1);
        // The panel leaves the page (another tab of the workspace) and returns for the same packet.
        await act(async () => root.render(null));
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        expect(container.querySelector('[aria-label="Comparison"]')).not.toBeNull();
        expect(uploadedReads(calls)).toBe(1);
      });

      it("reads the original again for a new packet, never reusing one held for the old", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        await act(async () => root.render(null));
        const next = application({ temporaryMaterials: [bound], packetHash: "d".repeat(64) });
        await render({ kind: "ready", material: bound }, { application: next, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        expect(uploadedReads(calls)).toBe(2);
      });

      it("reads the original again once the held copy is dropped", async () => {
        const { bound, send, app, calls } = withUploaded();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        await act(async () => root.render(null));
        dropUploadedResume();
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await settle();
        expect(uploadedReads(calls)).toBe(2);
      });

      it("says so when the uploaded resume is not a PDF", async () => {
        const { bound, send, app } = withUploaded(
          uploadedBody({
            format: "docx",
            mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        );
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
          "available when your uploaded resume is a PDF",
        );
        expect(container.querySelector('[aria-label="Comparison"]')).toBeNull();
      });

      it("refuses a file whose digest does not match what the server described", async () => {
        const { bound, send, app } = withUploaded(uploadedBody({ sha256: "c".repeat(64) }));
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
          "That did not go through",
        );
        expect(container.querySelector('[aria-label="Comparison"]')).toBeNull();
      });

      it("shows fixed copy when the server will not hand the file over", async () => {
        const { bound, send, app } = withUploaded(() =>
          json({ code: "application_packet_stale" }, 409),
        );
        await render({ kind: "ready", material: bound }, { application: app, send });
        await act(async () => button("See what changed")?.click());
        await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Comparison"]')).toBeNull();
        expect(button("See what changed")?.disabled).toBe(false);
      });
    });

    it("refuses a file whose digest does not match and shows no resume", async () => {
      const { bound, send, app } = native((value) => pdfBody(value, "c".repeat(64)));
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(container.querySelector('[role="img"]')).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "could not verify your resume",
      );
      expect(button("Download PDF")?.disabled).toBe(true);
    });

    it("keeps Download available when the PDF cannot be drawn", async () => {
      viewer.fails = true;
      const { bound, send, app } = native();
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be shown here",
      );
      expect(button("Download PDF")?.disabled).toBe(false);
    });

    it("offers a retry when the resume cannot be loaded", async () => {
      const bound = material();
      const app = application({ temporaryMaterials: [bound] });
      const send = vi.fn<typeof fetch>(async () => json({ code: "x" }, 503));
      await render({ kind: "ready", material: bound }, { application: app, send });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be loaded right now",
      );
      expect(button("Download PDF")?.disabled).toBe(true);
      await act(async () => button("Try loading again")?.click());
      expect(send).toHaveBeenCalledTimes(2);
    });

    it("offers no regeneration while the resume is ready", async () => {
      const { bound, send, app } = native();
      const handlers = await render({ kind: "ready", material: bound }, { application: app, send });
      expect(container.textContent).not.toContain("Generate again");
      expect(handlers.onGenerate).not.toHaveBeenCalled();
    });

    it("reads the synchronous tailored resume file when native materials are off", async () => {
      const send = vi.fn<typeof fetch>(async (input) => {
        if (String(input) === `/api/platform/applications/${APP}/resume/file?format=pdf`)
          return json(pdfBody(undefined));
        return json({ code: "x" }, 404);
      });
      const handlers = await render(
        { kind: "ready" },
        { application: application(), nativeMaterials: false, send },
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role="img"]')).not.toBeNull();
      expect(container.textContent).toContain("Tailored resume ready");
      expect(handlers.onPreviewShown).toHaveBeenCalledWith(CONTENT_HASH);
    });

    it("refuses the synchronous file when it is not the packet's resume", async () => {
      const send = vi.fn<typeof fetch>(async () =>
        json({ ...pdfBody(undefined), contentSha256: "d".repeat(64) }),
      );
      const handlers = await render(
        { kind: "ready" },
        { application: application(), nativeMaterials: false, send },
      );
      expect(container.querySelector('[role="img"]')).toBeNull();
      expect(handlers.onPreviewShown).not.toHaveBeenCalled();
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

  it("is a minimal step like the resume one: one short line and one button", async () => {
    const onGenerate = vi.fn();
    await mountSection({ onGenerate });
    expect(container.querySelector("h3")?.textContent).toBe("Cover letter (optional)");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe(
      "Generates a cover letter based on your resume and the job description.",
    );
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).not.toMatch(/OpenAI|retain|training/u);
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
