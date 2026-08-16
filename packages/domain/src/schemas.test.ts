import { readdir, readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

describe("domain schema registry", () => {
  it("compiles every version-one JSON Schema", async () => {
    const directory = new URL("../schemas/v1/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".schema.json"));
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);

    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const schema = JSON.parse(await readFile(new URL(file, directory), "utf8")) as object;
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });

  it("enforces live descriptions while permitting minimal canonical-job tombstones", async () => {
    const schema = JSON.parse(
      await readFile(new URL("../schemas/v1/canonical-job.schema.json", import.meta.url), "utf8"),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const base = {
      id: "019d04cf-1f80-7000-8000-000000000001",
      companyId: "019d04cf-1f80-7000-8000-000000000002",
      title: "Synthetic Engineer",
      locations: ["Remote - US"],
      sources: [
        {
          provider: "other",
          url: "https://jobs.example.test/synthetic/1",
          canonicalUrl: "https://jobs.example.test/synthetic/1",
          observedAt: "2026-08-11T12:00:00.000Z",
          provenance: "authorized_fixture",
          contentHash: "a".repeat(64),
        },
      ],
      freshness: {
        firstObservedAt: "2026-08-11T12:00:00.000Z",
        lastVerifiedAt: "2026-08-11T12:00:00.000Z",
        expiresAt: "2026-09-10T12:00:00.000Z",
      },
    };

    expect(validate({ ...base, status: "active" })).toBe(false);
    expect(validate({ ...base, status: "active", description: "Synthetic fixture." })).toBe(true);
    expect(validate({ ...base, status: "expired" })).toBe(true);
    expect(validate({ ...base, status: "removed" })).toBe(false);
  });

  it("keeps saved-job ownership private and snapshots bounded to public job fields", async () => {
    const schema = JSON.parse(
      await readFile(new URL("../schemas/v1/saved-job.schema.json", import.meta.url), "utf8"),
    ) as object;
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const savedJob = {
      id: "019d04cf-1f80-7000-8000-000000000010",
      ownerUserId: "019d04cf-1f80-7000-8000-000000000011",
      requestedJobId: "019d04cf-1f80-7000-8000-000000000012",
      resolvedCanonicalJobIdAtSave: "019d04cf-1f80-7000-8000-000000000012",
      jobSnapshot: {
        jobIdAtSave: "019d04cf-1f80-7000-8000-000000000012",
        company: {
          id: "019d04cf-1f80-7000-8000-000000000013",
          name: "Synthetic Company",
        },
        title: "Synthetic Engineer",
        locations: ["Remote - US"],
        firstObservedAt: "2026-08-15T12:00:00.000Z",
        lastVerifiedAt: "2026-08-15T12:00:00.000Z",
        expiresAt: "2026-09-14T12:00:00.000Z",
      },
      savedAt: "2026-08-15T12:00:00.000Z",
    };

    expect(validate(savedJob)).toBe(true);
    expect(
      validate({
        ...savedJob,
        jobSnapshot: { ...savedJob.jobSnapshot, description: "must not be copied" },
      }),
    ).toBe(false);
    expect(validate({ ...savedJob, recruiterResponse: "interview" })).toBe(false);
  });
});
