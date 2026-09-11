import {
  COMPLETION_MARKER_LIST_MAX_KEYS,
  completionMarkerObservationFromAws,
  completionMarkerVersionFingerprint,
  completionMarkerVersionFromListing,
  validateCompletionMarkerTarget,
} from "./candidate-deletion-completion-marker-evidence.js";
import {
  COMPLETION_REPAIR_S3_CONFIGURATION,
  type CompletionRepairObservation,
  type CompletionRepairTarget,
} from "./candidate-deletion-completion-tag-repair.js";

export const COMPLETION_MARKER_READ_TIMEOUT_MS = 30_000;
type ExactObjectInput = {
  Bucket: string;
  ExpectedBucketOwner: string;
  Key: string;
  VersionId: string;
};
type VersionListInput = { Bucket: string; ExpectedBucketOwner: string; Prefix: string; MaxKeys: 2 };

/** Installed SDK classes only; notably no GetObject, KMS, Put, Delete, SQL or credential methods. */
export interface CompletionMarkerReadSdk {
  S3Client: new (
    configuration: typeof COMPLETION_REPAIR_S3_CONFIGURATION,
  ) => {
    send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
    destroy(): void;
  };
  HeadObjectCommand: new (input: ExactObjectInput & { ChecksumMode: "ENABLED" }) => unknown;
  GetObjectTaggingCommand: new (input: ExactObjectInput) => unknown;
  GetObjectRetentionCommand: new (input: ExactObjectInput) => unknown;
  ListObjectVersionsCommand: new (input: VersionListInput) => unknown;
}

function rejected(): never {
  throw new Error("HistoricalCompletionMarkerReadRejected");
}

/** Caller composition authenticates expected SSO/account; region/endpoint cannot be overridden. */
export function createCompletionMarkerS3Reader(
  sdk: CompletionMarkerReadSdk,
  expectedKmsKeyArn: string,
) {
  return Object.freeze({
    async readExactVersion(
      targetInput: CompletionRepairTarget,
      externalSignal?: AbortSignal,
    ): Promise<CompletionRepairObservation> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let client: InstanceType<CompletionMarkerReadSdk["S3Client"]> | undefined;
      let observedExternal: AbortSignal | undefined;
      const abort = () => controller.abort();
      try {
        const target = validateCompletionMarkerTarget(targetInput);
        if (
          !new RegExp(
            `^arn:aws:kms:us-east-2:${target.expectedBucketOwner}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`,
            "u",
          ).test(expectedKmsKeyArn)
        )
          rejected();
        if (externalSignal !== undefined && !(externalSignal instanceof AbortSignal)) rejected();
        if (externalSignal?.aborted) rejected();
        observedExternal = externalSignal;
        observedExternal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, COMPLETION_MARKER_READ_TIMEOUT_MS);
        client = new sdk.S3Client(COMPLETION_REPAIR_S3_CONFIGURATION);
        const send = (command: unknown): Promise<unknown> => {
          if (controller.signal.aborted)
            return Promise.reject(new Error("HistoricalCompletionMarkerReadRejected"));
          return new Promise((resolve, reject) => {
            const onAbort = () => reject(new Error("HistoricalCompletionMarkerReadRejected"));
            controller.signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve()
              .then(() => {
                if (controller.signal.aborted || !client) rejected();
                return client.send(command, { abortSignal: controller.signal });
              })
              .then(resolve, reject)
              .finally(() => {
                controller.signal.removeEventListener("abort", onAbort);
              });
          });
        };
        const exact = {
          Bucket: target.bucketName,
          ExpectedBucketOwner: target.expectedBucketOwner,
          Key: target.key,
          VersionId: target.versionId,
        };
        const list = {
          Bucket: target.bucketName,
          ExpectedBucketOwner: target.expectedBucketOwner,
          Prefix: target.key,
          MaxKeys: COMPLETION_MARKER_LIST_MAX_KEYS,
        } as const;
        const before = completionMarkerVersionFromListing(
          target,
          await send(new sdk.ListObjectVersionsCommand(list)),
        );
        const object = await send(new sdk.HeadObjectCommand({ ...exact, ChecksumMode: "ENABLED" }));
        const tagging = await send(new sdk.GetObjectTaggingCommand(exact));
        const retention = await send(new sdk.GetObjectRetentionCommand(exact));
        const after = completionMarkerVersionFromListing(
          target,
          await send(new sdk.ListObjectVersionsCommand(list)),
        );
        if (
          controller.signal.aborted ||
          completionMarkerVersionFingerprint(target, before) !==
            completionMarkerVersionFingerprint(target, after)
        )
          rejected();
        return completionMarkerObservationFromAws({
          target,
          expectedKmsKeyArn,
          object,
          tagging,
          retention,
          version: before,
        });
      } catch {
        return rejected();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        observedExternal?.removeEventListener("abort", abort);
        controller.abort();
        try {
          client?.destroy();
        } catch {
          /* Never retain provider cleanup failures or raw values. */
        }
      }
    },
  });
}
