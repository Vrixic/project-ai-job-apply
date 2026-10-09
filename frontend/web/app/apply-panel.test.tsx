// @vitest-environment jsdom

import type { Application } from "@ai-job-apply/api-contracts";
import axe from "axe-core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyPanel, safeApplyUrl } from "./apply-panel";

const APP = "00000000-0000-7000-8000-000000000001";
const HASH = "a".repeat(64);
const AT = "2026-09-19T12:00:00.000Z";

function approved(withResume = true): Application {
  return {
    id: APP,
    canonicalJobId: "00000000-0000-7000-8000-000000000002",
    status: "approved",
    revision: 3,
    currentAction: "ready_to_submit",
    attempts: [],
    createdAt: AT,
    updatedAt: AT,
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000003",
      version: 1,
      packetHash: HASH,
      jobRevision: HASH,
      artifactHashes: withResume ? { resume: HASH } : {},
      fields: [
        {
          fieldKey: "contact.email",
          value: "candidate@example.test",
          origin: "confirmed_fact",
          sourceFactIds: [],
          confidence: 0.99,
          disposition: "auto",
          reasons: [],
          requiresReview: false,
        },
        {
          fieldKey: "job.notice_period",
          value: "2 weeks",
          origin: "user_entered",
          sourceFactIds: [],
          confidence: 1,
          disposition: "review",
          reasons: [],
          requiresReview: true,
        },
      ],
      createdAt: AT,
    },
  } as unknown as Application;
}

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

