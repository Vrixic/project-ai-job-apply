import type {
  RestrictedAnswerCipher,
  RestrictedAnswerCiphertext,
} from "./restricted-answer-vault.js";

/**
 * An in-process fake for tests only: "encrypts" by keeping the plaintext behind an opaque handle
 * bound to the exact context it was created for, and refuses to decrypt under any other context -
 * the same integrity property KMS's EncryptionContext gives the real cipher, without calling AWS.
 */
export class FakeRestrictedAnswerCipher implements RestrictedAnswerCipher {
  private sequence = 0;
  private readonly plaintexts = new Map<string, string>();

  private contextKey(input: { userId: string; fieldKey: string; context: string }): string {
    return `${input.userId}\u0000${input.fieldKey}\u0000${input.context}`;
  }

  async encrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    plaintext: string;
  }): Promise<RestrictedAnswerCiphertext> {
    this.sequence += 1;
    const handle = `fake-ciphertext-${this.sequence}`;
    this.plaintexts.set(`${this.contextKey(input)}\u0000${handle}`, input.plaintext);
    return {
      ciphertext: new TextEncoder().encode(handle),
      kmsKeyId: "fake-key",
      encryptionAlgorithm: "SYMMETRIC_DEFAULT",
    };
  }

  async decrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    ciphertext: RestrictedAnswerCiphertext;
  }): Promise<string> {
    const handle = new TextDecoder().decode(input.ciphertext.ciphertext);
    const plaintext = this.plaintexts.get(`${this.contextKey(input)}\u0000${handle}`);
    if (plaintext === undefined) {
      throw new Error("FakeRestrictedAnswerCipherContextMismatch");
    }
    return plaintext;
  }
}
