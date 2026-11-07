import { createHash } from "node:crypto";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import type { NativeResumeGenerationRecord } from "./native-resume-generation-store.js";
import { nativeResumeOwnerRequestDigest } from "./native-resume-owner-rpc-contract.js";
import { createNativeResumeSource, validateNativeResumeSource } from "./native-resume-source.js";
import { createNativeResumeSourceRpcClient } from "./native-resume-source-rpc-client.js";
import {
  type NativeResumeSourceInput,
  nativeResumeSourceRequestDigest,
} from "./native-resume-source-rpc-contract.js";
import { createNativeResumeSourceRpcHandler } from "./native-resume-source-rpc-handler.js";
import type { NativeResumeTaskBinding } from "./native-resume-task-binding.js";
import { createNativeResumeTaskCallerClient } from "./native-resume-task-caller-client.js";
import { S3NormalizedDocumentReader } from "./normalized-document-reader.js";
import { decodeOriginalPdf } from "./original-pdf.js";
import { type NormalizedResumeDocument, normalizeBlocks } from "./parsing/normalize.js";
import type { SourceDocumentReader } from "./source-document-reader.js";

const id = (n: number) => `019a4000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const target = "arn:aws:lambda:us-east-2:123456789012:function:native-resume-source:7";
const credentials = {
  accessKeyId: "ASIASYNTHETICEXAMPLE",
  secretAccessKey: "synthetic-only",
  sessionToken: "synthetic-local-signing-token-only",
};
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fixture(extra: { sourceSha256?: string; original?: SourceDocumentReader } = {}) {
  const binding: NativeResumeTaskBinding = {
    schemaVersion: 1,
    kind: "tailored_resume",
    configurationSha256: "f".repeat(64),
    scope: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      allocationId: id(4),
      epochId: id(5),
    },
    allocation: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      allocationId: id(4),
      clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/native",
      taskArn: `arn:aws:ecs:us-east-2:123456789012:task/native/${"a".repeat(32)}`,
      taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/native:3",
      containerName: "material",
    },
  };
  const job = { title: "Synthetic engineer", description: "TypeScript engineering" };
  const document = {
    documentId: id(6),
    version: 1,
    parserVersion: "parser-1",
    mediaType: "application/pdf" as const,
    sourceSha256: extra.sourceSha256 ?? "a".repeat(64),
    blocks: normalizeBlocks([{ text: "Synthetic TypeScript experience" }]),
    createdAt: "2026-10-07T00:00:00.000Z",
  };
  const bootstrap = {
    identity: {
      ownerUserId: id(1),
      applicationId: id(2),
      generationId: id(3),
      version: 1,
      baseDocumentId: id(6),
      baseVersion: 1,
      baseSha256: document.sourceSha256,
      jobContextSha256: hash(job),
    },
    normalizedSha256: hash(document),
    canonicalJobId: id(7),
  };
  const record: NativeResumeGenerationRecord = {
    reservation: {
      identity: bootstrap.identity,
      normalizedSha256: bootstrap.normalizedSha256,
      application: {
        ownerUserId: id(1),
        applicationId: id(2),
        canonicalJobId: id(7),
        expectedRevision: 1,
        packetId: id(8),
        packetHash: "e".repeat(64),
        jobRevision: "d".repeat(64),
      },
      previousEpochId: null,
      deployment: {
        clusterArn: binding.allocation.clusterArn,
        taskDefinitionArn: binding.allocation.taskDefinitionArn,
        containerName: "material",
      },
    },
    allocationId: id(4),
    epochId: id(5),
    state: "bound",
    allocation: binding.allocation,
    configurationSha256: binding.configurationSha256,
    reference: null,
    ready: false,
  };
  const enabled = vi.fn(() => true),
    check = vi.fn(async () => {}),
    readLaunch = vi.fn(async () => structuredClone(record));
  const base = {
    id: id(6),
    version: 1,
    fileName: "synthetic.pdf",
    mediaType: "application/pdf" as const,
    sizeBytes: 100,
    sha256: document.sourceSha256,
    sourceObjectKey: "synthetic-source",
    sourceObjectVersion: "source-v1",
    parserVersion: "parser-1",
    normalizedObjectKey: `normalized/${id(6)}/${document.sourceSha256}/parser-1/resume.json`,
    normalizedObjectVersion: "normalized-v1",
    normalizedSha256: bootstrap.normalizedSha256,
    pageCount: 1,
    characterCount: 30,
    createdAt: document.createdAt,
  };
  const parsed = vi.fn(async () => structuredClone(base)),
    read = vi.fn(async () => structuredClone(document)),
    readJob = vi.fn(async () => structuredClone(job));
  let leased = false;
  const candidateLease = {
    async withGenerationLease<T>(_owner: string, run: () => Promise<T>) {
      leased = true;
      try {
        return await run();
      } finally {
        leased = false;
      }
    },
  };
  const options = {
    store: { checkTaskAdmission: check, readLaunch },
    parsed: { findParsedResume: parsed },
    reader: { read },
    job: readJob,
    candidateLease,
    ...(extra.original ? { original: extra.original } : {}),
    enabled,
  };
  const source = createNativeResumeSource(options);
  const load = vi.fn(source.load),
    owners = vi.fn(async () => ({ load, checkAdmission: check }));
  const testFetch = vi.fn(
    async () =>
      new Response(
        `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:sts::123456789012:assumed-role/native-resume/${"a".repeat(32)}</Arn><Account>123456789012</Account><UserId>AROAABCDEFGHIJKLMNOP:${"a".repeat(32)}</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
        { headers: { "content-type": "text/xml" } },
      ),
  );
  const handler = createNativeResumeSourceRpcHandler({
    targetArn: target,
    taskRoleArn: "arn:aws:iam::123456789012:role/native-resume",
    deployment: record.reservation.deployment,
    owners,
    enabled,
    testFetch,
  });
  const send = vi.fn(async (command: InvokeCommand) => {
    const value = JSON.parse(new TextDecoder().decode(command.input.Payload as Uint8Array));
    return {
      StatusCode: 200,
      ExecutedVersion: "7",
      Payload: new TextEncoder().encode(
        nativeOwnerJson(await handler(value, { invokedFunctionArn: target })),
      ),
    };
  });
  const client = createNativeResumeSourceRpcClient({
    binding,
    bootstrap,
    targetArn: target,
    enabled,
    testCredentials: credentials,
    testClient: { send },
  });
  const signed = async (): Promise<NativeResumeSourceInput> => {
    const request = { action: "load_source" as const, bootstrap: structuredClone(bootstrap) };
    return {
      schemaVersion: 1,
      binding: structuredClone(binding),
      request,
      proof: await createNativeResumeTaskCallerClient({
        binding,
        targetArn: target,
        enabled,
        testCredentials: credentials,
      }).proof(nativeResumeSourceRequestDigest(binding, request)),
    };
  };
  return {
    binding,
    bootstrap,
    record,
    document,
    job,
    base,
    enabled,
    check,
    readLaunch,
    parsed,
    read,
    readJob,
    options,
    source,
    load,
    owners,
    testFetch,
    handler,
    send,
    client,
    signed,
    leased: () => leased,
  };
}

