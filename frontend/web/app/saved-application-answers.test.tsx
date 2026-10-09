// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import type { Application } from "@ai-job-apply/api-contracts";
import { formStructureHash } from "@ai-job-apply/ats-sdk";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SavedApplicationAnswerSelection,
  SavedApplicationAnswers,
} from "./saved-application-answers";

const APP = "00000000-0000-7000-8000-000000000001";
const JOB = "00000000-0000-7000-8000-000000000002";
const ID = "00000000-0000-7000-8000-000000000003";
function fixture() {
  const at = new Date(Date.now() - 1000).toISOString();
  return {
    observed: {
      schema: "application-observed-form.v1",
      applicationId: APP,
      jobId: JOB,
      destination: "https://employer.example/jobs/1",
      capturedAt: Date.now(),
      form: {
        challengePresent: false,
        fields: [
          {
            ref: "f0",
            label: "Are you legally authorized to work in the United States?",
            name: "auth",
            type: "select" as const,
            required: true,
            options: ["Yes", "No"],
          },
        ],
      },
    },
    metadata: {
      answers: [
        {
          id: ID,
          fieldKey: "authorization.us_authorized",
          valueType: "boolean",
          sensitivity: "restricted",
          state: "active",
          context: "us.explicit",
          version: 7,
          confirmedAt: at,
        },
      ],
    },
    job: {
      id: JOB,
      company: { id: ID, name: "Synthetic" },
      title: "Synthetic Engineer",
      locations: ["Synthetic location"],
      description: "Synthetic",
      status: "active",
      firstObservedAt: at,
      lastVerifiedAt: at,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      sources: [
        {
          provider: "other",
          provenance: "authorized_fixture",
          canonicalUrl: "https://employer.example/jobs/1",
          firstObservedAt: at,
          lastVerifiedAt: at,
        },
      ],
    },
  };
}
let container: HTMLDivElement;
let root: Root;
let data: ReturnType<typeof fixture>;
let prepare: ReturnType<
  typeof vi.fn<(selection: SavedApplicationAnswerSelection) => Promise<void>>
