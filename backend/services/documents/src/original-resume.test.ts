import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { GenerationBase, GenerationBaseSource } from "./generation-base-source.js";
import {
  createOriginalResumeService,
  ORIGINAL_RESUME_MAXIMUM_BYTES,
  ORIGINAL_RESUME_REQUEST_KIND,
  ORIGINAL_RESUME_RESULT_SCHEMA,
  parseOriginalResumeRequest,
  S3OriginalResumeReader,
} from "./original-resume.js";
import type { ParsedResumeRecord, ParsedResumeSource } from "./parsed-resume-source.js";

const OWNER = "0192f7c2-0000-7000-8000-000000000001";
const OTHER = "0192f7c2-0000-7000-8000-000000000002";
const DOCUMENT = "0192f7c2-0000-7000-8000-0000000000d1";
const PDF = Buffer.from("%PDF-1.4 synthetic original resume bytes");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function record(overrides: Partial<ParsedResumeRecord> = {}): ParsedResumeRecord {
  return {
    id: DOCUMENT,
    version: 1,
    fileName: "Candidate Resume.pdf",
    mediaType: "application/pdf",
    sizeBytes: PDF.byteLength,
    sha256: sha(PDF),
    sourceObjectKey: `uploads/${OWNER}/${DOCUMENT}/resume.pdf`,
    sourceObjectVersion: "v1",
    parserVersion: "1",
    normalizedObjectKey: "normalized/x",
    normalizedObjectVersion: "n1",
    normalizedSha256: "e".repeat(64),
    pageCount: 1,
    characterCount: 10,
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
    ...overrides,
  };
}

const APPLICATION = "0192f7c2-0000-7000-8000-0000000000a1";
const GENERATION = "0192f7c2-0000-7000-8000-0000000000c1";

function build(
  options: {
    record?: ParsedResumeRecord | null;
    bytes?: Uint8Array;
    fail?: boolean;
    /** The generation ledger: `undefined` has no generations dependency at all. */
    base?: GenerationBase | null | undefined;
    generations?: boolean;
  } = {},
) {
  const lookups: Array<{ owner: string; documentId?: string | undefined }> = [];
  const baseLookups: Array<{ owner: string; applicationId: string; generationId: string }> = [];
  const source: ParsedResumeSource = {
    async findParsedResume(owner, documentId) {
      lookups.push({ owner, documentId });
      return owner === OWNER ? (options.record === undefined ? record() : options.record) : null;
    },
  };
  const generations: GenerationBaseSource | undefined =
    options.generations === false
      ? undefined
      : {
          async findGenerationBase(owner, applicationId, generationId) {
            baseLookups.push({ owner, applicationId, generationId });
            if (owner !== OWNER || applicationId !== APPLICATION || generationId !== GENERATION)
              return null;
            return options.base === undefined
              ? { documentId: DOCUMENT, version: 1, sha256: sha(PDF) }
              : options.base;
          },
        };
  const held: Uint8Array[] = [];
  const reader = {
    read: vi.fn(async () => {
      if (options.fail) throw new Error("SECRET storage detail");
      const bytes = new Uint8Array(options.bytes ?? PDF);
      held.push(bytes);
      return bytes;
    }),
  };
  return {
    service: createOriginalResumeService({
      source,
      reader,
      ...(generations ? { generations } : {}),
    }),
    reader,
    lookups,
    baseLookups,
    held,
  };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  kind: ORIGINAL_RESUME_REQUEST_KIND,
  mode: "file",
  ownerUserId: OWNER,
  ...overrides,
});

