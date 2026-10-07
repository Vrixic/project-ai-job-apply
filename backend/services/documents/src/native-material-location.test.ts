import { expect, it, vi } from "vitest";
import { createNativeMaterialLocationReader } from "./native-material-location.js";

const id = "019a4000-0000-7000-8000-000000000001";
const reference = () => {
  const completedAtMs = Date.now();
  return {
    schemaVersion: 1 as const,
    kind: "cover_letter" as const,
    ownerUserId: id,
    applicationId: id,
    generationId: id,
    version: 2,
    contentSha256: "a".repeat(64),
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
};
it("derives only the fixed image-compatible original HTTPS origin", async () => {
  const read = vi.fn(async () => id);
  const resolve = createNativeMaterialLocationReader({
    baseHost: "materials.example.test",
    readAllocation: read,
    enabled: () => true,
  });
  expect(await resolve(reference(), new AbortController().signal)).toBe(
    `https://${id}.materials.example.test:8443`,
  );
});
it.each(["default", "abort", "withdrawn", "identity"])(
  "refuses %s location discovery",
  async (mode) => {
    let enabled = true;
    const c = new AbortController();
    if (mode === "abort") c.abort();
    const read = vi.fn(async () => {
      if (mode === "withdrawn") enabled = false;
      return mode === "identity" ? "https://other.test" : id;
    });
    const resolve = createNativeMaterialLocationReader({
      baseHost: "materials.example.test",
      readAllocation: read,
      ...(mode === "default" ? {} : { enabled: () => enabled }),
    });
    expect(await resolve(reference(), c.signal)).toBeNull();
    if (mode === "default" || mode === "abort") expect(read).not.toHaveBeenCalled();
  },
);
it.each([
  "localhost",
  "https://materials.example.test",
  "materials.example.test:8443",
  "a..test",
  "*.example.test",
])("rejects unsafe baseHost %s", (baseHost) => {
  expect(() =>
    createNativeMaterialLocationReader({ baseHost, readAllocation: async () => id }),
  ).toThrow("NativeMaterialLocationUnavailable");
});
