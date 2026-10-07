import { expect, it } from "vitest";
import { nativeMaterialLocationsFromEnvironment } from "./native-material-location-runtime.js";

const url = "postgres://invalid@127.0.0.1:1/synthetic_only";
it("does not allocate a pool or validate hostname while default off", () => {
  expect(nativeMaterialLocationsFromEnvironment(url, {}, () => true)).toBeUndefined();
});
it("refuses invalid configured hostname before SQL", () => {
  expect(() =>
    nativeMaterialLocationsFromEnvironment(
      url,
      {
        NATIVE_MATERIAL_READ_LOCATIONS_ENABLED: "true",
        NATIVE_MATERIAL_BASE_HOST: "https://other.test",
      },
      () => true,
    ),
  ).toThrow("NativeMaterialLocationUnavailable");
});
it.each(["authorization", "protection", "hostname", "location"])(
  "withdraws %s before SQL",
  async (mode) => {
    const environment = {
      NATIVE_MATERIAL_READ_LOCATIONS_ENABLED: "true",
      NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED: "true",
      NATIVE_MATERIAL_BASE_HOST: "materials.example.test",
    };
    let protection = true;
    const runtime = nativeMaterialLocationsFromEnvironment(url, environment, () => protection);
    if (!runtime) throw Error("SyntheticRuntimeMissing");
    try {
      if (mode === "authorization")
        environment.NATIVE_MATERIAL_READ_AUTHORIZATIONS_ENABLED = "false";
      if (mode === "protection") protection = false;
      if (mode === "hostname") environment.NATIVE_MATERIAL_BASE_HOST = "other.example.test";
      if (mode === "location") environment.NATIVE_MATERIAL_READ_LOCATIONS_ENABLED = "false";
      const id = "019a4000-0000-7000-8000-000000000001",
        completedAtMs = Date.now();
      expect(
        await runtime.resolve(
          {
            schemaVersion: 1,
            kind: "cover_letter",
            ownerUserId: id,
            applicationId: id,
            generationId: id,
            version: 1,
            contentSha256: "a".repeat(64),
            completedAtMs,
            expiresAtMs: completedAtMs + 1_800_000,
          },
          new AbortController().signal,
        ),
      ).toBeNull();
    } finally {
      await runtime.close();
    }
  },
);
