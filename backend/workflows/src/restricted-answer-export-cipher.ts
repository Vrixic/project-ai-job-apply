import type { RestrictedAnswerCipher } from "@ai-job-apply/profile-service";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";

interface KmsSender {
  send(command: DecryptCommand): Promise<{ Plaintext?: Uint8Array; KeyId?: string }>;
}

export function restrictedAnswerExportCipherFromEnvironment(
  environment: Record<string, string | undefined>,
): KmsRestrictedAnswerExportCipher | undefined {
  const flag = environment.RESTRICTED_ANSWER_EXPORT_ENABLED;
  const key = environment.RESTRICTED_ANSWER_VAULT_KMS_KEY_ARN;
  if (flag === undefined && key === undefined) return undefined;
  if (flag !== "enabled" || !key) throw new Error("RestrictedAnswerExportConfigurationRejected");
  return new KmsRestrictedAnswerExportCipher(key);
}

/** Decrypt-only adapter. Never trusts a stored row to choose a different KMS key. */
export class KmsRestrictedAnswerExportCipher implements Pick<RestrictedAnswerCipher, "decrypt"> {
  constructor(
    private readonly keyArn: string,
    private readonly kms: KmsSender = new KMSClient({}),
  ) {
    if (
      !/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
        keyArn,
      )
    ) {
      throw new Error("RestrictedAnswerExportConfigurationRejected");
    }
  }

  async decrypt(input: Parameters<RestrictedAnswerCipher["decrypt"]>[0]): Promise<string> {
    if (
      input.ciphertext.kmsKeyId !== this.keyArn ||
      input.ciphertext.encryptionAlgorithm !== "SYMMETRIC_DEFAULT"
    ) {
      throw new Error("RestrictedAnswerExportCiphertextRejected");
    }
    let result: { Plaintext?: Uint8Array; KeyId?: string };
    try {
      result = await this.kms.send(
        new DecryptCommand({
          KeyId: this.keyArn,
          CiphertextBlob: input.ciphertext.ciphertext,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          EncryptionContext: {
            purpose: "restricted-answer-vault-v1",
            userId: input.userId,
            fieldKey: input.fieldKey,
            context: input.context,
          },
        }),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const retryable = [
        "ThrottlingException",
        "ServiceUnavailable",
        "TimeoutError",
        "AbortError",
      ].includes(name);
      throw Object.assign(new Error("RestrictedAnswerExportDecryptionFailed"), {
        code: retryable ? name : "RestrictedAnswerExportDecryptionFailed",
      });
    }
    if (
      result.KeyId !== this.keyArn ||
      !(result.Plaintext instanceof Uint8Array) ||
      result.Plaintext.length < 1 ||
      result.Plaintext.length > 3900
    ) {
      throw new Error("RestrictedAnswerExportDecryptionRejected");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(result.Plaintext);
    } catch {
      throw new Error("RestrictedAnswerExportDecryptionRejected");
    }
  }
}
