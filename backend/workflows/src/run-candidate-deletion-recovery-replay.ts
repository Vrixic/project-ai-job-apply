import { createDatabase, loadCandidateRightsPolicy } from "@ai-job-apply/profile-service";
import { replayCandidateDeletionRecovery } from "./candidate-deletion-recovery-replay.js";
import { PostgresCandidateRightsActivityStore } from "./candidate-rights-activities.js";
import { AwsCandidateDocumentObjectStore } from "./candidate-rights-aws.js";
import { AwsCandidateDeletionRecoveryLedger } from "./candidate-rights-recovery-ledger.js";

const REQUIRED_ACKNOWLEDGEMENT = "RESTORED_DATABASE_IS_QUIESCED_AND_NOT_SERVING_TRAFFIC";

async function main(): Promise<void> {
  const databaseUrl = process.env.RESTORE_DATABASE_URL;
  const recoveryBucket = process.env.CANDIDATE_DELETION_RECOVERY_BUCKET;
  const documentBucket = process.env.CANDIDATE_DOCUMENT_BUCKET;
  const kmsKeyArn = process.env.CANDIDATE_DATA_EXPORT_KMS_KEY_ARN;
  if (
    process.env.CANDIDATE_DELETION_RECOVERY_REPLAY_ACK !== REQUIRED_ACKNOWLEDGEMENT ||
    !databaseUrl ||
    !recoveryBucket ||
    !documentBucket ||
    !kmsKeyArn
  ) {
    throw new Error("CandidateDeletionRecoveryReplayConfigurationRejected");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === databaseUrl) {
    throw new Error("CandidateDeletionRecoveryReplayPrimaryDatabaseRejected");
  }
  const policy = loadCandidateRightsPolicy(process.env);
  const database = createDatabase(databaseUrl, { maxConnections: 1 });
  const ledger = new AwsCandidateDeletionRecoveryLedger(recoveryBucket, kmsKeyArn);
  const store = new PostgresCandidateRightsActivityStore({
    database,
    policy,
    recoveryLedger: ledger,
    documentObjectStore: new AwsCandidateDocumentObjectStore(documentBucket),
    artifactStore: {
      putIfAbsent: async () => {
        throw new Error("CandidateExportUnavailableDuringRestoreReplay");
      },
    },
    identityProvider: {
      revokeAndDelete: async () => {
        throw new Error("IdentityMutationUnavailableDuringRestoreReplay");
      },
    },
    subprocessors: [],
  });
  try {
    const result = await replayCandidateDeletionRecovery(ledger, store);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.client.end();
  }
}

await main();