describe("original resume request contract", () => {
  it("accepts only the exact fixed shape", () => {
    expect(parseOriginalResumeRequest(request())).toEqual(request());
    expect(parseOriginalResumeRequest(request({ documentId: DOCUMENT }))).toEqual(
      request({ documentId: DOCUMENT }),
    );
    for (const bad of [
      null,
      [],
      "x",
      request({ kind: "resume-tailoring-v1" }),
      request({ mode: "other" }),
      request({ ownerUserId: "not-a-uuid" }),
      request({ documentId: "nope" }),
      request({ extra: 1 }),
      { kind: ORIGINAL_RESUME_REQUEST_KIND, mode: "file" },
      // A generation is named only in generation_file mode, and then with an application.
      request({ generationId: GENERATION }),
      request({ applicationId: APPLICATION }),
      request({ mode: "descriptor", generationId: GENERATION, applicationId: APPLICATION }),
    ])
      expect(parseOriginalResumeRequest(bad)).toBeNull();
  });

  it("takes a generation and its application, and never a document, for generation_file", () => {
    const generationRequest = request({
      mode: "generation_file",
      applicationId: APPLICATION,
      generationId: GENERATION,
    });
    expect(parseOriginalResumeRequest(generationRequest)).toEqual(generationRequest);
    for (const bad of [
      request({ mode: "generation_file" }),
      request({ mode: "generation_file", generationId: GENERATION }),
      request({ mode: "generation_file", applicationId: APPLICATION }),
      request({ mode: "generation_file", applicationId: "nope", generationId: GENERATION }),
      // The caller must not choose the document the generation is read as.
      request({
        mode: "generation_file",
        applicationId: APPLICATION,
        generationId: GENERATION,
        documentId: DOCUMENT,
      }),
    ])
      expect(parseOriginalResumeRequest(bad)).toBeNull();
  });
});