>;
let send: ReturnType<typeof vi.fn>;
async function click(name: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (value) => value.textContent === name,
  );
  if (!button) throw new Error(`Missing ${name}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function setValue(selector: string, value: string) {
  const input = container.querySelector(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
async function load() {
  await setValue("textarea", JSON.stringify(data.observed));
  await click("Review captured questions");
}
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("crypto", webcrypto);
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  data = fixture();
  prepare = vi.fn(async () => undefined);
  send = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.includes("restricted-answers") ? data.metadata : data.job), {
        headers: { "content-type": "application/json" },
      }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <SavedApplicationAnswers
        application={{ id: APP, canonicalJobId: JOB, revision: 2 } as Application}
        onPrepare={prepare}
        fetchImplementation={send as typeof fetch}
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
describe("explicit observed-question saved-answer selection", () => {
  it("does not infer US jurisdiction from generic work-authorization wording", async () => {
    const field = data.observed.form.fields[0];
    if (!field) throw new Error();
    field.label = "Work authorization";
    await load();
    expect(container.querySelector("select")).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("requires exact context confirmation and sends original version and canonical hashes without values/questions", async () => {
    await load();
    await setValue("select", `${ID}:7`);
    const button = Array.from(container.querySelectorAll("button")).find(
      (value) => value.textContent === "Prepare with selected saved answers",
    );
    expect(button?.disabled).toBe(true);
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    await click("Prepare with selected saved answers");
    await act(async () => {
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce(), {
        timeout: 2000,
        interval: 20,
      });
    });
    expect(prepare.mock.calls[0]?.[0]).toMatchObject({
      form: {
        adapterId: "generic-assisted-v1",
        variantId: "generic",
        formHash: formStructureHash(data.observed.form),
      },
      vaultSelections: [
        {
          id: ID,
          version: 7,
          context: "us.explicit",
          fieldKey: "authorization.us_authorized",
          meaningConfirmed: true,
        },
      ],
    });
    expect(JSON.stringify(prepare.mock.calls)).not.toContain(
      "Are you legally authorized to work in the United States?",
    );
    expect(JSON.stringify(prepare.mock.calls)).not.toContain('"value"');
    expect(send.mock.calls.every(([, options]) => options.cache === "no-store")).toBe(true);
  });
  it("resets semantic confirmation when the selected version/context changes", async () => {
    const original = data.metadata.answers[0];
    if (!original) throw new Error();
    data.metadata.answers.push({
      ...original,
      id: "00000000-0000-7000-8000-000000000004",
      context: "us.other",
      version: 8,
    });
    await load();
    await setValue("select", `${ID}:7`);
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    await setValue("select", "00000000-0000-7000-8000-000000000004:8");
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
      false,
    );
  });
  it.each(["application", "job", "destination", "expired", "future", "value"])(
    "refuses %s import",
    async (kind) => {
      if (kind === "application") data.observed.applicationId = ID;
      if (kind === "job") data.observed.jobId = ID;
      if (kind === "destination") data.observed.destination = "https://other.example/";
      if (kind === "expired") data.observed.capturedAt -= 60_000;
      if (kind === "future") data.observed.capturedAt += 60_000;
      if (kind === "value") Object.assign(data.observed.form.fields[0] ?? {}, { value: "PRIVATE" });
      await load();
      expect(container.querySelector("select")).toBeNull();
      expect(prepare).not.toHaveBeenCalled();
    },
  );
  it("never offers ambiguous, signature, attestation or unmapped questions", async () => {
    const first = data.observed.form.fields[0];
    if (!first) throw new Error();
    data.observed.form.fields = [
      { ...first, ref: "f0", label: "Signature", name: "signature" },
      { ...first, ref: "f1", label: "Unmapped custom question", name: "unknown" },
      {
        ...first,
        ref: "f2",
        label: "Are you legally authorized to work in the United States? and sponsorship",
        name: "auth_sponsorship",
      },
    ];
    await load();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toContain("No unambiguous supported");
  });
  it("clears metadata and choices on hidden state", async () => {
    await load();
    await setValue("select", `${ID}:7`);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(container.querySelector("select")).toBeNull();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(prepare).not.toHaveBeenCalled();
  });
  it("refuses selection at the original capture deadline without renewing it", async () => {
    await load();
    await setValue("select", `${ID}:7`);
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    vi.spyOn(Date, "now").mockReturnValue(data.observed.capturedAt + 60_000);
    await click("Prepare with selected saved answers");
    expect(prepare).not.toHaveBeenCalled();
    expect(container.querySelector("select")).toBeNull();
  });
  it("refuses value-bearing metadata", async () => {
    Object.assign(data.metadata.answers[0] ?? {}, { value: "PRIVATE" });
    await load();
    expect(container.querySelector("select")).toBeNull();
  });
  it.each(["deleted", "expired", "future"])("does not offer %s saved metadata", async (kind) => {
    const answer = data.metadata.answers[0];
    if (!answer) throw new Error();
    if (kind === "deleted") answer.state = "deleted";
    if (kind === "expired")
      Object.assign(answer, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    if (kind === "future") answer.confirmedAt = new Date(Date.now() + 10000).toISOString();
    await load();
    expect(container.querySelectorAll("select option")).toHaveLength(1);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("cancels pending reads and suppresses late metadata after explicit clear", async () => {
    let finish: (response: Response) => void = () => undefined;
    send.mockImplementation((url: string) =>
      url.includes("restricted-answers")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(
            new Response(JSON.stringify(data.job), {
              headers: { "content-type": "application/json" },
            }),
          ),
    );
    await load();
    await click("Clear saved-answer selection");
    expect(send.mock.calls[0]?.[1].signal.aborted).toBe(true);
    await act(async () => {
      finish(
        new Response(JSON.stringify(data.metadata), {
          headers: { "content-type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(container.querySelector("select")).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("bounds an unresponsive metadata read", async () => {
    await setValue("textarea", JSON.stringify(data.observed));
    send.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Review captured questions")
        ?.click();
      await vi.advanceTimersByTimeAsync(20_001);
    });
    expect(container.textContent).toContain("unavailable, changed or expired");
    expect(container.querySelector("select")).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});
