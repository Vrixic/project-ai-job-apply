import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type CoverLetterDocument,
  CoverLetterIntegrityError,
  decodeCoverLetterDocument,
  encodeCoverLetterDocument,
} from "./cover-letter.js";
import type { CoverLetterOwnedReader, CoverLetterReadStore } from "./cover-letter-read.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

export interface CoverLetterMetadata {
  id: string;
  ownerUserId: string;
  applicationId: string;
  version: number;
  jobRevision: string;
  confirmedFactsHash: string;
  status: "pending" | "ready";
  objectKey: string;
  objectVersion: string | null;
  objectSha256: string | null;
  contentSha256: string | null;
  sizeBytes: number | null;
  promptVersion: string | null;
  createdAt: Date;
}

export type CoverLetterExportReference = Pick<
  CoverLetterDocument,
  | "id"
  | "applicationId"
  | "version"
  | "jobRevision"
  | "confirmedFactsHash"
  | "contentSha256"
  | "promptVersion"
  | "model"
  | "createdAt"
>;
export interface CoverLetterExportReader {
  readValue(
    ownerUserId: string,
    reference: CoverLetterExportReference,
  ): Promise<CoverLetterDocument["paragraphs"]>;
}

/** Conditional immutable writes and exact-version bounded reads behind the Documents boundary. */
export interface CoverLetterObjectStore {
  putIfAbsent(input: {
    documentId: string;
    objectKey: string;
    bytes: Uint8Array;
    sha256: string;
  }): Promise<{ objectVersion: string; created?: boolean }>;
  /** Read-only recovery of the current exact-bound version. Never creates a missing object. */
  find?(input: {
    documentId: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<{ objectVersion: string } | null>;
  read(input: {
    documentId: string;
    objectKey: string;
    objectVersion: string;
    sha256: string;
    sizeBytes: number;
  }): Promise<Uint8Array>;
}

async function find(
  transaction: postgres.Sql | postgres.TransactionSql,
  ownerUserId: string,
  id: string,
  lock = false,
): Promise<CoverLetterMetadata | null> {
  const rows = await transaction<CoverLetterMetadata[]>`
    SELECT id, user_id AS "ownerUserId", application_id AS "applicationId", version,
      job_revision AS "jobRevision", confirmed_facts_hash AS "confirmedFactsHash", status,
      object_key AS "objectKey", object_version AS "objectVersion", object_sha256 AS "objectSha256",
      content_sha256 AS "contentSha256", size_bytes AS "sizeBytes",
      prompt_version AS "promptVersion", created_at AS "createdAt"
    FROM documents.cover_letters WHERE user_id = ${ownerUserId} AND id = ${id}
    ${lock ? transaction`FOR UPDATE` : transaction``}
  `;
  return rows[0] ?? null;
}

/** Read-only composition accepts only exact-version object reads and one SQL transaction. */
export class PostgresCoverLetterReadStore implements CoverLetterReadStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly objects: Pick<CoverLetterObjectStore, "read">,
  ) {}

  /** Portability reads the exact saved identity, including historical same-hash drafts. */
  async readValue(
    ownerUserId: string,
    value: CoverLetterExportReference,
  ): Promise<CoverLetterDocument["paragraphs"]> {
    const reference = structuredClone(value);
    return this.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
      const row = await find(transaction, ownerUserId, reference.id);
      if (
        row?.status !== "ready" ||
        row.applicationId !== reference.applicationId ||
        row.version !== reference.version ||
        row.jobRevision !== reference.jobRevision ||
        row.confirmedFactsHash !== reference.confirmedFactsHash ||
        row.contentSha256 !== reference.contentSha256 ||
        row.promptVersion !== reference.promptVersion ||
        row.createdAt.getTime() !== Date.parse(reference.createdAt)
      )
        throw new CoverLetterIntegrityError();
      const document = await readReady(this.objects, row);
      if (
        document.model.provider !== reference.model.provider ||
        document.model.model !== reference.model.model ||
        document.model.version !== reference.model.version
      )
        throw new CoverLetterIntegrityError();
      return structuredClone(document.paragraphs);
    }) as Promise<CoverLetterDocument["paragraphs"]>;
  }

  async withReadLease<T>(
    ownerUserId: string,
    run: (reader: CoverLetterOwnedReader) => Promise<T>,
  ): Promise<T> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
      const reader: CoverLetterOwnedReader = Object.freeze({
        read: async (applicationId: string, contentSha256: string) => {
          const ids = await transaction<Array<{ id: string }>>`
            SELECT id FROM documents.cover_letters WHERE user_id = ${ownerUserId}
              AND application_id = ${applicationId} AND content_sha256 = ${contentSha256}
              AND status = 'ready' ORDER BY version DESC LIMIT 1
          `;
          if (!ids[0]) return null;
          const row = await find(transaction, ownerUserId, ids[0].id);
          if (!row || row.applicationId !== applicationId || row.contentSha256 !== contentSha256)
            throw new CoverLetterIntegrityError();
          return readReady(this.objects, row);
        },
      });
      return run(reader);
    }) as Promise<T>;
  }
}

