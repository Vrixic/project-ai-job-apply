import {
  type DocumentScanResultV1,
  validateDocumentScanResult,
} from "@ai-job-apply/event-contracts";
import {
  createDatabase,
  PostgresResumeProposalWriter,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import {
  type DocumentParserCorpusAggregate,
  type DocumentParserCorpusRequest,
  executeDocumentParserCorpus,
} from "./document-parser-corpus.js";
import {
  type NormalizedDocumentReader,
  S3NormalizedDocumentReader,
} from "./normalized-document-reader.js";
import type { DocumentParserInput, DocumentParserResult } from "./parser-lambda.js";

export {
  type NormalizedDocumentReader,
  S3NormalizedDocumentReader,
} from "./normalized-document-reader.js";

import {
  createOriginalResumeService,
  ORIGINAL_RESUME_REQUEST_KIND,
  type OriginalResumeResult,
  S3OriginalResumeReader,
} from "./original-resume.js";
import { type DocumentProcessingJob, PostgresDocumentProcessorStore } from "./processor.js";
import {
  createResumeTailoringService,
  PostgresParsedResumeSource,
  RESUME_TAILORING_REQUEST_KIND,
  type ResumeTailoringResult,
} from "./resume-tailoring.js";

const MAXIMUM_SCAN_EVENT_BYTES = 4_096;

interface LambdaSender {
  send(
    command: InvokeCommand,
  ): Promise<{ StatusCode?: number; FunctionError?: string; Payload?: Uint8Array }>;
}

interface StsSender {
  send(command: AssumeRoleCommand): Promise<{
    Credentials?: {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      SessionToken?: string;
      Expiration?: Date;
    };
  }>;
}

export interface DocumentParserClient {
  parse(job: DocumentProcessingJob): Promise<DocumentParserResult>;
}

export class AwsDocumentParserClient implements DocumentParserClient {
  constructor(
    private readonly qualifiedFunctionArn: string,
    private readonly expectedParserVersion: string,
    private readonly objectAccessRoleArn: string,
    private readonly bucketName: string,
    private readonly kmsKeyArn: string,
    private readonly awsRegion: string,
    private readonly client: LambdaSender = new LambdaClient({}),
    private readonly sts: StsSender = new STSClient({}),
  ) {}

  async parse(job: DocumentProcessingJob): Promise<DocumentParserResult> {
    const normalizedKey = `normalized/${job.documentId}/${job.sha256}/${this.expectedParserVersion}/resume.json`;
    const sessionPolicy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          // The role policy caps this wildcard to the four reviewed read/tag actions. Keeping the
          // exact object and version here preserves the capability boundary while avoiding STS's
          // independent packed-session-policy limit for high-entropy object identities.
          Action: "s3:GetObject*",
          Resource: `arn:aws:s3:::${this.bucketName}/${job.sourceObjectKey}`,
          Condition: { StringEquals: { "s3:VersionId": job.sourceObjectVersion } },
        },
        {
          Effect: "Allow",
          Action: "s3:PutObject",
          Resource: `arn:aws:s3:::${this.bucketName}/${normalizedKey}`,
        },
        {
          Effect: "Allow",
          Action: ["kms:Decrypt", "kms:GenerateDataKey"],
          Resource: this.kmsKeyArn,
          Condition: {
            StringEquals: {
              "kms:ViaService": `s3.${this.awsRegion}.amazonaws.com`,
            },
          },
        },
      ],
    });
    const assumed = await this.sts.send(
      new AssumeRoleCommand({
        RoleArn: this.objectAccessRoleArn,
        RoleSessionName: `document-${job.documentId}`,
        DurationSeconds: 900,
        Policy: sessionPolicy,
      }),
    );
    const credentials = assumed.Credentials;
    if (
      !credentials?.AccessKeyId ||
      !credentials.SecretAccessKey ||
      !credentials.SessionToken ||
      !credentials.Expiration
    ) {
      throw new Error("DocumentObjectAccessUnavailable");
    }
    const input: DocumentParserInput = {
      documentId: job.documentId,
      documentVersion: job.documentVersion,
      sourceObjectKey: job.sourceObjectKey,
      sourceObjectVersion: job.sourceObjectVersion,
      mediaType: job.mediaType,
      sizeBytes: job.sizeBytes,
      sha256: job.sha256,
      createdAt: job.createdAt,
      objectAccess: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
        expiresAt: credentials.Expiration.toISOString(),
      },
    };
    const response = await this.client.send(
      new InvokeCommand({
        FunctionName: this.qualifiedFunctionArn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify(input)),
      }),
    );
    if (response.StatusCode !== 200 || response.FunctionError || !response.Payload) {
      throw new Error("DocumentParserInvocationFailed");
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(response.Payload));
    } catch {
      throw new Error("DocumentParserResponseMalformed");
    }
    if (!isParserResult(value)) throw new Error("DocumentParserResponseInvalid");
    if (value.ok && value.parserVersion !== this.expectedParserVersion) {
      throw new Error("DocumentParserVersionMismatch");
    }
    return value;
  }
}

