import type { GetObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3CandidateDataExportDownloadSigner } from "./candidate-data-export-download-signer.js";

describe("candidate data-export download signer", () => {
  it("binds the exact object version and caps the grant at artifact expiry", async () => {
    const sign = vi.fn(
      async (_command: GetObjectCommand, _expiresIn: number) =>
        "https://exports.example.test/object?signature=synthetic",
    );
    const signer = new S3CandidateDataExportDownloadSigner(
      "synthetic-export-bucket",
      300,
      undefined,
      { sign },
    );
    const now = new Date("2026-08-25T12:00:00.000Z");

    await expect(
      signer.createGrant({
        objectKey: "candidate-data-exports/user/export.json",
        objectVersion: "exact-version",
        artifactExpiresAt: new Date("2026-08-25T12:02:00.000Z"),
        now,
      }),
    ).resolves.toEqual({
      url: "https://exports.example.test/object?signature=synthetic",
      method: "GET",
      expiresAt: "2026-08-25T12:02:00.000Z",
    });
    expect(sign).toHaveBeenCalledOnce();
    const [command, expiresIn] = sign.mock.calls[0] ?? [];
    expect(expiresIn).toBe(120);
    expect(command?.input).toMatchObject({
      Bucket: "synthetic-export-bucket",
      Key: "candidate-data-exports/user/export.json",
      VersionId: "exact-version",
      ResponseCacheControl: "no-store",
    });
  });

  it("rejects expired artifacts and non-HTTPS signed URLs", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const expired = new S3CandidateDataExportDownloadSigner(
      "synthetic-export-bucket",
      300,
      undefined,
      { sign: vi.fn(async () => "https://exports.example.test/object") },
    );
    await expect(
      expired.createGrant({
        objectKey: "key",
        objectVersion: "version",
        artifactExpiresAt: now,
        now,
      }),
    ).rejects.toThrow("CandidateDataExportDownloadRejected");

    const insecure = new S3CandidateDataExportDownloadSigner(
      "synthetic-export-bucket",
      300,
      undefined,
      { sign: vi.fn(async () => "http://exports.example.test/object") },
    );
    await expect(
      insecure.createGrant({
        objectKey: "key",
        objectVersion: "version",
        artifactExpiresAt: new Date("2026-08-25T12:05:00.000Z"),
        now,
      }),
    ).rejects.toThrow("CandidateDataExportDownloadRejected");
  });
});