export class PostgresCoverLetterStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly objects: CoverLetterObjectStore,
    private readonly work?: Pick<
      PostgresCoverLetterWorkStore,
      "claimFinalDocument" | "recordSettled"
    >,
  ) {}

  /** Internal operation identity deduplicates reservation before any model or object I/O. */
  async reserve(input: {
    id: string;
    ownerUserId: string;
    applicationId: string;
    jobRevision: string;
    confirmedFactsHash: string;
  }): Promise<CoverLetterMetadata> {
    return (await this.reserveGeneration(input)).metadata;
  }

  /** A committed reservation is the write-ahead claim for one Documents model dispatch. */
  async reserveGeneration(input: {
    id: string;
    ownerUserId: string;
    applicationId: string;
    jobRevision: string;
    confirmedFactsHash: string;
  }): Promise<{ kind: "claimed" | "already_reserved"; metadata: CoverLetterMetadata }> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${input.ownerUserId}::uuid)`;
      await transaction`SELECT pg_advisory_xact_lock(
        hashtext(${`${input.ownerUserId}:${input.applicationId}:cover-letter`})
      )`;
      const prior = await find(transaction, input.ownerUserId, input.id);
      if (prior) {
        if (
          prior.applicationId !== input.applicationId ||
          prior.jobRevision !== input.jobRevision ||
          prior.confirmedFactsHash !== input.confirmedFactsHash
        )
          throw new CoverLetterIntegrityError();
        return { kind: "already_reserved" as const, metadata: prior };
      }
      await transaction`
        INSERT INTO documents.cover_letters (
          id, user_id, application_id, version, job_revision, confirmed_facts_hash, object_key
        ) SELECT ${input.id}, ${input.ownerUserId}, ${input.applicationId},
          COALESCE(max(version), 0) + 1, ${input.jobRevision}, ${input.confirmedFactsHash},
          ${`normalized/${input.id}/cover-letter.v1.json`}
        FROM documents.cover_letters
        WHERE user_id = ${input.ownerUserId} AND application_id = ${input.applicationId}
      `;
      await transaction`
        INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id)
        VALUES (${uuidv7()}, ${input.ownerUserId}, 'cover_letter.reserved', ${input.id}, ${input.id})
      `;
      const reserved = await find(transaction, input.ownerUserId, input.id);
      if (!reserved) throw new CoverLetterIntegrityError();
      return { kind: "claimed" as const, metadata: reserved };
    });
  }

  /** Bounded model/result reads use this lease; immutable completion uses its own transaction. */
  async withGenerationLease<T>(ownerUserId: string, run: () => Promise<T>): Promise<T> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
      return run();
    }) as Promise<T>;
  }

  async complete(
    input: CoverLetterDocument,
    binding?: { requestSha256: string },
  ): Promise<CoverLetterMetadata> {
    const document = structuredClone(input);
    const expectedRequestSha256 = binding?.requestSha256;
    if (binding && !/^[a-f0-9]{64}$/u.test(expectedRequestSha256 ?? ""))
      throw new CoverLetterIntegrityError();
    const bytes = encodeCoverLetterDocument(document);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.client.begin(async (transaction) => {
      // The Identity-owned lease prevents a bounded write racing privacy quarantine/deletion.
      // The row was reserved in an earlier transaction, so an ambiguous write remains inventoried.
      await transaction`SELECT identity.require_active_candidate(${document.ownerUserId}::uuid)`;
      // Serialize completion without locking the parent document before the independently
      // committed work issue transaction. That transaction also locks the parent document.
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${document.ownerUserId}:${document.id}:cover-letter-completion`}))`;
      const row = await find(transaction, document.ownerUserId, document.id);
      if (
        !row ||
        row.applicationId !== document.applicationId ||
        row.version !== document.version ||
        row.jobRevision !== document.jobRevision ||
        row.confirmedFactsHash !== document.confirmedFactsHash ||
        row.createdAt.toISOString() !== document.createdAt
      )
        throw new CoverLetterIntegrityError();
      if (row.status === "ready") {
        if (row.objectSha256 !== sha256 || row.contentSha256 !== document.contentSha256)
          throw new CoverLetterIntegrityError();
        return row;
      }
      if (!this.work) throw new CoverLetterIntegrityError();
      // Await original committed control results. A local race/abort is not settlement proof.
      const deadline = AbortSignal.timeout(60_000);
      const raw = await this.work.claimFinalDocument({
        ownerUserId: document.ownerUserId,
        documentId: document.id,
      });
      // Validate descriptors before cloning so accessors cannot create authority.
      const dataOnly = (value: unknown, expected: readonly string[]) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(value))
        )
          return false;
        const keys = Reflect.ownKeys(value);
        return (
          keys.length === expected.length &&
          keys.every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return (
              typeof key === "string" &&
              expected.includes(key) &&
              descriptor?.enumerable === true &&
              Object.hasOwn(descriptor, "value")
            );
          })
        );
      };
      if (!dataOnly(raw, ["kind"]) && !dataOnly(raw, ["kind", "reference"]))
        throw new CoverLetterIntegrityError();
      if (raw.kind !== "claimed" && raw.kind !== "unavailable")
        throw new CoverLetterIntegrityError();
      if (raw.kind === "unavailable" && !dataOnly(raw, ["kind"]))
        throw new CoverLetterIntegrityError();
      if (
        raw.kind === "claimed" &&
        !dataOnly(raw.reference, ["id", "documentId", "purpose", "requestSha256"])
      )
        throw new CoverLetterIntegrityError();
      const claim = structuredClone(raw);
      if (
        claim.kind === "claimed" &&
        (claim.reference.purpose !== "final_document" ||
          claim.reference.documentId !== document.id ||
          typeof claim.reference.requestSha256 !== "string" ||
          typeof claim.reference.id !== "string" ||
          !/^[a-f0-9]{64}$/u.test(claim.reference.requestSha256) ||
          (expectedRequestSha256 !== undefined &&
            claim.reference.requestSha256 !== expectedRequestSha256) ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
            claim.reference.id,
          ))
      )
        throw new CoverLetterIntegrityError();
      const locked = await find(transaction, document.ownerUserId, document.id, true);
      if (
        locked?.status !== "pending" ||
        locked.applicationId !== document.applicationId ||
        locked.version !== document.version ||
        locked.jobRevision !== document.jobRevision ||
        locked.confirmedFactsHash !== document.confirmedFactsHash ||
        locked.createdAt.toISOString() !== document.createdAt
      )
        throw new CoverLetterIntegrityError();
      const objectInput = {
        documentId: row.id,
        objectKey: row.objectKey,
        sha256,
        sizeBytes: bytes.byteLength,
      };
      if (claim.kind === "claimed" && deadline.aborted) throw new CoverLetterIntegrityError();
      const stored =
        claim.kind === "claimed"
          ? await this.objects.putIfAbsent({ ...objectInput, bytes })
          : await this.objects.find?.(objectInput);
      if (
        !stored?.objectVersion ||
        stored.objectVersion === "null" ||
        stored.objectVersion.length > 1024 ||
        [...stored.objectVersion].some(
          (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new CoverLetterIntegrityError();
      const objectVersion = stored.objectVersion;
      const created = "created" in stored && stored.created === true;
      const verified = await this.objects.read({
        ...objectInput,
        objectVersion,
      });
      if (
        verified.byteLength !== bytes.byteLength ||
        createHash("sha256").update(verified).digest("hex") !== sha256
      )
        throw new CoverLetterIntegrityError();
      // Only the original positive creation + exact pinned read may settle. A conflict or
      // read-only replay can complete metadata but cannot manufacture remote-stopped evidence.
      if (claim.kind === "claimed" && created) await this.work.recordSettled(claim.reference);
      await transaction`
        UPDATE documents.cover_letters SET status = 'ready', object_version = ${objectVersion},
          object_sha256 = ${sha256}, content_sha256 = ${document.contentSha256},
          size_bytes = ${bytes.byteLength}, prompt_version = ${document.promptVersion}
        WHERE id = ${document.id} AND user_id = ${document.ownerUserId}
      `;
      await transaction`
        INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id)
        VALUES (${uuidv7()}, ${document.ownerUserId}, 'cover_letter.ready', ${document.id}, ${document.id})
      `;
      const ready = await find(transaction, document.ownerUserId, document.id);
      if (!ready) throw new CoverLetterIntegrityError();
      return ready;
    });
  }

  /** Exact owner + application + packet hash. Never silently selects the latest draft. */
  async read(
    ownerUserId: string,
    applicationId: string,
    contentSha256: string,
  ): Promise<CoverLetterDocument | null> {
    return new PostgresCoverLetterReadStore(this.client, this.objects).withReadLease(
      ownerUserId,
      (reader) => reader.read(applicationId, contentSha256),
    );
  }

  /** Active-candidate, owner-scoped metadata lookup; never creates a reservation or reads objects. */
  async generationMetadata(input: {
    id: string;
    ownerUserId: string;
    applicationId: string;
    jobRevision: string;
    confirmedFactsHash: string;
  }): Promise<CoverLetterMetadata | null> {
    return this.client.begin(async (transaction) => {
      await transaction`SELECT identity.require_active_candidate(${input.ownerUserId}::uuid)`;
      const row = await find(transaction, input.ownerUserId, input.id);
      if (!row || row.applicationId !== input.applicationId) return null;
      if (
        row.jobRevision !== input.jobRevision ||
        row.confirmedFactsHash !== input.confirmedFactsHash
      )
        throw new CoverLetterIntegrityError();
      return row;
    });
  }

  /** Retry recovery uses the original operation identity, never a newer application draft. */
  async recover(input: {
    id: string;
    ownerUserId: string;
    applicationId: string;
    jobRevision: string;
    confirmedFactsHash: string;
  }): Promise<CoverLetterDocument | null> {
    const row = await find(this.client, input.ownerUserId, input.id);
    if (!row || row.applicationId !== input.applicationId) return null;
    if (
      row.jobRevision !== input.jobRevision ||
      row.confirmedFactsHash !== input.confirmedFactsHash
    )
      throw new CoverLetterIntegrityError();
    if (row.status === "pending") return null;
    return readReady(this.objects, row);
  }
}

async function readReady(
  objects: Pick<CoverLetterObjectStore, "read">,
  row: CoverLetterMetadata,
): Promise<CoverLetterDocument> {
  if (row?.status !== "ready" || !row.objectVersion || !row.objectSha256 || !row.sizeBytes)
    throw new CoverLetterIntegrityError();
  const bytes = await objects.read({
    documentId: row.id,
    objectKey: row.objectKey,
    objectVersion: row.objectVersion,
    sha256: row.objectSha256,
    sizeBytes: row.sizeBytes,
  });
  if (
    bytes.byteLength !== row.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== row.objectSha256
  )
    throw new CoverLetterIntegrityError();
  const document = decodeCoverLetterDocument(bytes);
  if (
    document.id !== row.id ||
    document.ownerUserId !== row.ownerUserId ||
    document.applicationId !== row.applicationId ||
    document.contentSha256 !== row.contentSha256 ||
    document.version !== row.version ||
    document.jobRevision !== row.jobRevision ||
    document.confirmedFactsHash !== row.confirmedFactsHash ||
    document.createdAt !== row.createdAt.toISOString() ||
    document.promptVersion !== row.promptVersion
  )
    throw new CoverLetterIntegrityError();
  return document;
}
