import { createHash } from "node:crypto";
import manifest from "@ai-job-apply/database-migrations/restore-manifest.json" with {
  type: "json",
};
import {
  parseRestoreManifest,
  type RestoreSqlClient,
  type RestoreVerificationResult,
  verifyRestoreDatabase,
} from "@ai-job-apply/database-migrations/restore-verifier";
import { createDatabase, type DatabaseHandle } from "@ai-job-apply/profile-service";
import { verifyReconciledCandidateDeletionCopyWithDocumentContinuity } from "./candidate-deletion-reconciled-copy.js";
import {
  loadReconciledCopyEnvironment,
  RECONCILED_COPY_BUDGET_MS,
  RECONCILED_COPY_CLOSE_RESERVE_MS,
  type ReconciledCopyConfiguration,
  validateReconciledCopyRequest,
} from "./candidate-deletion-reconciled-copy-contract.js";
import {
  AwsReadOnlyCandidateDeletionRestoreLedger,
  AwsReadOnlyCandidateRestoreDocuments,
} from "./candidate-deletion-restore-aws.js";
import { CURRENT_RESTORE_MANIFEST_SHA256 } from "./candidate-deletion-restore-contract.js";
import { resolveReconciledCopyDatabaseUrl } from "./candidate-deletion-restore-database.js";

// JSON bundling preserves values, not original source whitespace. The artifact
// builder checks the raw source hash; this separate checksum pins embedded values.
if (
  createHash("sha256").update(JSON.stringify(manifest)).digest("hex") !==
  "7d3af2bd511e065db036efe2465e9218415d75f0970e5931e95ab54fd80794c4"
) {
  throw new Error("CandidateDeletionReconciledCopyManifestRejected");
}
const manifestSource = Object.freeze({
  manifest: parseRestoreManifest(manifest),
  sha256: CURRENT_RESTORE_MANIFEST_SHA256,
});
type Environment = Readonly<Record<string, string | undefined>>;
type Opened = { database: DatabaseHandle; close(): Promise<void> };
export interface ReconciledCopyContext {
  invokedFunctionArn: string;
  functionVersion: string;
  getRemainingTimeInMillis(): number;
}
export interface ReconciledCopyDependencies {
  environment(): Environment;
  now(): Date;
  openDatabase(
    config: ReconciledCopyConfiguration,
    environment: Environment,
    signal: AbortSignal,
  ): Promise<Opened>;
  ledger(
    config: ReconciledCopyConfiguration,
    environment: Environment,
  ): Pick<AwsReadOnlyCandidateDeletionRestoreLedger, "inspectCompletedMarkers" | "assertUnchanged">;
  documents(
    config: ReconciledCopyConfiguration,
    environment: Environment,
  ): Pick<AwsReadOnlyCandidateRestoreDocuments, "inspectReplayDocumentContinuity">;
}
function rejected(): never {
  throw new Error("CandidateDeletionReconciledCopyVerificationRejected");
}
const defaults: ReconciledCopyDependencies = {
  environment: () => process.env,
  now: () => new Date(),
  openDatabase: async (config, environment, signal) => {
    const url = await resolveReconciledCopyDatabaseUrl(config, environment, signal);
    if (signal.aborted) rejected();
    const database = createDatabase(url, { maxConnections: 1 });
    return {
      database,
      close: async () => {
        await database.client.end({ timeout: 5 });
      },
    };
  },
  ledger: (config, environment) =>
    new AwsReadOnlyCandidateDeletionRestoreLedger({
      bucketName: environment.CANDIDATE_DELETION_RECOVERY_BUCKET ?? "",
      expectedBucketOwner: config.accountId,
      kmsKeyArn: environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN ?? "",
      timeoutMs: 90_000,
    }),
  documents: (config, environment) =>
    new AwsReadOnlyCandidateRestoreDocuments({
      bucketName: environment.CANDIDATE_DOCUMENT_BUCKET ?? "",
      expectedBucketOwner: config.accountId,
      timeoutMs: 90_000,
    }),
};

