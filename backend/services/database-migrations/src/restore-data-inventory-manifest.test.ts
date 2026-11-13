import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { resolveRestoreDataManifest } from "./restore-data-inventory-manifest.js";
import { loadCurrentRestoreManifest } from "./restore-verifier.js";

const source = loadCurrentRestoreManifest();
const json = JSON.stringify(source.manifest);
const hash = createHash("sha256").update(json).digest("hex");
// The packaged contract must fit one ECS container override (8,192 characters, the AWS limit) beside the rest of that
// override at the largest this deployment can produce, not the AWS or DNS theoretical maxima: the migration container's
// own name (read from Terraform, so a rename cannot go unnoticed) and a development RDS host in the form the replay
// operator validates (24-character instance name, 14-digit restore stamp, 12-character account id, region, domain).
// The migration checksums do not compress, so each new migration costs about 60 bytes: measure with the best
// compression a packager can choose. Margin at 0021: about 300 bytes, roughly five migrations. Dropping the checksums is
// not an option (restore verification binds them), so the migration after that needs a different carrier for this
// contract (a task-definition environment or a small object read by the CLI), not a bigger budget.
const terraform = readFileSync(
  new URL("../../../../infrastructure/terraform/modules/platform/main.tf", import.meta.url),
  "utf8",
);
const containerName = /^\s+name\s+=\s+"(database-migration)"$/mu.exec(terraform)?.[1] ?? "";
const largestHost =
  "ai-job-apply-development-restore-20261112180334.abcdefghijkl.us-east-2.rds.amazonaws.com";
const compressed = gzipSync(json, { level: 9 }).toString("base64");
describe("explicit restore data snapshot contract", () => {
  it("defaults only when both override inputs are absent", () => {
    expect(resolveRestoreDataManifest({})).toEqual(source);
  });
  it("requires exact checksum-bound structural bytes", () => {
    expect(
      resolveRestoreDataManifest({
        RESTORE_DATA_MANIFEST_GZIP_BASE64: compressed,
        RESTORE_DATA_MANIFEST_SHA256: hash,
      }),
    ).toEqual({ manifest: source.manifest, sha256: hash });
  });
  it("fits the complete packaged contract in a bounded ECS task override", () => {
    const override = JSON.stringify({
      containerOverrides: [
        {
          name: containerName,
          command: ["node", "runner/dist/src/restore-data-inventory-cli.js"],
          environment: [
            { name: "RESTORE_DATA_MANIFEST_GZIP_BASE64", value: compressed },
            { name: "RESTORE_DATA_MANIFEST_SHA256", value: hash },
            { name: "RESTORE_HOST", value: largestHost },
          ],
        },
      ],
    });
    expect(containerName).toBe("database-migration");
    expect(compressed.length).toBeLessThanOrEqual(7_700);
    expect(override.length).toBeLessThanOrEqual(8_192);
    // Keep a real margin: the next migration must not be the one that finds out.
    expect(8_192 - override.length).toBeGreaterThanOrEqual(150);
  });
  it("rejects compressed expansion beyond the structural byte budget", () => {
    const oversized = "x".repeat(65_537);
    expect(() =>
      resolveRestoreDataManifest({
        RESTORE_DATA_MANIFEST_GZIP_BASE64: gzipSync(oversized).toString("base64"),
        RESTORE_DATA_MANIFEST_SHA256: createHash("sha256").update(oversized).digest("hex"),
      }),
    ).toThrow("Restore data manifest input is invalid");
  });
  it.each(["!!!!", "eA==", "H4sIAAAAAAAA", `${compressed}=`])(
    "rejects malformed gzip/base64",
    (value) => {
      expect(() =>
        resolveRestoreDataManifest({
          RESTORE_DATA_MANIFEST_GZIP_BASE64: value,
          RESTORE_DATA_MANIFEST_SHA256: hash,
        }),
      ).toThrow("Restore data manifest input is invalid");
    },
  );
  it.each([
    { RESTORE_DATA_MANIFEST_GZIP_BASE64: compressed },
    { RESTORE_DATA_MANIFEST_SHA256: hash },
    { RESTORE_DATA_MANIFEST_GZIP_BASE64: "", RESTORE_DATA_MANIFEST_SHA256: "" },
    { RESTORE_DATA_MANIFEST_GZIP_BASE64: compressed, RESTORE_DATA_MANIFEST_SHA256: "a".repeat(64) },
    { RESTORE_DATA_MANIFEST_GZIP_BASE64: `${compressed}\n`, RESTORE_DATA_MANIFEST_SHA256: hash },
    { RESTORE_DATA_MANIFEST_GZIP_BASE64: "x".repeat(65_537), RESTORE_DATA_MANIFEST_SHA256: hash },
  ])("rejects incomplete, oversized or mismatched input", (environment) => {
    expect(() => resolveRestoreDataManifest(environment)).toThrow(
      "Restore data manifest input is invalid",
    );
  });
  it.each(["candidate-secret", '{"candidate":"candidate-secret"}', "null", "[]"])(
    "redacts malformed checksum-bound content",
    (value) => {
      expect(() =>
        resolveRestoreDataManifest({
          RESTORE_DATA_MANIFEST_GZIP_BASE64: gzipSync(value).toString("base64"),
          RESTORE_DATA_MANIFEST_SHA256: createHash("sha256").update(value).digest("hex"),
        }),
      ).toThrow(new Error("Restore data manifest input is invalid"));
    },
  );
});