describe("original resume service", () => {
  it("returns the exact original bytes, in their own format, and clears its copy", async () => {
    const { service, held, lookups } = build();
    const result = await service(request({ documentId: DOCUMENT }));
    expect(lookups).toEqual([{ owner: OWNER, documentId: DOCUMENT }]);
    expect(result).toEqual({
      schema: ORIGINAL_RESUME_RESULT_SCHEMA,
      status: "ready",
      document: {
        id: DOCUMENT,
        fileName: "Candidate Resume.pdf",
        format: "pdf",
        mediaType: "application/pdf",
        sizeBytes: PDF.byteLength,
        sha256: sha(PDF),
      },
      contentBase64: PDF.toString("base64"),
    });
    expect(held[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("returns a Word original as a Word file", async () => {
    const docx = Buffer.from("PK synthetic docx");
    const { service } = build({
      record: record({
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "resume.docx",
        sizeBytes: docx.byteLength,
        sha256: sha(docx),
      }),
      bytes: docx,
    });
    expect(await service(request())).toMatchObject({
      status: "ready",
      document: { format: "docx" },
    });
  });

  it("describes the candidate's resume without reading the object", async () => {
    const { service, reader } = build();
    const result = await service(request({ mode: "descriptor" }));
    expect(result).toMatchObject({ status: "ready", document: { sha256: sha(PDF) } });
    expect(result).not.toHaveProperty("contentBase64");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("never reads another owner's resume", async () => {
    const { service, reader, lookups } = build();
    expect(await service(request({ ownerUserId: OTHER }))).toEqual({
      schema: ORIGINAL_RESUME_RESULT_SCHEMA,
      status: "no_resume",
    });
    expect(lookups).toEqual([{ owner: OTHER, documentId: undefined }]);
    expect(reader.read).not.toHaveBeenCalled();
    expect(await build({ record: null }).service(request())).toMatchObject({
      status: "no_resume",
    });
  });

  it("refuses a file above the limit without reading it, but still describes it", async () => {
    const big = record({ sizeBytes: ORIGINAL_RESUME_MAXIMUM_BYTES + 1 });
    const { service, reader } = build({ record: big });
    expect(await service(request())).toEqual({
      schema: ORIGINAL_RESUME_RESULT_SCHEMA,
      status: "unavailable",
      reason: "too_large",
    });
    expect(reader.read).not.toHaveBeenCalled();
    expect(await service(request({ mode: "descriptor" }))).toMatchObject({
      status: "ready",
      document: { sizeBytes: ORIGINAL_RESUME_MAXIMUM_BYTES + 1 },
    });
  });

  it.each([
    ["a substituted object", { bytes: Buffer.from("%PDF-1.4 other bytes of equal length!!") }],
    ["an unreadable object", { fail: true }],
  ])("fails closed with a fixed reason for %s", async (_name, options) => {
    const { service } = build(options);
    const result = await service(request());
    expect(result).toEqual({
      schema: ORIGINAL_RESUME_RESULT_SCHEMA,
      status: "unavailable",
      reason: "document_unreadable",
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("refuses an unsupported stored media type", async () => {
    const { service } = build({ record: record({ mediaType: "text/plain" as never }) });
    expect(await service(request())).toMatchObject({
      status: "unavailable",
      reason: "document_unreadable",
    });
  });

  describe("the original a generated resume was made from", () => {
    const generationRequest = (overrides: Record<string, unknown> = {}) =>
      request({
        mode: "generation_file",
        applicationId: APPLICATION,
        generationId: GENERATION,
        ...overrides,
      });

    it("reads the document the generation's ledger row names, in its exact bytes", async () => {
      const { service, lookups, baseLookups, held } = build();
      const result = await service(generationRequest());
      expect(baseLookups).toEqual([
        { owner: OWNER, applicationId: APPLICATION, generationId: GENERATION },
      ]);
      // The document read is the ledger's, not one the caller chose.
      expect(lookups).toEqual([{ owner: OWNER, documentId: DOCUMENT }]);
      expect(result).toMatchObject({
        status: "ready",
        document: { id: DOCUMENT, sha256: sha(PDF), format: "pdf" },
        contentBase64: PDF.toString("base64"),
      });
      expect(held[0]?.every((byte) => byte === 0)).toBe(true);
    });

    it("reads the generation's base even when the candidate has uploaded a newer resume", async () => {
      const OLD = "0192f7c2-0000-7000-8000-0000000000d0";
      const oldBytes = Buffer.from("%PDF-1.4 the resume the generation started from");
      const { service, lookups } = build({
        base: { documentId: OLD, version: 3, sha256: sha(oldBytes) },
        record: record({
          id: OLD,
          version: 3,
          sizeBytes: oldBytes.byteLength,
          sha256: sha(oldBytes),
        }),
        bytes: oldBytes,
      });
      expect(await service(generationRequest())).toMatchObject({
        status: "ready",
        document: { id: OLD, sha256: sha(oldBytes) },
      });
      expect(lookups).toEqual([{ owner: OWNER, documentId: OLD }]);
    });

    it.each([
      ["another owner", { ownerUserId: OTHER }],
      ["another application", { applicationId: "0192f7c2-0000-7000-8000-0000000000a2" }],
      ["an unknown generation", { generationId: "0192f7c2-0000-7000-8000-0000000000c2" }],
    ])("finds nothing for %s and reads no object", async (_name, overrides) => {
      const { service, reader, lookups } = build();
      expect(await service(generationRequest(overrides))).toEqual({
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "no_resume",
      });
      expect(lookups).toEqual([]);
      expect(reader.read).not.toHaveBeenCalled();
    });

    it.each([
      ["no ledger row", { base: null }],
      ["a base that is no longer a parsed resume", { record: null }],
      [
        "a base whose version has moved on",
        { base: { documentId: DOCUMENT, version: 2, sha256: sha(PDF) } },
      ],
      [
        "a base whose bytes differ",
        { base: { documentId: DOCUMENT, version: 1, sha256: "f".repeat(64) } },
      ],
    ])("serves nothing for %s", async (_name, options) => {
      const { service, reader } = build(options);
      expect(await service(generationRequest())).toEqual({
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "no_resume",
      });
      expect(reader.read).not.toHaveBeenCalled();
    });

    it("is an invalid request where no generation ledger is wired", async () => {
      const { service, reader } = build({ generations: false });
      expect(await service(generationRequest())).toEqual({
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "unavailable",
        reason: "invalid_request",
      });
      expect(reader.read).not.toHaveBeenCalled();
    });

    it("fails closed with a fixed reason for a substituted object", async () => {
      const { service } = build({ bytes: Buffer.from("%PDF-1.4 other bytes of equal length!!") });
      expect(await service(generationRequest())).toEqual({
        schema: ORIGINAL_RESUME_RESULT_SCHEMA,
        status: "unavailable",
        reason: "document_unreadable",
      });
    });
  });

  it("reports an invalid request with a fixed reason", async () => {
    const { service, lookups } = build();
    expect(await service({ kind: ORIGINAL_RESUME_REQUEST_KIND })).toEqual({
      schema: ORIGINAL_RESUME_RESULT_SCHEMA,
      status: "unavailable",
      reason: "invalid_request",
    });
    expect(lookups).toEqual([]);
  });
});

describe("object access for the original upload", () => {
  const credentials = { AccessKeyId: "AKIA", SecretAccessKey: "secret", SessionToken: "token" };

  function reader(
    overrides: {
      credentials?: typeof credentials | undefined;
      object?: Record<string, unknown>;
    } = {},
  ) {
    const assumed: unknown[] = [];
    const sent: unknown[] = [];
    const sts = {
      send: vi.fn(async (command: unknown) => {
        assumed.push((command as { input: unknown }).input);
        return { Credentials: "credentials" in overrides ? overrides.credentials : credentials };
      }),
    };
    const s3 = vi.fn(() => ({
      send: vi.fn(async (command: unknown) => {
        sent.push((command as { input: unknown }).input);
        return overrides.object ?? { VersionId: "v1", Body: bodyOf(PDF) };
      }),
    }));
    return {
      assumed,
      sent,
      s3,
      reader: new S3OriginalResumeReader(
        "bucket",
        "arn:aws:kms:us-east-2:123456789012:key/k",
        "arn:aws:iam::123456789012:role/object-access",
        "us-east-2",
        sts as never,
        s3 as never,
      ),
    };
  }

  const bodyOf = (bytes: Uint8Array) => ({
    transformToByteArray: async () => new Uint8Array(bytes),
  });

  it("assumes the reviewed role with a session policy for exactly this object version", async () => {
    const { reader: subject, assumed, sent } = reader();
    const bytes = await subject.read(record());
    expect(Buffer.from(bytes).equals(PDF)).toBe(true);
    const input = assumed[0] as { RoleArn: string; Policy: string; RoleSessionName: string };
    expect(input.RoleArn).toBe("arn:aws:iam::123456789012:role/object-access");
    expect(input.RoleSessionName.length).toBeLessThanOrEqual(64);
    const policy = JSON.parse(input.Policy) as {
      Statement: Array<Record<string, unknown>>;
    };
    expect(policy.Statement[0]).toMatchObject({
      Effect: "Allow",
      Action: "s3:GetObject*",
      Resource: `arn:aws:s3:::bucket/uploads/${OWNER}/${DOCUMENT}/resume.pdf`,
      Condition: { StringEquals: { "s3:VersionId": "v1" } },
    });
    expect(policy.Statement).toHaveLength(2);
    expect(JSON.stringify(policy)).not.toContain("PutObject");
    expect(sent[0]).toEqual({
      Bucket: "bucket",
      Key: `uploads/${OWNER}/${DOCUMENT}/resume.pdf`,
      VersionId: "v1",
    });
  });

  it.each([
    ["an unversioned object", record({ sourceObjectVersion: null }), undefined],
    ["missing credentials", record(), { credentials: undefined }],
    ["another version", record(), { object: { VersionId: "v2", Body: bodyOf(PDF) } }],
    ["a missing body", record(), { object: { VersionId: "v1" } }],
    ["an empty body", record(), { object: { VersionId: "v1", Body: bodyOf(new Uint8Array(0)) } }],
    [
      "an oversized body",
      record(),
      {
        object: {
          VersionId: "v1",
          Body: bodyOf(new Uint8Array(ORIGINAL_RESUME_MAXIMUM_BYTES + 1)),
        },
      },
    ],
  ])("refuses %s", async (_name, stored, setup) => {
    const { reader: subject } = reader(setup);
    await expect(subject.read(stored)).rejects.toThrow();
  });
});
