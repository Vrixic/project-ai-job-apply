import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { vi } from "vitest";
import { createCoverLetterIsolatedProviderLambda } from "./cover-letter-isolated-provider-lambda.js";
import {
  coverLetterProviderSha256,
  encodeCoverLetterProviderObject,
} from "./cover-letter-provider-contract.js";
import type { CoverLetterProviderLambdaClient } from "./cover-letter-provider-invoke.js";
import { S3CoverLetterProviderObjects } from "./cover-letter-provider-objects.js";

/** Synthetic transport fixture only. Imported by tests, never an actor entrypoint. */
export async function isolatedProviderFixture(
  settings: {
    documentId?: string;
    now?: Date;
    expiresAt?: Date;
    terminalStatus?: "completed" | "failed" | "cancelled" | "incomplete";
    rpc?: (input: Record<string, unknown>, target: string) => Promise<unknown>;
  } = {},
) {
  const documentId = settings.documentId ?? "019a4000-0000-7000-8000-000000000001";
  const now = settings.now ?? new Date("2026-10-04T12:01:00.000Z");
  const expiresAt = settings.expiresAt ?? new Date(now.getTime() + 14 * 60_000);
  const env: Record<string, string | undefined> = {
    COVER_LETTER_ISOLATED_PROVIDER_ENABLED: "true",
    COVER_LETTER_BACKGROUND_PROVIDER_ENABLED: "true",
    AWS_REGION: "us-east-2",
    PLATFORM_AWS_ACCOUNT_ID: "123456789012",
    AWS_SESSION_TOKEN: "synthetic-session-token",
    AWS_LAMBDA_FUNCTION_NAME: "synthetic-provider",
    AWS_LAMBDA_FUNCTION_VERSION: "9",
    COVER_LETTER_PROVIDER_CONTROL_FUNCTION_ARN:
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-control:3",
    COVER_LETTER_RESPONSE_CAPTURE_FUNCTION_ARN:
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-capture:5",
    COVER_LETTER_OPENAI_SECRET_ID:
      "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-openai-ABCDEF",
    CANDIDATE_DOCUMENT_BUCKET: "synthetic-bucket",
    PLATFORM_KMS_KEY_ARN:
      "arn:aws:kms:us-east-2:123456789012:key/019a4000-0000-7000-8000-000000000003",
  };
  const target = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-provider:9";
  const versions = new Map<
    string,
    Array<{ bytes: Uint8Array; version: string; etag: string; metadata: Record<string, string> }>
  >();
  let serial = 0;
  const objectSend = vi.fn(async (command: unknown): Promise<Record<string, unknown>> => {
    if (
      !(
        command instanceof PutObjectCommand ||
        command instanceof HeadObjectCommand ||
        command instanceof GetObjectCommand
      )
    )
      throw Error("SyntheticUnexpectedObjectCapability");
    const key = command.input.Key ?? "";
    const history = versions.get(key) ?? [];
    if (command instanceof PutObjectCommand) {
      if (!(command.input.Body instanceof Uint8Array)) throw Error("SyntheticUnexpectedObjectBody");
      if (
        (command.input.IfNoneMatch === "*" && history.length) ||
        (command.input.IfMatch && history.at(-1)?.etag !== command.input.IfMatch)
      )
        throw { name: "PreconditionFailed" };
      const bytes = Uint8Array.from(command.input.Body);
      const row = {
        bytes,
        version: `synthetic-${++serial}`,
        etag: `"${coverLetterProviderSha256(bytes)}"`,
        metadata: command.input.Metadata ?? {},
      };
      versions.set(key, [...history, row]);
      return { VersionId: row.version, $metadata: { attempts: 1, httpStatusCode: 200 } };
    }
    const row = command.input.VersionId
      ? history.find((item) => item.version === command.input.VersionId)
      : history.at(-1);
    if (!row) throw { name: "NotFound" };
    if (command instanceof GetObjectCommand)
      return { VersionId: row.version, Body: Uint8Array.from(row.bytes) };
    return {
      VersionId: row.version,
      ETag: row.etag,
      ContentLength: row.bytes.length,
      ContentType: "application/json",
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: env.PLATFORM_KMS_KEY_ARN,
      Metadata: row.metadata,
    };
  });
  const objectClient = { config: { maxAttempts: async () => 1 }, send: objectSend };
  const objects = new S3CoverLetterProviderObjects(
    env.CANDIDATE_DOCUMENT_BUCKET ?? "",
    env.PLATFORM_KMS_KEY_ARN ?? "",
    objectClient,
  );
  const saved = await objects.putIfAbsent(
    documentId,
    "request",
    encodeCoverLetterProviderObject("request", {
      schemaVersion: 1,
      documentId,
      noticeVersion: "openai-cover-letter.v1",
      promptVersion: "1.0.0",
      jobContextHash: "a".repeat(64),
      confirmedFactsHash: "b".repeat(64),
      approvedAt: new Date(expiresAt.getTime() - 15 * 60_000).toISOString(),
      expiresAt: expiresAt.toISOString(),
      system: "Synthetic grounding rules",
      user: "Synthetic TypeScript fact",
      maxOutputChars: 8000,
    }),
  );
  const binding = { schemaVersion: 1, documentId, requestSha256: saved.reference.sha256 };
  for (const slot of ["result", "dispatch"] as const)
    await objects.putIfAbsent(
      documentId,
      slot,
      encodeCoverLetterProviderObject(slot, {
        ...binding,
        state: slot === "result" ? "pending" : "issued",
      }),
    );
  objectSend.mockClear();
  const reference = {
    id: "019a4000-0000-7000-8000-000000000002",
    documentId,
    purpose: "provider_dispatch",
    requestSha256: saved.reference.sha256,
  };
  let claimed = false;
  const invoke = vi.fn<CoverLetterProviderLambdaClient["send"]>(async (command) => {
    const input = JSON.parse(
      new TextDecoder().decode(command.input.Payload as Uint8Array),
    ) as Record<string, unknown>;
    const arn = String(command.input.FunctionName);
    let output: unknown;
    if (settings.rpc) output = await settings.rpc(input, arn);
    else if (input.action === "claim") {
      output = {
        schemaVersion: 1,
        action: "claim",
        documentId,
        outcome: claimed ? "unavailable" : "claimed",
        ...(!claimed ? { reference } : {}),
      };
      claimed = true;
    } else
      output = {
        ...input,
        outcome:
          input.action === "reserve"
            ? "reserved"
            : input.action === "record_creation"
              ? "recorded"
              : "settled",
      };
    return {
      StatusCode: 200,
      ExecutedVersion: arn.slice(arn.lastIndexOf(":") + 1),
      Payload: new TextEncoder().encode(JSON.stringify(output)),
    };
  });
  const modelFetch = vi.fn<typeof fetch>(async () =>
    Response.json({
      object: "response",
      id: "resp_syntheticBootstrap1",
      created_at: Math.floor(now.getTime() / 1000),
      model: "gpt-6-luna",
      background: true,
      store: false,
      previous_response_id: null,
      conversation: null,
      tools: [],
      status: settings.terminalStatus ?? "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                paragraphs: [{ text: "Synthetic TypeScript experience", factIds: [documentId] }],
              }),
            },
          ],
        },
      ],
    }),
  );
  const resolve = vi.fn(async () => "synthetic-api-key-value");
  const createObjectClient = vi.fn(() => objectClient);
  const createLambdaClient = vi.fn(() => ({
    config: { maxAttempts: async () => 1 },
    send: invoke,
  }));
  const options = {
    environment: () => env,
    resolveProviderKey: resolve,
    createObjectClient,
    createLambdaClient,
    modelFetch,
    clock: () => now,
  };
  const run = createCoverLetterIsolatedProviderLambda(options);
  const input = { schemaVersion: 1, documentId, request: saved.reference };
  return {
    env,
    target,
    now,
    expiresAt,
    reference,
    input,
    run,
    options,
    resolve,
    objectSend,
    invoke,
    modelFetch,
    createObjectClient,
    createLambdaClient,
    versions,
    objects,
    call: () => run(input, { invokedFunctionArn: target }),
  };
}
