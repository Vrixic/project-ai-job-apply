import type { ResumeUploadGrant } from "@ai-job-apply/api-contracts";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

export const MAXIMUM_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_UPLOAD_TTL_SECONDS = 300;

export interface ResumeUploadGrantInput {
  documentId: string;
  objectKey: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  sha256: string;
}

export interface ResumeUploadSigner {
  createGrant(input: ResumeUploadGrantInput): Promise<ResumeUploadGrant>;
}

export interface S3ResumeUploadSignerOptions {
  bucket: string;
  kmsKeyArn: string;
  client?: S3Client;
  now?: () => Date;
  expiresSeconds?: number;
}

export class S3ResumeUploadSigner implements ResumeUploadSigner {
  private readonly client: S3Client;
  private readonly now: () => Date;
  private readonly expiresSeconds: number;

  constructor(private readonly options: S3ResumeUploadSignerOptions) {
    this.client = options.client ?? new S3Client({});
    this.now = options.now ?? (() => new Date());
    this.expiresSeconds = options.expiresSeconds ?? RESUME_UPLOAD_TTL_SECONDS;
    if (this.expiresSeconds < 60 || this.expiresSeconds > RESUME_UPLOAD_TTL_SECONDS) {
      throw new Error("Resume upload grants must expire in 60 to 300 seconds");
    }
  }

  async createGrant(input: ResumeUploadGrantInput): Promise<ResumeUploadGrant> {
    if (
      !input.objectKey.startsWith(`quarantine/${input.documentId}/`) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > MAXIMUM_RESUME_BYTES ||
      !/^[a-f0-9]{64}$/.test(input.sha256)
    ) {
      throw new Error("Resume upload grant input is outside the approved boundary");
    }

    const encryption = "aws:kms";
    const checksumSha256 = Buffer.from(input.sha256, "hex").toString("base64");
    const fields = {
      key: input.objectKey,
      "Content-Type": input.mediaType,
      "x-amz-checksum-algorithm": "SHA256",
      "x-amz-checksum-sha256": checksumSha256,
      "x-amz-server-side-encryption": encryption,
      "x-amz-server-side-encryption-aws-kms-key-id": this.options.kmsKeyArn,
      "x-amz-meta-document-id": input.documentId,
      "x-amz-meta-sha256": input.sha256,
      success_action_status: "204",
    };
    const signed = await createPresignedPost(this.client, {
      Bucket: this.options.bucket,
      Key: input.objectKey,
      Fields: fields,
      Conditions: [
        ["eq", "$key", input.objectKey],
        ["eq", "$Content-Type", input.mediaType],
        ["eq", "$x-amz-checksum-algorithm", "SHA256"],
        ["eq", "$x-amz-checksum-sha256", checksumSha256],
        ["eq", "$x-amz-server-side-encryption", encryption],
        ["eq", "$x-amz-server-side-encryption-aws-kms-key-id", this.options.kmsKeyArn],
        ["eq", "$x-amz-meta-document-id", input.documentId],
        ["eq", "$x-amz-meta-sha256", input.sha256],
        ["eq", "$success_action_status", "204"],
        ["content-length-range", input.sizeBytes, input.sizeBytes],
      ],
      Expires: this.expiresSeconds,
    });

    return {
      url: signed.url,
      method: "POST",
      fields: signed.fields,
      expiresAt: new Date(this.now().getTime() + this.expiresSeconds * 1000).toISOString(),
    };
  }
}
