import type postgres from "postgres";
import { restrictedAnswerExportFieldKeys } from "@ai-job-apply/domain";
import type { RestrictedAnswerCipher } from "./restricted-answer-vault.js";

export interface RestrictedAnswerExportReference {
  id: string;
  version: number;
  fieldKey: string;
  context?: string;
}

/** Only the rights artifact builder may use this port. Expiry prevents reuse, not portability. */
export interface RestrictedAnswerExportReader {
  readValue(userId: string, reference: RestrictedAnswerExportReference): Promise<string>;
}

export class RestrictedAnswerExportSnapshotChanged extends Error {
  constructor() {
    super("RestrictedAnswerExportSnapshotChanged");
    this.name = "RestrictedAnswerExportSnapshotChanged";
  }
}

/** Profile owns these queries. No plaintext enters SQL, logs, receipts, or durable history. */
export class PostgresRestrictedAnswerExportReader implements RestrictedAnswerExportReader {
  constructor(
    private readonly client: postgres.Sql,
    private readonly cipher: Pick<RestrictedAnswerCipher, "decrypt">,
  ) {}

  async readValue(userId: string, reference: RestrictedAnswerExportReference): Promise<string> {
    if (!restrictedAnswerExportFieldKeys.includes(reference.fieldKey)) {
      throw new Error("RestrictedAnswerExportFieldRejected");
    }
    const context = reference.context ?? "";
    const [row] = await this.client<
      Array<{ ciphertext: Buffer; kmsKeyId: string; encryptionAlgorithm: "SYMMETRIC_DEFAULT" }>
    >`
      SELECT version.ciphertext, version.kms_key_id, version.encryption_algorithm
      FROM profile.restricted_answers AS answer
      JOIN LATERAL (
        SELECT * FROM profile.restricted_answer_versions
        WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
      ) AS version ON true
      WHERE answer.user_id = ${userId}::uuid AND answer.id = ${reference.id}::uuid
        AND answer.field_key = ${reference.fieldKey}
        AND coalesce(answer.context, '') = ${context}
        AND version.version = ${reference.version} AND version.state = 'active'
    `;
    if (!row) throw new RestrictedAnswerExportSnapshotChanged();
    const value = await this.cipher.decrypt({
      userId,
      fieldKey: reference.fieldKey,
      context,
      ciphertext: {
        ciphertext: new Uint8Array(row.ciphertext),
        kmsKeyId: row.kmsKeyId,
        encryptionAlgorithm: row.encryptionAlgorithm,
      },
    });
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") < 1 ||
      Buffer.byteLength(value, "utf8") > 3900
    ) {
      throw new Error("RestrictedAnswerExportValueRejected");
    }
    // KMS must not hold a SQL lock. Refuse a correction/deletion committed during decryption.
    const [current] = await this.client<Array<{ current: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM profile.restricted_answers AS answer
        JOIN LATERAL (
          SELECT version, state FROM profile.restricted_answer_versions
          WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE answer.user_id = ${userId}::uuid AND answer.id = ${reference.id}::uuid
          AND answer.field_key = ${reference.fieldKey}
          AND coalesce(answer.context, '') = ${context}
          AND version.version = ${reference.version} AND version.state = 'active'
      ) AS current
    `;
    if (current?.current !== true) throw new RestrictedAnswerExportSnapshotChanged();
    return value;
  }
}