async function close(opened: Opened): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      opened.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("CandidateDeletionReconciledCopyVerificationRejected")),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Direct numeric IAM invocation, no triggers, aliases, retries or mutation ports. */
export function createReconciledCopyVerificationHandler(
  dependencies: ReconciledCopyDependencies = defaults,
) {
  return async (event: unknown, context: ReconciledCopyContext) => {
    const controller = new AbortController();
    const signal = controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened: Opened | undefined;
    let abortWait: (() => void) | undefined;
    try {
      // Detach environment, request and original receipt before any async boundary.
      const environment = Object.freeze({ ...dependencies.environment() });
      const admission = loadReconciledCopyEnvironment(environment, dependencies.now());
      const config = admission.configuration;
      const request = validateReconciledCopyRequest(
        event,
        config,
        admission.configurationSha256,
        context,
      );
      const remaining = context.getRemainingTimeInMillis();
      if (
        !Number.isFinite(remaining) ||
        remaining < RECONCILED_COPY_BUDGET_MS + RECONCILED_COPY_CLOSE_RESERVE_MS
      )
        rejected();
      const deadline = Math.min(
        Date.now() + RECONCILED_COPY_BUDGET_MS,
        Date.parse(config.expiresAt) - RECONCILED_COPY_CLOSE_RESERVE_MS,
      );
      const active = () => {
        if (
          signal.aborted ||
          Date.now() >= deadline ||
          dependencies.now().getTime() >=
            Date.parse(config.expiresAt) - RECONCILED_COPY_CLOSE_RESERVE_MS
        )
          rejected();
      };
      active();
      timer = setTimeout(() => controller.abort(), deadline - Date.now());
      async function verify() {
        const connection = await dependencies.openDatabase(config, environment, signal);
        if (signal.aborted || Date.now() >= deadline) {
          await close(connection);
          rejected();
        }
        opened = connection;
        active();
        // The pure manifest verifier has strict read-only/time-limited SQL. Add
        // cancellation of the actual pending postgres query on global timeout.
        const client: RestoreSqlClient = {
          begin: (options, work) =>
            connection.database.client.begin(options, async (sql) =>
              work({
                unsafe: async <T extends Record<string, unknown>>(query: string): Promise<T[]> => {
                  active();
                  const pending = sql.unsafe(query);
                  const cancel = () => {
                    pending.cancel();
                  };
                  signal.addEventListener("abort", cancel, { once: true });
                  try {
                    if (signal.aborted) {
                      cancel();
                      rejected();
                    }
                    const rows = await pending;
                    active();
                    return rows as unknown as T[];
                  } finally {
                    signal.removeEventListener("abort", cancel);
                  }
                },
              }),
            ) as Promise<Awaited<ReturnType<typeof work>>>,
        };
        const schemaVerification: RestoreVerificationResult = await verifyRestoreDatabase(
          client,
          manifestSource,
        );
        active();
        if (
          schemaVerification.manifestSha256 !== CURRENT_RESTORE_MANIFEST_SHA256 ||
          schemaVerification.ownerCount !== 7 ||
          schemaVerification.relationCount !== 96 ||
          schemaVerification.migrationCount !== 79
        )
          rejected();
        const verification = await verifyReconciledCandidateDeletionCopyWithDocumentContinuity(
          connection.database,
          dependencies.ledger(config, environment),
          dependencies.documents(config, environment),
          request.originalReceipt,
          config.originalIssuedAt,
          signal,
        );
        active();
        return { schemaVerification, verification };
      }
      const aggregate = await Promise.race([
        verify(),
        new Promise<never>((_, reject) => {
          abortWait = () =>
            reject(new Error("CandidateDeletionReconciledCopyVerificationRejected"));
          signal.addEventListener("abort", abortWait, { once: true });
          if (signal.aborted) abortWait();
        }),
      ]);
      active();
      if (!opened) rejected();
      const toClose = opened;
      opened = undefined;
      await close(toClose);
      active();
      return Object.freeze({
        schemaVersion: 1,
        action: "verify",
        outcome: "verified",
        runId: config.runId,
        sourceSha: config.sourceSha,
        configurationSha256: admission.configurationSha256,
        functionVersion: request.functionVersion,
        mode: config.mode,
        expiresAt: config.expiresAt,
        targetBoundarySha256: config.targetBoundarySha256,
        operatorEvidenceSha256: config.operatorEvidenceSha256,
        originalReceiptSha256: config.originalReceiptSha256,
        originalInvocationSha256: config.originalInvocationSha256,
        ...aggregate,
      });
    } catch {
      return rejected();
    } finally {
      controller.abort();
      if (timer) clearTimeout(timer);
      if (abortWait) signal.removeEventListener("abort", abortWait);
      if (opened) {
        try {
          await close(opened);
        } catch {
          /* Rejected aggregate remains rejected. */
        }
      }
    }
  };
}
export const handler = createReconciledCopyVerificationHandler();
