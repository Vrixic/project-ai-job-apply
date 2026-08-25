import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CandidateDataExportDownloadSigner } from "./app.module.js";

interface SignedUrlProvider {
  sign(command: GetObjectCommand, expiresIn: number): Promise<string>;
}

export class S3CandidateDataExportDownloadSigner implements CandidateDataExportDownloadSigner {
  private readonly signedUrls: SignedUrlProvider;

  constructor(
    private readonly bucketName: string,
    private readonly grantLifetimeSeconds: number,
    client: S3Client = new S3Client({}),
    signedUrls?: SignedUrlProvider,
  ) {
    if (
      !bucketName ||
      !Number.isSafeInteger(grantLifetimeSeconds) ||
      grantLifetimeSeconds < 60 ||
      grantLifetimeSeconds > 900
    ) {
      throw new Error("CandidateDataExportDownloadConfigurationInvalid");
    }
    this.signedUrls =
      signedUrls ??
      ({
        sign: (command, expiresIn) => getSignedUrl(client, command, { expiresIn }),
      } satisfies SignedUrlProvider);
  }

  async createGrant(input: {
    objectKey: string;
    objectVersion: string;
    artifactExpiresAt: Date;
    now: Date;
  }): Promise<{ url: string; method: "GET"; expiresAt: string }> {
    const remainingSeconds = Math.floor(
      (input.artifactExpiresAt.getTime() - input.now.getTime()) / 1_000,
    );
    const expiresIn = Math.min(this.grantLifetimeSeconds, remainingSeconds);
    if (
      !input.objectKey ||
      !input.objectVersion ||
      !Number.isSafeInteger(expiresIn) ||
      expiresIn < 1
    ) {
      throw new Error("CandidateDataExportDownloadRejected");
    }
    const url = await this.signedUrls.sign(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: input.objectKey,
        VersionId: input.objectVersion,
        ResponseCacheControl: "no-store",
        ResponseContentDisposition: 'attachment; filename="candidate-data-export-v1.json"',
        ResponseContentType: "application/json",
      }),
      expiresIn,
    );
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("CandidateDataExportDownloadRejected");
    }
    return {
      url,
      method: "GET",
      expiresAt: new Date(input.now.getTime() + expiresIn * 1_000).toISOString(),
    };
  }
}
