import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  AwsDocumentParserClient,
  createDocumentProcessingReconciler,
  createDocumentProcessorHandler,
  S3NormalizedDocumentReader,
} from "./processor-lambda.js";

function event(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: "message-1",
        receiptHandle: "receipt",
        body: JSON.stringify(body),
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "sender",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: "digest",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-2:362544434697:queue",
        awsRegion: "us-east-2",
      },
    ],
  };
}

const scan = {
  schemaVersion: 1,
  eventId: "event-1",
  accountId: "362544434697",
  region: "us-east-2",
  protectionPlanArn: "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/plan123",
  bucketName: "candidate-docs",
  objectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
  objectVersion: "source-version",
  scanStatus: "COMPLETED",
  scanResult: "NO_THREATS_FOUND",
  observedAt: "2026-08-12T12:00:00.000Z",
};

describe("document processor SQS boundary", () => {
  it("acknowledges terminal scan outcomes without invoking the parser", async () => {
    const store = {
      acceptScan: vi.fn(async () => ({ kind: "acknowledged" as const })),
      rejectAfterParse: vi.fn(),
      completeParsed: vi.fn(),
    };
    const parser = { parse: vi.fn() };
    const reader = { read: vi.fn() };
    const handler = createDocumentProcessorHandler(
      {
        accountId: scan.accountId,
        region: scan.region,
        protectionPlanArn: scan.protectionPlanArn,
        bucketName: scan.bucketName,
      },
      store,
      parser,
      reader,
    );
    await expect(handler(event({ ...scan, scanResult: "THREATS_FOUND" }))).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it("returns only malformed or wrong-environment records for bounded retry", async () => {
    const store = {
      acceptScan: vi.fn(),
      rejectAfterParse: vi.fn(),
      completeParsed: vi.fn(),
    };
    const handler = createDocumentProcessorHandler(
      {
        accountId: scan.accountId,
        region: scan.region,
        protectionPlanArn: scan.protectionPlanArn,
        bucketName: scan.bucketName,
      },
      store,
      { parse: vi.fn() },
      { read: vi.fn() },
    );
    await expect(handler(event({ ...scan, accountId: "000000000000" }))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    expect(store.acceptScan).not.toHaveBeenCalled();
  });

  it("rejects a scan from any other GuardDuty protection plan", async () => {
    const store = {
      acceptScan: vi.fn(),
      rejectAfterParse: vi.fn(),
      completeParsed: vi.fn(),
    };
    const handler = createDocumentProcessorHandler(
      {
        accountId: scan.accountId,
        region: scan.region,
        protectionPlanArn: scan.protectionPlanArn,
        bucketName: scan.bucketName,
      },
      store,
      { parse: vi.fn() },
      { read: vi.fn() },
    );
    await expect(
      handler(
        event({
          ...scan,
          protectionPlanArn:
            "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/otherplan",
        }),
      ),
    ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(store.acceptScan).not.toHaveBeenCalled();
  });

  it("alarms and acknowledges a persisted security contradiction without parsing", async () => {
    const store = {
      acceptScan: vi.fn(async () => ({ kind: "security_contradiction" as const })),
      rejectAfterParse: vi.fn(),
      completeParsed: vi.fn(),
    };
    const parser = { parse: vi.fn() };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createDocumentProcessorHandler(
      {
        accountId: scan.accountId,
        region: scan.region,
        protectionPlanArn: scan.protectionPlanArn,
        bucketName: scan.bucketName,
      },
      store,
      parser,
      { read: vi.fn() },
    );
    await expect(handler(event(scan))).resolves.toEqual({ batchItemFailures: [] });
    expect(parser.parse).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({ event: "document_processing_security_contradiction" });
    error.mockRestore();
  });

  it("emits only bounded parser-rejection telemetry before acknowledging", async () => {
    const job = {
      userId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
      documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      documentVersion: 1,
      sourceObjectKey: scan.objectKey,
      sourceObjectVersion: scan.objectVersion,
      mediaType: "application/pdf" as const,
      sizeBytes: 123,
      sha256: "a".repeat(64),
      createdAt: "2026-08-12T12:00:00.000Z",
      traceId: scan.eventId,
    };
    const store = {
      acceptScan: vi.fn(async () => ({ kind: "process" as const, job })),
      rejectAfterParse: vi.fn(async () => undefined),
      completeParsed: vi.fn(),
    };
    const parser = {
      parse: vi.fn(async () => ({
        ok: false as const,
        failureCode: "object_mismatch" as const,
        reasonCode: "SOURCE_METADATA",
      })),
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const handler = createDocumentProcessorHandler(
      {
        accountId: scan.accountId,
        region: scan.region,
        protectionPlanArn: scan.protectionPlanArn,
        bucketName: scan.bucketName,
      },
      store,
      parser,
      { read: vi.fn() },
    );

    await expect(handler(event(scan))).resolves.toEqual({ batchItemFailures: [] });
    expect(store.rejectAfterParse).toHaveBeenCalledWith(job, {
      ok: false,
      failureCode: "object_mismatch",
      reasonCode: "SOURCE_METADATA",
    });
    expect(info).toHaveBeenCalledWith({
      event: "document_processing_parser_rejected",
      failureCode: "object_mismatch",
      reasonCode: "SOURCE_METADATA",
    });
    info.mockRestore();
  });
});

describe("exact document parser object capability", () => {
  it("assumes one short-lived role session narrowed to the exact input and output", async () => {
    let assumeCommand: unknown;
    const sts = {
      send: vi.fn(async (command: unknown) => {
        assumeCommand = command;
        return {
          Credentials: {
            AccessKeyId: "ASIAEXACT",
            SecretAccessKey: "secret",
            SessionToken: "token",
            Expiration: new Date("2099-08-12T12:15:00.000Z"),
          },
        };
      }),
    };
    const lambda = {
      send: vi.fn(async () => ({
        StatusCode: 200,
        Payload: new TextEncoder().encode(
          JSON.stringify({
            ok: false,
            failureCode: "invalid_document",
            reasonCode: "PDF_PARSE_REJECTED",
          }),
        ),
      })),
    };
    const client = new AwsDocumentParserClient(
      "arn:aws:lambda:us-east-2:362544434697:function:parser:17",
      "parser-v1",
      "arn:aws:iam::362544434697:role/document-object-access",
      "candidate-docs",
      "arn:aws:kms:us-east-2:362544434697:key/exact",
      "us-east-2",
      lambda,
      sts,
    );
    await client.parse({
      userId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
      documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      documentVersion: 1,
      sourceObjectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
      sourceObjectVersion: "source-version",
      mediaType: "application/pdf",
      sizeBytes: 123,
      sha256: "a".repeat(64),
      createdAt: "2026-08-12T12:00:00.000Z",
      traceId: "event-1",
    });

    const assumeInput = (assumeCommand as { input: Record<string, unknown> }).input;
    expect(assumeInput).toMatchObject({
      RoleArn: "arn:aws:iam::362544434697:role/document-object-access",
      DurationSeconds: 900,
    });
    const serializedPolicy = String(assumeInput.Policy);
    const policy = JSON.parse(serializedPolicy) as {
      Statement: Array<{ Action: string | string[]; Resource: string; Condition?: unknown }>;
    };
    expect(policy.Statement).toEqual([
      expect.objectContaining({
        Action: "s3:GetObject*",
        Resource:
          "arn:aws:s3:::candidate-docs/quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
        Condition: { StringEquals: { "s3:VersionId": "source-version" } },
      }),
      expect.objectContaining({
        Action: "s3:PutObject",
        Resource:
          "arn:aws:s3:::candidate-docs/normalized/019b4e12-7ea3-7c36-9357-aea35ab542ca/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/parser-v1/resume.json",
      }),
      expect.objectContaining({
        Resource: "arn:aws:kms:us-east-2:362544434697:key/exact",
        Condition: {
          StringEquals: { "kms:ViaService": "s3.us-east-2.amazonaws.com" },
        },
      }),
    ]);
    expect(serializedPolicy.length).toBeLessThan(1_024);
    expect(lambda.send).toHaveBeenCalledOnce();
  });
});

describe("normalized document read boundary", () => {
  it("rejects an oversized hostile-parser object before issuing GetObject", async () => {
    const send = vi.fn(async () => ({
      VersionId: "normalized-version",
      ContentLength: 1_500_001,
      ContentType: "application/json",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: "kms-key",
      Metadata: {
        "document-id": "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        "source-sha256": "a".repeat(64),
        "parser-version": "parser-v1",
        "normalized-sha256": "b".repeat(64),
      },
    }));
    const reader = new S3NormalizedDocumentReader("candidate-docs", "kms-key", { send });
    await expect(
      reader.read(
        {
          userId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
          documentId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
          documentVersion: 1,
          sourceObjectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
          sourceObjectVersion: "source-version",
          mediaType: "application/pdf",
          sizeBytes: 123,
          sha256: "a".repeat(64),
          createdAt: "2026-08-12T12:00:00.000Z",
          traceId: "event-1",
        },
        {
          ok: true,
          normalizedObjectKey: `normalized/019b4e12-7ea3-7c36-9357-aea35ab542ca/${"a".repeat(64)}/parser-v1/resume.json`,
          normalizedObjectVersion: "normalized-version",
          normalizedSha256: "b".repeat(64),
          parserVersion: "parser-v1",
          pageCount: 1,
          characterCount: 10,
        },
      ),
    ).rejects.toThrow("NormalizedObjectMetadataInvalid");
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("document processing timeout reconciler", () => {
  it("accepts only the exact scheduled rule and emits aggregate counts", async () => {
    const store = {
      failStuckDocuments: vi.fn(async () => ({ scanTimedOut: 2, parseTimedOut: 1 })),
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reconcile = createDocumentProcessingReconciler("arn:aws:events:rule/exact", store);
    await expect(
      reconcile({
        source: "aws.events",
        "detail-type": "Scheduled Event",
        resources: ["arn:aws:events:rule/exact"],
      }),
    ).resolves.toBeUndefined();
    expect(store.failStuckDocuments).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith({
      event: "document_processing_reconciled",
      scanTimedOut: 2,
      parseTimedOut: 1,
    });
    expect(error).toHaveBeenCalledWith({
      event: "document_processing_timed_out",
      scanTimedOut: 2,
      parseTimedOut: 1,
    });
    info.mockRestore();
    error.mockRestore();
  });

  it("rejects a schedule from any other rule", async () => {
    const reconcile = createDocumentProcessingReconciler("arn:aws:events:rule/exact", {
      failStuckDocuments: vi.fn(),
    });
    await expect(
      reconcile({
        source: "aws.events",
        "detail-type": "Scheduled Event",
        resources: ["arn:aws:events:rule/other"],
      }),
    ).rejects.toThrow("DocumentReconcilerEventInvalid");
  });
});
