import { expect, it } from "vitest";
import { compileComponentValidator } from "./index.js";

const id = "019a4000-0000-7000-8000-000000000001";
const response = {
  schemaVersion: 1,
  packetId: id,
  packetHash: "a".repeat(64),
  temporaryMaterial: {
    schemaVersion: 1,
    kind: "cover_letter",
    generationId: id,
    version: 2,
    contentSha256: "b".repeat(64),
    completedAtMs: 1000,
    expiresAtMs: 1_801_000,
  },
  origin: `https://${id}.materials.example.test:8443`,
};
const validate = compileComponentValidator("ApplicationTemporaryMaterialLocation");
it("accepts the separate closed v1 scalar location response", () =>
  expect(validate(response)).toBe(true));
it.each([
  { ...response, origin: "http://other.test" },
  { ...response, origin: `https://${id}.materials.example.test:443` },
  { ...response, origin: `https://${id}.materials.example.test:8443/path` },
  { ...response, origin: `https://${id}.materials.example.test:8443?token=forbidden` },
  { ...response, token: "forbidden" },
  { ...response, body: "forbidden" },
])("rejects retargeting and content/credential properties", (bad) =>
  expect(validate(bad)).toBe(false),
);
it("leaves the strict authorization response unchanged", () => {
  expect(compileComponentValidator("ApplicationTemporaryMaterialAuthorization")(response)).toBe(
    false,
  );
  const { origin: _origin, ...authorization } = response;
  expect(
    compileComponentValidator("ApplicationTemporaryMaterialAuthorization")(authorization),
  ).toBe(true);
});
