import { createHash } from "node:crypto";

export interface DocumentProcessingAcceptanceManifestEntry {
  fixture: "clean-pdf" | "clean-docx" | "invalid-pdf" | "malware-test";
  fileName: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  sha256: string;
}

export function documentProcessingAcceptanceFixtureSetSha256(
  entries: readonly DocumentProcessingAcceptanceManifestEntry[],
): string {
  const canonical = [...entries]
    .sort((left, right) => left.fixture.localeCompare(right.fixture))
    .map(({ fixture, fileName, mediaType, sizeBytes, sha256 }) => ({
      fixture,
      fileName,
      mediaType,
      sizeBytes,
      sha256,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
