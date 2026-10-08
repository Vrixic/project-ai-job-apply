import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { expect, it, vi } from "vitest";
import { ApplicationsService, type ApplicationsServiceDependencies } from "./service.js";
import type { ApplicationView } from "./store.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function setup(kind: "cover_letter" | "tailored_resume" = "cover_letter") {
  const completedAtMs = Date.now();
  const reference = {
    schemaVersion: 1 as const,
    kind,
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
      artifactHashes: {
        [kind === "cover_letter" ? "coverLetter" : "resume"]: reference.contentSha256,
      },
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

it("authorizes only the exact current resume and strips ownership from its scalar response", async () => {
  const f = setup("tailored_resume");
  const service = new ApplicationsService(f.dependencies);
  const proof = await service.resumeMaterialAuthorization(id(1), id(2), id(3));
  expect(compileComponentValidator("ApplicationTemporaryMaterialAuthorization")(proof)).toBe(true);
  expect(proof.temporaryMaterial.kind).toBe("tailored_resume");
  expect(proof.temporaryMaterial).not.toHaveProperty("ownerUserId");
  await expect(service.temporaryMaterialAuthorization(id(1), id(2), id(3))).rejects.toThrow();
  await expect(service.resumeMaterialAuthorization(id(1), id(2), id(5))).rejects.toThrow();
  expect(f.resolve).not.toHaveBeenCalled();
});
it("defaults resume authorization off before owner reads", async () => {
  const f = setup("tailored_resume");
  delete f.dependencies.nativeReadAuthorizationsEnabled;
  await expect(
    new ApplicationsService(f.dependencies).resumeMaterialAuthorization(id(1), id(2), id(3)),
  ).rejects.toThrow("Applications are unavailable");
  expect(f.dependencies.store.getApplication).not.toHaveBeenCalled();
});