describe("original native resume source", () => {
  it("connects SDK-signed task transport to admitted leased source and clears transport bytes", async () => {
    const f = fixture();
    f.read.mockImplementationOnce(async () => {
      expect(f.leased()).toBe(true);
      return structuredClone(f.document);
    });
    expect(await f.client.load(f.bootstrap.identity)).toEqual({ document: f.document, job: f.job });
    expect(f.owners).toHaveBeenCalledOnce();
    expect(f.testFetch).toHaveBeenCalledOnce();
    expect(f.parsed).toHaveBeenCalledWith(id(1), id(6));
    expect(f.readJob).toHaveBeenCalledWith({
      canonicalJobId: id(7),
      jobRevision: "d".repeat(64),
      jobContextSha256: f.bootstrap.identity.jobContextSha256,
    });
    expect(f.leased()).toBe(false);
    expect(
      Array.from(f.send.mock.calls[0]?.[0].input.Payload as Uint8Array).every((v) => v === 0),
    ).toBe(true);
    expect(Object.keys(f.load.mock.calls[0]?.[0] ?? {})).not.toContain("proof");
  });
  describe("the candidate's own PDF", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 1 0 obj <<>> endobj %%EOF");
    const pdfSha = createHash("sha256").update(pdf).digest("hex");
    const encoded = Buffer.from(pdf).toString("base64");

    it("is carried to the generation process when it is exactly the parsed file", async () => {
      const read = vi.fn(async () => Uint8Array.from(pdf));
      const f = fixture({ sourceSha256: pdfSha, original: { read } });
      expect(await f.client.load(f.bootstrap.identity)).toEqual({
        document: f.document,
        job: f.job,
        originalPdfBase64: encoded,
      });
      expect(read).toHaveBeenCalledWith({
        documentId: id(6),
        objectKey: "synthetic-source",
        objectVersion: "source-v1",
        sha256: pdfSha,
        sizeBytes: 100,
        mediaType: "application/pdf",
      });
    });
    it("is left out, and the resume still generated, when it cannot be read", async () => {
      const read = vi.fn(async () => {
        throw new Error("SourceObjectNotScanned");
      });
      const f = fixture({ sourceSha256: pdfSha, original: { read } });
      expect(await f.client.load(f.bootstrap.identity)).toEqual({
        document: f.document,
        job: f.job,
      });
    });
    it("is left out when it is not the file the document was parsed from", async () => {
      const read = vi.fn(async () => Uint8Array.from(pdf));
      const f = fixture({ original: { read } }); // the document records a different hash
      expect(await f.client.load(f.bootstrap.identity)).toEqual({
        document: f.document,
        job: f.job,
      });
    });
    it("is accepted by the source contract only when its hash is the document's", () => {
      const f = fixture({ sourceSha256: pdfSha });
      const value = { document: f.document, job: f.job, originalPdfBase64: encoded };
      expect(validateNativeResumeSource(value, f.bootstrap)).toBe(true);
      const other = Buffer.from("%PDF-1.4 other").toString("base64");
      expect(validateNativeResumeSource({ ...value, originalPdfBase64: other }, f.bootstrap)).toBe(
        false,
      );
    });
    it.each([
      ["not base64", "%%%not base64%%%"],
      ["empty", ""],
      ["a number", 7],
    ])("decodes nothing from a field that is %s", (_name, field) => {
      expect(decodeOriginalPdf(field, pdfSha)).toBeUndefined();
    });
    it("decodes nothing that does not start like a PDF, even with a matching hash", () => {
      const text = new TextEncoder().encode("MZ-not-a-pdf-at-all");
      const sha = createHash("sha256").update(text).digest("hex");
      expect(decodeOriginalPdf(Buffer.from(text).toString("base64"), sha)).toBeUndefined();
      expect(decodeOriginalPdf(encoded, pdfSha)).toEqual(pdf);
    });
    it("decodes nothing larger than the editor accepts", () => {
      const big = new Uint8Array(600_001);
      big.set(new TextEncoder().encode("%PDF-1.4 "));
      const sha = createHash("sha256").update(big).digest("hex");
      expect(decodeOriginalPdf(Buffer.from(big).toString("base64"), sha)).toBeUndefined();
    });
  });
  it("defaults off before source, lease or SQL work", async () => {
    const f = fixture();
    const { enabled: _enabled, ...options } = f.options;
    await expect(createNativeResumeSource(options).load(f.binding, f.bootstrap)).rejects.toThrow(
      "NativeResumeSourceUnavailable",
    );
    expect(f.check).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each(["baseVersion", "baseSha256", "jobContextSha256"] as const)(
    "refuses changed original %s before source I/O",
    async (key) => {
      const f = fixture();
      const altered = structuredClone(f.bootstrap);
      if (key === "baseVersion") altered.identity.baseVersion++;
      else altered.identity[key] = "0".repeat(64);
      await expect(f.source.load(f.binding, altered)).rejects.toThrow(
        "NativeResumeSourceUnavailable",
      );
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it.each(["ready", "retired", "completed"])(
    "refuses %s original generation before source I/O",
    async (change) => {
      const f = fixture();
      if (change === "ready") f.record.ready = true;
      else if (change === "retired") f.record.state = "retired";
      else f.record.reference = {} as never;
      await expect(f.source.load(f.binding, f.bootstrap)).rejects.toThrow();
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it("refuses changed normalized metadata before S3", async () => {
    const f = fixture();
    f.base.normalizedSha256 = "0".repeat(64);
    await expect(f.source.load(f.binding, f.bootstrap)).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each(["source", "job", "completion", "disabled"])(
    "withholds content when %s changes during object I/O",
    async (change) => {
      const f = fixture();
      f.read.mockImplementationOnce(async () => {
        if (change === "disabled") f.enabled.mockReturnValue(false);
        else if (change === "completion") f.record.ready = true;
        else f.check.mockRejectedValue(Error("synthetic changed source or job"));
        return structuredClone(f.document);
      });
      await expect(f.client.load(f.bootstrap.identity)).rejects.toThrow(
        "NativeResumeSourceUnavailable",
      );
      expect(f.leased()).toBe(false);
    },
  );
  it("captures caller inputs before awaits and refuses arbitrary task identity", async () => {
    const f = fixture();
    const b = structuredClone(f.binding),
      original = structuredClone(f.bootstrap);
    const promise = f.source.load(b, original);
    b.scope.ownerUserId = id(99);
    original.identity.baseVersion = 99;
    expect(await promise).toEqual({ document: f.document, job: f.job });
    await expect(
      f.client.load({ ...f.bootstrap.identity, generationId: id(99) }),
    ).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["normalizedExtra", "jobExtra", "blockExtra", "changedJob", "changedDocument"])(
    "refuses invalid source output %s",
    async (change) => {
      const f = fixture(),
        value = { document: structuredClone(f.document), job: structuredClone(f.job) };
      if (change === "normalizedExtra") Object.assign(value.document, { secret: "synthetic" });
      if (change === "jobExtra") Object.assign(value.job, { sourceUrl: "synthetic" });
      if (change === "blockExtra")
        Object.assign(value.document.blocks.at(0) ?? {}, { secret: "synthetic" });
      if (change === "changedJob") value.job.description = "changed";
      if (change === "changedDocument") value.document.version = 2;
      expect(validateNativeResumeSource(value, f.bootstrap)).toBe(false);
    },
  );
  it("accepts a laid-out document and refuses a layout with anything extra", () => {
    const f = fixture(),
      document: NormalizedResumeDocument = structuredClone(f.document);
    document.page = { width: 612, height: 792 };
    document.blocks.forEach((block, index) => {
      block.layout = {
        y: 50 + index * 14,
        runs: [{ x: 36, w: 100, size: 12, text: block.text }],
      };
    });
    const job = structuredClone(f.job);
    expect(validateNativeResumeSource({ document, job }, f.bootstrap)).toBe(true);
    const extra = structuredClone(document);
    Object.assign(extra.blocks[0]?.layout?.runs[0] ?? {}, { href: "https://example.test" });
    expect(validateNativeResumeSource({ document: extra, job }, f.bootstrap)).toBe(false);
    const partial = structuredClone(document);
    delete partial.blocks[0]?.layout;
    expect(validateNativeResumeSource({ document: partial, job }, f.bootstrap)).toBe(false);
  });
  it("refuses a scalar-control proof on the source endpoint before owners", async () => {
    const f = fixture(),
      request = await f.signed();
    request.proof = await createNativeResumeTaskCallerClient({
      binding: f.binding,
      targetArn: target,
      enabled: f.enabled,
      testCredentials: credentials,
    }).proof(nativeResumeOwnerRequestDigest(f.binding, { action: "bootstrap" }));
    expect((await f.handler(request, { invokedFunctionArn: target })).outcome).toBe("unavailable");
    expect(f.owners).not.toHaveBeenCalled();
  });
  it("refuses malformed proof headers without source work", async () => {
    const f = fixture(),
      value = await f.signed();
    value.proof = { schemaVersion: 1, headers: null as never };
    await expect(f.handler(value, { invokedFunctionArn: target })).rejects.toThrow(
      "NativeResumeSourceUnavailable",
    );
    expect(f.owners).not.toHaveBeenCalled();
  });
  it("uses the actual bounded version/digest checked S3 reader without parsing or rendering", async () => {
    const f = fixture(),
      bytes = Buffer.from(JSON.stringify(f.document)),
      kms = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-4000-8000-000000000000";
    const send = vi.fn(
      async (command: unknown): Promise<Record<string, unknown>> =>
        command instanceof HeadObjectCommand
          ? {
              VersionId: f.base.normalizedObjectVersion,
              ContentLength: bytes.length,
              ContentType: "application/json",
              ServerSideEncryption: "aws:kms",
              SSEKMSKeyId: kms,
              Metadata: {
                "document-id": f.base.id,
                "source-sha256": f.base.sha256,
                "parser-version": f.base.parserVersion,
                "normalized-sha256": f.base.normalizedSha256,
              },
            }
          : {
              Body: (async function* () {
                yield bytes;
              })(),
            },
    );
    const source = createNativeResumeSource({
      ...f.options,
      reader: new S3NormalizedDocumentReader("synthetic-source", kms, { send }),
    });
    expect(await source.load(f.binding, f.bootstrap)).toEqual({ document: f.document, job: f.job });
    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls)
      expect((command as HeadObjectCommand).input.VersionId).toBe("normalized-v1");
    bytes[0] = 0;
    await expect(source.load(f.binding, f.bootstrap)).rejects.toThrow(
      "NativeResumeSourceUnavailable",
    );
  });
});
