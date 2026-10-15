import type {
  RestrictedAnswerCipher,
  RestrictedAnswerCiphertext,
} from "@ai-job-apply/profile-service";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";

interface AwsSender {
  // biome-ignore lint/suspicious/noExplicitAny: AWS SDK send output is command-specific; every consumed field is validated.
  send(command: unknown): Promise<any>;
}

/**
 * Binds every ciphertext to the exact user, field, and context it was encrypted for (ADR-010,
 * D3-001), so it can never be decrypted after being moved to a different row, even by a caller
 * with database write access. See `candidate-rights-recovery-ledger.ts` for the same technique.
 */
function encryptionContext(input: {
  userId: string;
  fieldKey: string;
  context: string;
}): Record<string, string> {
  // KMS rejects an empty context value, so an answer saved without a context omits that pair.
  // Supplied contexts are nonempty validated keys, so the two forms cannot collide.
  return {
    purpose: "restricted-answer-vault-v1",
    userId: input.userId,
    fieldKey: input.fieldKey,
    ...(input.context ? { context: input.context } : {}),
  };
}

export class KmsRestrictedAnswerCipher implements RestrictedAnswerCipher {
  constructor(
    private readonly kmsKeyArn: string,
    private readonly kms: AwsSender = new KMSClient({}),
  ) {
    if (!kmsKeyArn) throw new Error("RestrictedAnswerCipherConfigurationInvalid");
  }

  async encrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    plaintext: string;
  }): Promise<RestrictedAnswerCiphertext> {
    const encrypted = await this.kms.send(
      new EncryptCommand({
        KeyId: this.kmsKeyArn,
        Plaintext: Buffer.from(input.plaintext, "utf8"),
        EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        EncryptionContext: encryptionContext(input),
      }),
    );
    if (
      !(encrypted.CiphertextBlob instanceof Uint8Array) ||
      encrypted.CiphertextBlob.length === 0
    ) {
      throw new Error("RestrictedAnswerEncryptionRejected");
    }
    return {
      ciphertext: new Uint8Array(encrypted.CiphertextBlob),
      kmsKeyId: this.kmsKeyArn,
      encryptionAlgorithm: "SYMMETRIC_DEFAULT",
    };
  }

  async decrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    ciphertext: RestrictedAnswerCiphertext;
  }): Promise<string> {
    const decrypted = await this.kms.send(
      new DecryptCommand({
        KeyId: input.ciphertext.kmsKeyId,
        CiphertextBlob: Buffer.from(input.ciphertext.ciphertext),
        EncryptionAlgorithm: input.ciphertext.encryptionAlgorithm,
        EncryptionContext: encryptionContext(input),
      }),
    );
    if (!(decrypted.Plaintext instanceof Uint8Array)) {
      throw new Error("RestrictedAnswerDecryptionRejected");
    }
    return Buffer.from(decrypted.Plaintext).toString("utf8");
  }
}
