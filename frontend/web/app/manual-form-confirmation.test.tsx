// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import type { Application } from "@ai-job-apply/api-contracts";
import { formStructureHash } from "@ai-job-apply/ats-sdk";
import { CHALLENGE_SUBMISSION_NOTICE } from "@ai-job-apply/ats-sdk/observed-form";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualFormConfirmation, type ManualFormObservation } from "./manual-form-confirmation";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const URL = "https://employer.example/jobs/1";
let observed: {
  schema: string;
  applicationId: string;
  jobId: string;
  destination: string;
  capturedAt: number;
  form: {
    challengePresent: boolean;
    fields: {
      ref: string;
      label: string;
      name: string;
      type: "text";
      required: boolean;
      options: string[];
    }[];
  };
};
let container: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;
let changed: ReturnType<typeof vi.fn<(value: ManualFormObservation | undefined) => void>>;
let job: Record<string, unknown>;
async function click(name: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === name,
  );
  if (!button) throw new Error(name);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function paste() {
  const textarea = container.querySelector("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      JSON.stringify(observed),
    );
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  observed = {
    schema: "application-observed-form.v1",
    applicationId: APP,
    jobId: JOB,
    destination: URL,
    capturedAt: Date.now(),
    form: {
      challengePresent: false,
      fields: [
        { ref: "f0", label: "Email", name: "email", type: "text", required: true, options: [] },
      ],
    },
  };
  const at = new Date(Date.now() - 1000).toISOString();
  job = {
    id: JOB,
    company: { id: APP, name: "Synthetic" },
    title: "Synthetic role",
    locations: ["Remote"],
    description: "Synthetic",
    status: "active",
    firstObservedAt: at,
    lastVerifiedAt: at,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    sources: [
      {
        provider: "other",
        provenance: "authorized_fixture",
        canonicalUrl: URL,
        firstObservedAt: at,
        lastVerifiedAt: at,
      },
    ],
  };
  send = vi.fn(
    async () =>
      new Response(JSON.stringify(job), { headers: { "content-type": "application/json" } }),
  );
  changed = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ManualFormConfirmation
        application={
          {
            id: APP,
            canonicalJobId: JOB,
            revision: 4,
            currentPacket: {
              form: {
                adapterId: "generic-assisted-v1",
                variantId: "generic",
                formHash: formStructureHash(observed.form),
              },
            },
          } as Application
        }
        fetchImplementation={send as typeof fetch}
        onChange={changed}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("fresh form confirmation before manual Apply", () => {
  it("requires explicit confirmation and preserves the original capture timestamp", async () => {
    observed.capturedAt -= 1000;
    await paste();
    await click("Check current form");
    expect(changed.mock.calls.at(-1)?.[0]).toBeUndefined();
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({
      capturedAtEpochMs: observed.capturedAt,
      confirmed: true,
      form: { formHash: formStructureHash(observed.form) },
    });
    expect(JSON.stringify(changed.mock.calls.at(-1))).not.toContain("Email");
    await click("Clear current form");
    expect(changed.mock.calls.at(-1)?.[0]).toBeUndefined();
    expect(container.querySelector("textarea")?.value).toBe("");
  });
  it.each([
    "application",
    "job",
    "destination",
    "changed",
    "expired",
    "future",
    "challenge_against_unchallenged_packet",
    "inactive",
  ] as const)("refuses %s captures", async (kind) => {
    if (kind === "application") observed.applicationId = JOB;
    if (kind === "job") observed.jobId = APP;
    if (kind === "destination") observed.destination = "https://other.example/";
    if (kind === "changed") {
      const field = observed.form.fields[0];
      if (!field) throw new Error("Missing fixture question");
      field.label = "Other question";
    }
    if (kind === "expired") observed.capturedAt -= 60_000;
    if (kind === "future") observed.capturedAt += 10_000;
    if (kind === "challenge_against_unchallenged_packet") observed.form.challengePresent = true;
    if (kind === "inactive") job.status = "inactive";
    await paste();
    await click("Check current form");
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(changed.mock.calls.every((call) => call[0] === undefined)).toBe(true);
  });
  it("confirms a challenge page bound in its packet and tells the candidate to submit themselves", async () => {
    observed.form.challengePresent = true;
    await act(async () =>
      root.render(
        <ManualFormConfirmation
          application={
            {
              id: APP,
              canonicalJobId: JOB,
              revision: 4,
              currentPacket: {
                form: {
                  adapterId: "generic-assisted-v1",
                  variantId: "generic",
                  formHash: formStructureHash(observed.form),
                },
              },
            } as Application
          }
          fetchImplementation={send as typeof fetch}
          onChange={changed}
        />,
      ),
    );
    await paste();
    await click("Check current form");
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.textContent).toContain(CHALLENGE_SUBMISSION_NOTICE);
  });
  it("fences late completion after clear", async () => {
    let release!: (value: Response) => void;
    send.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await paste();
    await click("Check current form");
    await click("Clear current form");
    await act(async () => {
      release(
        new Response(JSON.stringify(job), { headers: { "content-type": "application/json" } }),
      );
    });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
  it("refuses confirmation at the original deadline and clears on leaving the page", async () => {
    observed.capturedAt -= 59_000;
    await paste();
    await click("Check current form");
    vi.spyOn(Date, "now").mockReturnValue(observed.capturedAt + 60_000);
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    expect(changed.mock.calls.at(-1)?.[0]).toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(changed.mock.calls.at(-1)?.[0]).toBeUndefined();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