async function mount(props: Partial<Parameters<typeof ApplyPanel>[0]> = {}) {
  await act(async () => {
    root.render(
      <ApplyPanel
        application={approved()}
        applyUrl="https://boards.example.test/jobs/1"
        onRecordManualSubmission={() => undefined}
        {...props}
      />,
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label || element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

/** The download hashes bytes asynchronously, so wait for the visible outcome, not a fixed delay. */
async function statusText(): Promise<string> {
  // React flushes updates when `act` exits, so let it settle in short slices until a message shows.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const text = container.querySelector("[role=status]")?.textContent ?? "";
    if (text !== "") return text;
  }
  return "";
}

const bytes = new TextEncoder().encode("synthetic resume bytes");
async function sha(data: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
const fileBody = async (overrides: Record<string, unknown> = {}) => ({
  format: "pdf",
  mediaType: "application/pdf",
  fileName: "resume-tailored.pdf",
  sha256: await sha(bytes),
  sizeBytes: bytes.byteLength,
  contentSha256: HASH,
  contentBase64: btoa(String.fromCharCode(...bytes)),
  ...overrides,
});

describe("safeApplyUrl", () => {
  it("offers only a plain https link", () => {
    expect(safeApplyUrl("https://boards.example.test/jobs/1")).toBe(
      "https://boards.example.test/jobs/1",
    );
    for (const bad of [
      undefined,
      "",
      "javascript:alert(1)",
      "http://boards.example.test/jobs/1",
      "https://user:pass@boards.example.test/",
      "not a url",
      "data:text/html,<script>1</script>",
    ]) {
      expect(safeApplyUrl(bad)).toBeUndefined();
    }
  });
});

it("refuses correctly hashed bytes from a different approved resume", async () => {
  const createObjectURL = vi.fn(() => "blob:unexpected");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  const fetchImplementation = vi.fn(
    async () => new Response(JSON.stringify(await fileBody({ contentSha256: "b".repeat(64) }))),
  ) as typeof fetch;
  await mount({ fetchImplementation });
  await act(async () => button("Download PDF").click());
  expect(await statusText()).toContain("changed or expired");
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("never offers an unresolved answer as the literal text null", async () => {
  const value = approved(false);
  if (!value.currentPacket) throw new Error("Missing fixture packet");
  value.currentPacket.fields[0] = {
    ...value.currentPacket.fields[0],
    value: null,
  } as (typeof value.currentPacket.fields)[number];
  await mount({ application: value });
  expect(container.textContent).not.toContain("null");
  expect(container.textContent).not.toContain("Contact email:");
});

it("does not download a held result after leaving the approved application", async () => {
  let resolve: ((response: Response) => void) | undefined;
  const createObjectURL = vi.fn(() => "blob:unexpected");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  const body = await fileBody();
  await mount({
    fetchImplementation: vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ) as typeof fetch,
  });
  await act(async () => button("Download PDF").click());
  act(() => root.render(<div />));
  await act(async () => resolve?.(new Response(JSON.stringify(body))));
  expect(createObjectURL).not.toHaveBeenCalled();
});

describe("ApplyPanel", () => {
  it("opens the employer's page in a new tab and never claims anything was sent", async () => {
    await mount();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://boards.example.test/jobs/1");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("Nothing is sent for you yet");
    expect(container.textContent).not.toMatch(/applied successfully/i);
  });

  it("says so plainly when there is no safe link", async () => {
    await mount({ applyUrl: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("We do not have a safe link");
  });

  it("lists the approved answers and copies one on request", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mount();
    expect(container.textContent).toContain("Contact email:");
    expect(container.textContent).toContain("candidate@example.test");
    expect(container.textContent).toContain("Job notice period:");
    await act(async () => {
      button("Copy Contact email").click();
    });
    expect(writeText).toHaveBeenCalledWith("candidate@example.test");
    expect(container.querySelector("[role=status]")?.textContent).toBe("Contact email copied.");
  });

  it("explains a blocked clipboard instead of failing silently", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    await mount();
    await act(async () => {
      button("Copy Contact email").click();
    });
    expect(container.querySelector("[role=status]")?.textContent).toContain(
      "did not allow copying",
    );
  });

  it("downloads the tailored resume only when its bytes match the verified hash", async () => {
    const created: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:synthetic";
      },
      revokeObjectURL: () => undefined,
    });
    const fetchImplementation = vi.fn(
      async () => new Response(JSON.stringify(await fileBody()), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await mount({ fetchImplementation });
    await act(async () => {
      button("Download PDF").click();
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/platform/applications/${APP}/resume/file?format=pdf`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(await statusText()).toBe("resume-tailored.pdf downloaded.");
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe("application/pdf");
  });

  it("refuses a file whose bytes do not match, and explains a changed resume", async () => {
    const created: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:x";
      },
      revokeObjectURL: () => undefined,
    });
    const tampered = vi.fn(
      async () =>
        new Response(JSON.stringify(await fileBody({ sha256: "0".repeat(64) })), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await mount({ fetchImplementation: tampered });
    await act(async () => {
      button("Download PDF").click();
    });
    expect(await statusText()).toContain("did not pass its check");
    expect(created).toHaveLength(0);

    const stale = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: "application_packet_stale", title: "SECRET upstream" }),
          { status: 409 },
        ),
    ) as unknown as typeof globalThis.fetch;
    act(() => root.unmount());
    root = createRoot(container);
    await mount({ fetchImplementation: stale });
    await act(async () => {
      button("Download Word (DOCX)").click();
    });
    expect(await statusText()).toContain("Prepare the application again");
    expect(container.textContent).not.toContain("SECRET");
  });

  it("offers no resume download when the packet carries no resume", async () => {
    await mount({ application: approved(false) });
    expect(container.textContent).not.toContain("Your tailored resume");
    expect(container.textContent).toContain("Your approved answers");
  });

  it("begins the candidate confirmation flow only on explicit request", async () => {
    const onRecordManualSubmission = vi.fn(async () => undefined);
    await mount({ onRecordManualSubmission });
    expect(container.textContent).toContain("whether the application was submitted");
    expect(onRecordManualSubmission).not.toHaveBeenCalled();
    await act(async () => {
      button("Record submission status").click();
    });
    expect(onRecordManualSubmission).toHaveBeenCalledOnce();
  });

  it("shows fixed copy when recording cannot start", async () => {
    await mount({
      onRecordManualSubmission: async () => {
        throw new Error("SECRET upstream detail");
      },
    });
    await act(async () => {
      button("Record submission status").click();
    });
    expect(container.querySelector("[role=status]")?.textContent).toContain(
      "That did not go through",
    );
    expect(container.textContent).not.toContain("SECRET");
  });

  it("has no automated accessibility violations", async () => {
    await mount();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

it("requires a fresh explicit form match before recording a form-bound approved packet", async () => {
  const application = approved();
  if (!application.currentPacket) throw new Error("Missing fixture packet");
  application.currentPacket.form = {
    adapterId: "generic-assisted-v1",
    variantId: "generic",
    formHash: HASH,
  };
  const record = vi.fn();
  await mount({ application, onRecordManualSubmission: record });
  expect(button("Record submission status").disabled).toBe(true);
  await act(async () => button("Record submission status").click());
  expect(record).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Before submitting on the employer site");
});

it("displays and copies an approved false answer as No during manual Apply", async () => {
  const application = approved(false);
  if (!application.currentPacket) throw new Error("Missing fixture packet");
  application.currentPacket.fields.push({
    fieldKey: "authorization.us_authorized",
    value: false,
    origin: "user_entered",
    sourceFactIds: [],
    confidence: 1,
    disposition: "review",
    reasons: [],
    requiresReview: true,
  });
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await mount({ application });
  expect(container.textContent).toContain("Authorization us authorized: No");
  await act(async () => button("Copy Authorization us authorized").click());
  expect(writeText).toHaveBeenCalledWith("No");
});
