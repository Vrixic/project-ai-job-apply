import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schemas/candidate-deletion-reconciled-copy.v1.schema.json" with {
  type: "json",
};
import restoreSchema from "../schemas/candidate-deletion-restore.v1.schema.json" with {
  type: "json",
};
import {
  type CandidateDeletionRestoreReplayResult,
  RESTORE_MAXIMUM_LIFETIME_MS,
  restoreDigest,
} from "./candidate-deletion-restore-contract.js";

const validator = new Ajv2020({ strict: true, allErrors: false });
validator.addSchema(restoreSchema);
validator.addSchema(schema);
const configurationSchema = validator.compile({ $ref: `${schema.$id}#/$defs/configuration` });
const requestSchema = validator.compile({ $ref: `${schema.$id}#/$defs/request` });
export const RECONCILED_COPY_BUDGET_MS = 120_000;
export const RECONCILED_COPY_CLOSE_RESERVE_MS = 10_000;
export const RECONCILED_COPY_ENVIRONMENT_KEYS = [
  "NODE_ENV",
  "RELEASE_SHA",
  "DATABASE_SECRET_ID",
  "CANDIDATE_DOCUMENT_BUCKET",
  "CANDIDATE_DELETION_RECOVERY_BUCKET",
  "CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN",
  "RECONCILED_COPY_CONFIG_JSON",
  "RECONCILED_COPY_CONFIG_SHA256",
] as const;
const SHA = /^[a-f0-9]{64}$/u;
type Environment = Readonly<Record<string, string | undefined>>;

export interface ReconciledCopyConfiguration {
  schemaVersion: 1;
  runId: string;
  accountId: string;
  region: "us-east-2";
  sourceSha: string;
  mode: "reconciled_isolated" | "promoted_primary";
  targetIdentifier: string;
  targetDbiResourceId: string;
  targetHostname: string;
  targetBoundarySha256: string;
  operatorEvidenceSha256: string;
  originalReceiptSha256: string;
  originalInvocationSha256: string;
  originalConfigurationSha256: string;
  originalIssuedAt: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ReconciledCopyRequest {
  schemaVersion: 1;
  action: "verify";
  runId: string;
  configurationSha256: string;
  functionVersion: string;
  originalReceipt: CandidateDeletionRestoreReplayResult;
}

function rejected(): never {
  throw new Error("CandidateDeletionReconciledCopyAdmissionRejected");
}

function date(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) rejected();
  return parsed;
}

export function reconciledCopyReceiptSha256(receipt: CandidateDeletionRestoreReplayResult): string {
  return restoreDigest("candidate-deletion-original-replay-receipt-v1", receipt);
}

export function serializeReconciledCopyConfiguration(value: ReconciledCopyConfiguration): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(schema.$defs.configuration.properties).map((key) => [
        key,
        value[key as keyof ReconciledCopyConfiguration],
      ]),
    ),
  );
}

export function calculateReconciledCopyConfigurationSha256(environment: Environment): string {
  return restoreDigest(
    "candidate-deletion-reconciled-copy-configuration-v1",
    RECONCILED_COPY_ENVIRONMENT_KEYS.filter((key) => key !== "RECONCILED_COPY_CONFIG_SHA256")
      .sort()
      .map((key) => {
        const value = environment[key];
        if (typeof value !== "string") rejected();
        return [key, value];
      }),
  );
}

