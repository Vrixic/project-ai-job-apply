// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://boards.greenhouse.io/synthetic/jobs/123"}

import type { ApplicationExecutionCommand } from "@ai-job-apply/api-contracts";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  profile: {
    variantId: "synthetic-only",
    adapterVersion: "0.1.0",
    implementationSha256: "a".repeat(64),
    submitSelector: "#submit",
    confirmationSelector: "#confirmation",
    confirmationReferenceAttribute: "data-reference",
  },
}));
vi.mock("../lib/greenhouse/profiles", () => ({
  greenhouseExecutionProfile: () => mocks.profile,
  greenhouseExecutionRegistry: {},
}));
vi.mock("../lib/greenhouse/execute", () => ({ executeGreenhouseApplication: mocks.execute }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function command(): ApplicationExecutionCommand {
  return {
    schema: "application-execution-command.v1",
    nonce: "a".repeat(64),
    attemptId: "00000000-0000-7000-8000-000000000008",
    documentId: "00000000-0000-7000-8000-000000000007",
    employerUrl: location.href,
    packetHash: "b".repeat(64),
    formHash: "c".repeat(64),
    variantId: mocks.profile.variantId,
    adapterVersion: mocks.profile.adapterVersion,
    deadline: Date.now() + 50,
    fields: [
      { fieldKey: "contact.email", value: "synthetic@example.test", needsUserAction: false },
    ],
    files: ["tailored_resume", "cover_letter"].map((kind, index) => ({
      kind,
      generationId: `00000000-0000-7000-8000-00000000000${index + 4}`,
      format: "pdf",
      mediaType: "application/pdf",
      sha256: "d".repeat(64),
      contentBase64: btoa("%PDF-SYNTHETIC"),
    })) as ApplicationExecutionCommand["files"],
  };
}

it("clears the entire two-file command during stalled hashing on expiry, cancel and pagehide", async () => {
  vi.useFakeTimers();
  let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
  const addListener = vi.fn((callback: NonNullable<typeof listener>) => {
    listener = callback;
  });
  const sender = { id: "a".repeat(32) };
  vi.stubGlobal("chrome", {
    runtime: { id: sender.id, onMessage: { addListener }, sendMessage: vi.fn() },
  });
  const buffers: Uint8Array[] = [];
  const digest = vi.fn((_algorithm: unknown, bytes: Uint8Array) => {
    buffers.push(bytes);
    return new Promise<ArrayBuffer>(() => {});
  });
  vi.stubGlobal("crypto", { subtle: { digest } });
  await import("../entrypoints/greenhouse-execution");
  expect(addListener).toHaveBeenCalledTimes(1);
  if (!listener) throw Error("Missing command listener");
  for (const reason of ["expiry", "cancel", "pagehide"]) {
    const message = command();
    const respond = vi.fn();
    expect(listener(message, sender, respond)).toBe(true);
    await flush();
    expect(message.files[0]?.contentBase64).toBe("");
    expect(message.files[1]?.contentBase64).not.toBe("");
    expect(buffers.at(-1)?.some((byte) => byte !== 0)).toBe(true);
    if (reason === "expiry") await vi.advanceTimersByTimeAsync(50);
    if (reason === "cancel")
      listener(
        {
          schema: "application-execution-cancel.v1",
          nonce: message.nonce,
          attemptId: message.attemptId,
        },
        sender,
        vi.fn(),
      );
    if (reason === "pagehide") window.dispatchEvent(new Event("pagehide"));
    await flush();
    expect(respond).toHaveBeenCalledWith({ error: "ApplicationExecutionUnavailable" });
    expect(message.files.every((file) => file.contentBase64 === "")).toBe(true);
    expect(message.fields).toEqual([]);
    expect(buffers.at(-1)?.every((byte) => byte === 0)).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  }
  expect(digest).toHaveBeenCalledTimes(3);
});