function isParserResult(value: unknown): value is DocumentParserResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DocumentParserResult>;
  if (result.ok === false) {
    return (
      (result.failureCode === "invalid_document" ||
        result.failureCode === "parse_failed" ||
        result.failureCode === "object_mismatch") &&
      typeof result.reasonCode === "string" &&
      /^[A-Z0-9_]{1,64}$/u.test(result.reasonCode)
    );
  }
  return (
    result.ok === true &&
    typeof result.normalizedObjectKey === "string" &&
    typeof result.normalizedObjectVersion === "string" &&
    typeof result.normalizedSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(result.normalizedSha256) &&
    typeof result.parserVersion === "string" &&
    Number.isInteger(result.pageCount) &&
    Number.isInteger(result.characterCount)
  );
}

interface Processor {
  acceptScan(event: DocumentScanResultV1): ReturnType<PostgresDocumentProcessorStore["acceptScan"]>;
  rejectAfterParse: PostgresDocumentProcessorStore["rejectAfterParse"];
  completeParsed: PostgresDocumentProcessorStore["completeParsed"];
}

interface ReconcilerStore {
  failStuckDocuments: PostgresDocumentProcessorStore["failStuckDocuments"];
}

interface ScheduledEvent {
  source: "aws.events";
  "detail-type": "Scheduled Event";
  resources: string[];
}

export function createDocumentProcessorHandler(
  config: { accountId: string; region: string; protectionPlanArn: string; bucketName: string },
  store: Processor,
  parser: DocumentParserClient,
  normalizedReader: NormalizedDocumentReader,
) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        const scan = parseScanRecord(record);
        if (
          scan.accountId !== config.accountId ||
          scan.region !== config.region ||
          scan.protectionPlanArn !== config.protectionPlanArn ||
          scan.bucketName !== config.bucketName
        ) {
          throw new Error("DocumentScanEnvironmentMismatch");
        }
        const accepted = await store.acceptScan(scan);
        if (accepted.kind === "acknowledged") continue;
        if (accepted.kind === "security_contradiction") {
          console.error({ event: "document_processing_security_contradiction" });
          continue;
        }
        const result = await parser.parse(accepted.job);
        if (!result.ok) {
          console.info({
            event: "document_processing_parser_rejected",
            failureCode: result.failureCode,
            reasonCode: result.reasonCode,
          });
          await store.rejectAfterParse(accepted.job, result);
          continue;
        }
        const normalized = await normalizedReader.read(accepted.job, result);
        const normalizedPages = normalized.blocks.flatMap((block) =>
          block.page === undefined ? [] : [block.page],
        );
        const pageCount = normalizedPages.length > 0 ? Math.max(...normalizedPages) : 1;
        const characterCount = normalized.blocks.reduce(
          (total, block) => total + block.text.length,
          0,
        );
        if (pageCount !== result.pageCount || characterCount !== result.characterCount) {
          throw new Error("DocumentParserCountMismatch");
        }
        const proposalCount = await store.completeParsed(accepted.job, result, normalized);
        console.info({
          event: "document_processing_completed",
          pageCount: result.pageCount,
          characterCount: result.characterCount,
          proposalCount,
          parserVersion: result.parserVersion,
        });
      } catch (error) {
        const candidate = error as { name?: unknown; message?: unknown };
        const rawCode =
          typeof candidate.name === "string" && candidate.name !== "Error"
            ? candidate.name
            : candidate.message;
        const errorCode =
          typeof rawCode === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(rawCode)
            ? rawCode
            : "UnclassifiedError";
        console.error({ event: "document_processing_record_failed", errorCode });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

function parseScanRecord(record: SQSRecord): DocumentScanResultV1 {
  if (Buffer.byteLength(record.body, "utf8") > MAXIMUM_SCAN_EVENT_BYTES) {
    throw new Error("DocumentScanEventTooLarge");
  }
  let value: unknown;
  try {
    value = JSON.parse(record.body);
  } catch {
    throw new Error("DocumentScanEventMalformed");
  }
  if (!validateDocumentScanResult(value)) throw new Error("DocumentScanEventInvalid");
  return value;
}

let runtimeHandler: ReturnType<typeof createDocumentProcessorHandler> | undefined;
let runtimeStore: PostgresDocumentProcessorStore | undefined;
let runtimeParser: AwsDocumentParserClient | undefined;
let runtimeTailoring: ReturnType<typeof createResumeTailoringService> | undefined;
let runtimeOriginalResume: ReturnType<typeof createOriginalResumeService> | undefined;

function getRuntimeParser(): { parser: AwsDocumentParserClient; parserVersion: string } {
  const bucketName = process.env.CANDIDATE_DOCUMENT_BUCKET ?? "";
  const kmsKeyArn = process.env.PLATFORM_KMS_KEY_ARN ?? "";
  const parserFunctionArn = process.env.DOCUMENT_PARSER_FUNCTION_ARN ?? "";
  const parserVersion = process.env.DOCUMENT_PARSER_VERSION ?? "";
  const objectAccessRoleArn = process.env.DOCUMENT_OBJECT_ACCESS_ROLE_ARN ?? "";
  const region = process.env.AWS_REGION ?? "";
  if (
    !bucketName ||
    !kmsKeyArn ||
    !/^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9-_]+:[1-9][0-9]*$/u.test(
      parserFunctionArn,
    ) ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(parserVersion) ||
    !/^arn:aws:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_-]+$/u.test(objectAccessRoleArn) ||
    !/^[a-z]{2}-[a-z]+-[0-9]$/u.test(region)
  ) {
    throw new Error("Document parser client configuration is incomplete");
  }
  runtimeParser ??= new AwsDocumentParserClient(
    parserFunctionArn,
    parserVersion,
    objectAccessRoleArn,
    bucketName,
    kmsKeyArn,
    region,
  );
  return { parser: runtimeParser, parserVersion };
}

