import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { expect, it, vi } from "vitest";
import { ApplicationsService, type ApplicationsServiceDependencies } from "./service.js";
import type { ApplicationView } from "./store.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function setup() {
  const completedAtMs = Date.now();
  const reference = {
    schemaVersion: 1 as const,
    kind: "cover_letter" as const,
    ownerUserId: id(1),
    applicationId: id(2),
    generationId: id(3),
    version: 2,
    contentSha256: "a".repeat(64),
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
  const view = {
    application: {
      id: id(2),
      ownerUserId: id(1),
      status: "review_required",
      currentPacketId: id(4),
    },
    currentPacket: {
      id: id(4),
      userId: id(1),
      applicationId: id(2),
      packetHash: "b".repeat(64),
      artifactHashes: { coverLetter: reference.contentSha256 },
      temporaryMaterials: [reference],
    },
  } as unknown as ApplicationView;
  const resolve = vi.fn(async () => `https://${id(5)}.materials.example.test:8443`);
  const dependencies = {
    store: { getApplication: vi.fn(async () => view) },
    nativeReadAuthorizationsEnabled: () => true,
    nativeMaterialLocations: { resolve },
  } as unknown as ApplicationsServiceDependencies;
  const controller = new AbortController();
  const read = () =>
    new ApplicationsService(dependencies).temporaryMaterialLocation(
      id(1),
      id(2),
      id(3),
      controller.signal,
    );
  return { reference, view, resolve, dependencies, controller, read };
}
it("returns closed original metadata only after a second current-packet proof", async () => {
  const f = setup();
  const result = await f.read();
  expect(compileComponentValidator("ApplicationTemporaryMaterialLocation")(result)).toBe(true);
  expect(f.resolve).toHaveBeenCalledWith(f.reference, f.controller.signal);
  expect(f.dependencies.store.getApplication).toHaveBeenCalledTimes(4);
  expect(result).not.toHaveProperty("ownerUserId");
});
it.each(["packet", "abort", "disabled", "missing", "origin"])(
  "withholds location after %s changes",
  async (mode) => {
    const f = setup();
    f.resolve.mockImplementation(async () => {
      if (mode === "packet" && f.view.currentPacket)
        f.view.currentPacket.packetHash = "c".repeat(64);
      if (mode === "abort") f.controller.abort();
      if (mode === "disabled") f.dependencies.nativeReadAuthorizationsEnabled = () => false;
      if (mode === "missing") return null as unknown as string;
      return mode === "origin"
        ? "https://arbitrary.example.test"
        : `https://${id(5)}.materials.example.test:8443`;
    });
    await expect(f.read()).rejects.toThrow();
  },
);
it("defaults off before location lookup", async () => {
  const f = setup();
  delete f.dependencies.nativeReadAuthorizationsEnabled;
  await expect(f.read()).rejects.toThrow("Applications are unavailable");
  expect(f.resolve).not.toHaveBeenCalled();
});
