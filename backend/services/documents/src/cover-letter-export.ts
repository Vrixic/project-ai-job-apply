import { S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { CoverLetterIntegrityError } from "./cover-letter.js";
import { S3CoverLetterObjectStore } from "./cover-letter-objects.js";
import {
  type CoverLetterExportReader,
  type CoverLetterObjectStore,
  PostgresCoverLetterReadStore,
} from "./cover-letter-store.js";

export type { CoverLetterExportReader, CoverLetterExportReference } from "./cover-letter-store.js";

/** Production read-only facade; no provider secret, work ledger or mutable object port escapes. */
export function createNativeCoverLetterExportReader(
  url: string,
  bucket: string,
  kmsKeyArn: string,
  enabled: () => boolean = () => false,
) {
  const client = new S3Client({
    region: "us-east-2",
    maxAttempts: 1,
    ignoreConfiguredEndpointUrls: true,
  });
  const objects = new S3CoverLetterObjectStore(bucket, kmsKeyArn, client);
  const native = createCoverLetterExportReader(
    url,
    Object.freeze({ read: objects.read.bind(objects) }),
    enabled,
  );
  return {
    reader: native.reader,
    close: async () => {
      await native.close();
      client.destroy();
    },
  };
}

/** Documents owns native Date/JSON codecs; this bounded pool has no generation/work ledger. */
export function createCoverLetterExportReader(
  url: string,
  objects: Pick<CoverLetterObjectStore, "read">,
  enabled: () => boolean = () => false,
) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const store = new PostgresCoverLetterReadStore(
    sql,
    Object.freeze({
      read: async (...args: Parameters<CoverLetterObjectStore["read"]>) => {
        if (!enabled()) throw new CoverLetterIntegrityError();
        return objects.read(...args);
      },
    }),
  );
  const reader: CoverLetterExportReader = Object.freeze({
    readValue: async (...args: Parameters<CoverLetterExportReader["readValue"]>) => {
      if (!enabled()) throw new CoverLetterIntegrityError();
      const value = await store.readValue(...args);
      if (!enabled()) throw new CoverLetterIntegrityError();
      return value;
    },
  });
  return {
    reader,
    close: async () => {
      await sql.end();
    },
  };
}