export function createDocumentProcessingReconciler(
  expectedRuleArn: string,
  store: ReconcilerStore,
) {
  if (!expectedRuleArn) throw new Error("Document reconciler configuration is incomplete");
  return async (event: ScheduledEvent): Promise<void> => {
    if (
      event.source !== "aws.events" ||
      event["detail-type"] !== "Scheduled Event" ||
      event.resources.length !== 1 ||
      event.resources[0] !== expectedRuleArn
    ) {
      throw new Error("DocumentReconcilerEventInvalid");
    }
    const counts = await store.failStuckDocuments();
    if (counts.scanTimedOut > 0 || counts.parseTimedOut > 0) {
      console.error({
        event: "document_processing_timed_out",
        scanTimedOut: counts.scanTimedOut,
        parseTimedOut: counts.parseTimedOut,
      });
    }
    console.info({
      event: "document_processing_reconciled",
      scanTimedOut: counts.scanTimedOut,
      parseTimedOut: counts.parseTimedOut,
    });
  };
}

function isScheduledEvent(event: SQSEvent | ScheduledEvent): event is ScheduledEvent {
  return "source" in event && event.source === "aws.events";
}

export async function handler(
  event: SQSEvent | ScheduledEvent | DocumentParserCorpusRequest | { kind: string },
): Promise<
  | SQSBatchResponse
  | DocumentParserCorpusAggregate
  | ResumeTailoringResult
  | OriginalResumeResult
  | undefined
> {
  if ((event as { kind?: unknown }).kind === "development-document-parser-corpus-v1") {
    const { parser, parserVersion } = getRuntimeParser();
    return executeDocumentParserCorpus(event, parserVersion, parser);
  }
  if (!runtimeHandler) {
    const databaseUrl = await resolveLambdaDatabaseUrl(
      {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.DATABASE_SECRET_ID
          ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
          : {}),
      },
      { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
    );
    const database = createDatabase(databaseUrl, { maxConnections: 1 });
    const bucketName = process.env.CANDIDATE_DOCUMENT_BUCKET ?? "";
    const kmsKeyArn = process.env.PLATFORM_KMS_KEY_ARN ?? "";
    const accountId = process.env.PLATFORM_AWS_ACCOUNT_ID ?? "";
    const protectionPlanArn = process.env.GUARDDUTY_PROTECTION_PLAN_ARN ?? "";
    const region = process.env.AWS_REGION ?? "";
    if (!bucketName || !kmsKeyArn || !protectionPlanArn || !/^[0-9]{12}$/u.test(accountId)) {
      throw new Error("Document processor configuration is incomplete");
    }
    runtimeStore = new PostgresDocumentProcessorStore(
      database.client,
      new PostgresResumeProposalWriter(),
    );
    const { parser } = getRuntimeParser();
    const normalizedReader = new S3NormalizedDocumentReader(bucketName, kmsKeyArn);
    runtimeTailoring = createResumeTailoringService({
      source: new PostgresParsedResumeSource(database.client),
      reader: normalizedReader,
    });
    const source = new PostgresParsedResumeSource(database.client);
    runtimeOriginalResume = createOriginalResumeService({
      source,
      reader: new S3OriginalResumeReader(
        bucketName,
        kmsKeyArn,
        process.env.DOCUMENT_OBJECT_ACCESS_ROLE_ARN ?? "",
        region,
      ),
    });
    runtimeHandler = createDocumentProcessorHandler(
      { accountId, region, protectionPlanArn, bucketName },
      runtimeStore,
      parser,
      normalizedReader,
    );
  }
  if ((event as { kind?: unknown }).kind === RESUME_TAILORING_REQUEST_KIND) {
    return (runtimeTailoring as ReturnType<typeof createResumeTailoringService>)(event);
  }
  if ((event as { kind?: unknown }).kind === ORIGINAL_RESUME_REQUEST_KIND) {
    return (runtimeOriginalResume as ReturnType<typeof createOriginalResumeService>)(event);
  }
  if (isScheduledEvent(event as SQSEvent | ScheduledEvent)) {
    await createDocumentProcessingReconciler(
      process.env.DOCUMENT_RECONCILER_RULE_ARN ?? "",
      runtimeStore as PostgresDocumentProcessorStore,
    )(event as ScheduledEvent);
    return undefined;
  }
  return runtimeHandler(event as SQSEvent);
}
