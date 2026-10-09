// @vitest-environment jsdom
import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { announceNativeMaterialSignOut } from "../lib/native-material-sign-out-signal";
import { NativeApplicationMaterials } from "./native-application-materials";

const mocks = vi.hoisted(() => ({ read: vi.fn(), hash: vi.fn() }));
vi.mock("../lib/native-material-client", () => ({ readNativeMaterial: mocks.read }));
vi.mock("../lib/applications-client", () => ({ sha256OfBytes: mocks.hash }));
vi.mock("../lib/native-material-session", () => ({
  NativeMaterialSession: class {
    ready = false;
    expiresAt: number | undefined;
    timer: ReturnType<typeof setTimeout> | undefined;
    async signIn() {
      this.ready = true;
      this.expiresAt = Date.now() + 600_000;
      this.timer = setTimeout(() => this.clear(), 600_000);
    }
    clear() {
      this.ready = false;
      this.expiresAt = undefined;
      clearTimeout(this.timer);
    }
  },
}));
const HASH = "a".repeat(64);
let root: Root;
let container: HTMLDivElement;
let application: Application;
let material: ApplicationTemporaryMaterial;
const onReady = vi.fn();
const onUnavailable = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  material = {
    schemaVersion: 1,
    kind: "tailored_resume",
    generationId: "00000000-0000-7000-8000-000000000003",
    version: 1,
    contentSha256: HASH,
    completedAtMs: Date.now(),
    expiresAtMs: Date.now() + 1_800_000,
  };
  application = {
    id: "00000000-0000-7000-8000-000000000001",
    revision: 3,
    currentAction: "ready_to_submit",
    currentPacket: {
      id: "00000000-0000-7000-8000-000000000002",
      packetHash: HASH,
      artifactHashes: { resume: HASH },
      temporaryMaterials: [material],
    },
  } as Application;
  mocks.read.mockImplementation(async (_session, _binding, format) =>
    format === "preview"
      ? {
          status: "ready",
          sections: [
            { kind: "experience", entries: [{ lines: ["Synthetic native preview"], bullets: [] }] },
          ],
        }
      : {
          format,
          mediaType: "application/pdf",
          contentBase64: btoa("test"),
          sha256: HASH,
          sizeBytes: 4,
        },
  );
  mocks.hash.mockResolvedValue(HASH);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <NativeApplicationMaterials
        application={application}
        configuration={{
          domain: "identity.example.test",
          clientId: "synthetic-client",
          baseHost: "materials.example.test",
        }}
        busy={false}
        onReady={onReady}
        onUnavailable={onUnavailable}
      />,
    ),
  );
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (value) => value.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
async function connect() {
  await render();
  await click("Sign in to view generated materials");
}

it("clears previews at the credential deadline even when the SDK already cleared its expiry getter", async () => {
  vi.useFakeTimers();
  await connect();
  expect(container.textContent).toContain("Synthetic native preview");
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(container.textContent).not.toContain("Synthetic native preview");
  expect(container.textContent).toContain("Sign in to view generated materials");
  expect(onUnavailable).toHaveBeenCalled();
});

it("drops preview availability at original material expiry", async () => {
  vi.useFakeTimers();
  material.expiresAtMs = Date.now() + 1000;
  material.completedAtMs = material.expiresAtMs - 1_800_000;
  await connect();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.textContent).not.toContain("Synthetic native preview");
  expect(container.textContent).toContain(
    "These materials expired. Prepare the application again.",
  );
});

it("does not deliver a held file after approval is reopened", async () => {
  await connect();
  let resolve!: (hash: string) => void;
  mocks.hash.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const createObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  await click("Download resume PDF");
  application = { ...application, revision: 4, currentAction: "review_and_approve" };
  await render();
  expect(Array.from(mocks.hash.mock.calls[0]?.[0] as Uint8Array)).toEqual([0, 0, 0, 0]);
  await act(async () => resolve(HASH));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Approved material downloaded.");
});

it("a preview completed after disconnect cannot restore availability", async () => {
  let resolve!: (value: unknown) => void;
  mocks.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await connect();
  await click("Disconnect material access");
  await act(async () => resolve({ status: "ready", sections: [] }));
  expect(onReady).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Sign in to view generated materials");
});

it("rejects corrupt download bytes and clears its decoded buffer", async () => {
  await connect();
  const createObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  mocks.hash.mockResolvedValue("b".repeat(64));
  await click("Download resume PDF");
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(Array.from(mocks.hash.mock.calls[0]?.[0] as Uint8Array)).toEqual([0, 0, 0, 0]);
  expect(container.textContent).toContain("could not be verified and downloaded");
});

it("clears a held preview when another tab announces sign-out", async () => {
  await connect();
  await act(async () => {
    announceNativeMaterialSignOut();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(container.textContent).not.toContain("Synthetic native preview");
  expect(container.textContent).toContain("Sign in to view generated materials");
});

it("refuses native sign-in when cross-tab withdrawal is unavailable", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  await render();
  expect(container.querySelector("button")?.disabled).toBe(true);
  expect(container.textContent).toContain("cannot coordinate material sign-out");
  expect(mocks.read).not.toHaveBeenCalled();
});

it("clears local material immediately when the app sign-out link is selected", async () => {
  await connect();
  const anchor = document.createElement("a");
  anchor.href = new URL("/auth/logout", window.location.href).href;
  anchor.addEventListener("click", (event) => event.preventDefault());
  container.append(anchor);
  await act(async () => anchor.click());
  expect(container.textContent).not.toContain("Synthetic native preview");
  expect(container.textContent).toContain("Sign in to view generated materials");
});