export function loadReconciledCopyEnvironment(environment: Environment, now: Date) {
  try {
    const allowed = new Set<string>(RECONCILED_COPY_ENVIRONMENT_KEYS);
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) continue;
      if (
        (/^(?:CANDIDATE_|DATABASE_|RESTORE_|RECONCILED_|AUTH0_|OIDC_|D2_|AWS_ENDPOINT_URL|PG)/u.test(
          key,
        ) &&
          !allowed.has(key)) ||
        /^(?:AWS_(?:EC2_METADATA_SERVICE_ENDPOINT|CONTAINER_CREDENTIALS_|SHARED_CREDENTIALS_FILE|CONFIG_FILE)|NODE_OPTIONS$)/u.test(
          key,
        ) ||
        /^(?:AWS_PROFILE|AWS_DEFAULT_PROFILE|NODE_TLS_REJECT_UNAUTHORIZED|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_USE_ENV_PROXY)$/iu.test(
          key,
        ) ||
        ((key === "AWS_REGION" || key === "AWS_DEFAULT_REGION") && value !== "us-east-2")
      )
        rejected();
    }
    if (
      RECONCILED_COPY_ENVIRONMENT_KEYS.some((key) => typeof environment[key] !== "string") ||
      environment.NODE_ENV !== "production" ||
      !/^[a-f0-9]{40}$/u.test(environment.RELEASE_SHA ?? "") ||
      !SHA.test(environment.RECONCILED_COPY_CONFIG_SHA256 ?? "") ||
      Buffer.byteLength(
        JSON.stringify(
          Object.fromEntries(
            RECONCILED_COPY_ENVIRONMENT_KEYS.map((key) => [key, environment[key]]),
          ),
        ),
        "utf8",
      ) > 4096
    )
      rejected();
    for (const key of ["CANDIDATE_DOCUMENT_BUCKET", "CANDIDATE_DELETION_RECOVERY_BUCKET"]) {
      const bucket = environment[key] ?? "";
      if (
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) ||
        bucket.includes("..") ||
        /^\d+\.\d+\.\d+\.\d+$/u.test(bucket)
      )
        rejected();
    }
    if (environment.CANDIDATE_DOCUMENT_BUCKET === environment.CANDIDATE_DELETION_RECOVERY_BUCKET)
      rejected();
    const encoded = environment.RECONCILED_COPY_CONFIG_JSON ?? "";
    if (Buffer.byteLength(encoded, "utf8") > 3072) rejected();
    const configuration = JSON.parse(encoded) as ReconciledCopyConfiguration;
    if (
      !configurationSchema(configuration) ||
      configuration.sourceSha !== environment.RELEASE_SHA ||
      serializeReconciledCopyConfiguration(configuration) !== encoded
    )
      rejected();
    const issued = date(configuration.issuedAt),
      expires = date(configuration.expiresAt),
      original = date(configuration.originalIssuedAt);
    const nowMs = Date.prototype.getTime.call(now);
    if (
      !Number.isFinite(nowMs) ||
      issued > nowMs ||
      original <= 0 ||
      original > issued ||
      expires <= issued ||
      expires - issued > RESTORE_MAXIMUM_LIFETIME_MS ||
      expires - nowMs < RECONCILED_COPY_BUDGET_MS + RECONCILED_COPY_CLOSE_RESERVE_MS
    )
      rejected();
    if (
      configuration.targetHostname !==
        `${configuration.targetIdentifier}.${configuration.targetHostname.split(".").slice(1).join(".")}` ||
      (configuration.mode === "promoted_primary"
        ? configuration.targetIdentifier !== "ai-job-apply-development"
        : !/^ai-job-apply-development-restore-[0-9]{14}$/u.test(configuration.targetIdentifier))
    )
      rejected();
    if (
      !new RegExp(
        `^arn:aws:secretsmanager:us-east-2:${configuration.accountId}:secret:ai-job-apply/development/database-url-[A-Za-z0-9]{6}$`,
        "u",
      ).test(environment.DATABASE_SECRET_ID ?? "") ||
      !new RegExp(
        `^arn:aws:kms:us-east-2:${configuration.accountId}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`,
        "u",
      ).test(environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN ?? "")
    )
      rejected();
    const configurationSha256 = calculateReconciledCopyConfigurationSha256(environment);
    if (configurationSha256 !== environment.RECONCILED_COPY_CONFIG_SHA256) rejected();
    return { configuration: Object.freeze(configuration), configurationSha256 };
  } catch {
    return rejected();
  }
}

/** Caller metadata is sealed by the reviewed IAM operator, not authenticated by AWS here. */
export function validateReconciledCopyRequest(
  event: unknown,
  configuration: ReconciledCopyConfiguration,
  configurationSha256: string,
  context: { invokedFunctionArn: string; functionVersion: string },
): ReconciledCopyRequest {
  try {
    const encoded = JSON.stringify(event);
    if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > 24_576) rejected();
    const request = JSON.parse(encoded) as ReconciledCopyRequest;
    if (
      !requestSchema(request) ||
      request.runId !== configuration.runId ||
      request.configurationSha256 !== configurationSha256 ||
      request.functionVersion !== context.functionVersion ||
      context.invokedFunctionArn !==
        `arn:aws:lambda:us-east-2:${configuration.accountId}:function:ai-job-apply-development-verify-${configuration.runId}:${request.functionVersion}`
    )
      rejected();
    const receipt = request.originalReceipt;
    if (
      !receipt.preservation ||
      receipt.configurationSha256 !== configuration.originalConfigurationSha256 ||
      reconciledCopyReceiptSha256(receipt) !== configuration.originalReceiptSha256 ||
      date(receipt.expiresAt) <= date(configuration.originalIssuedAt) ||
      date(receipt.expiresAt) - date(configuration.originalIssuedAt) > RESTORE_MAXIMUM_LIFETIME_MS
    )
      rejected();
    return request;
  } catch {
    return rejected();
  }
}
