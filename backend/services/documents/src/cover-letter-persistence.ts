import postgres from "postgres";
import { type CoverLetterObjectStore, PostgresCoverLetterStore } from "./cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import { PostgresNativeMaterialReadyStore } from "./native-material-ready-store.js";
import { PostgresNativeMaterialRegistry } from "./native-material-registry.js";

/** Documents-owned native Date/JSON clients. A lease never shares a one-connection query pool. */
export function createCoverLetterPersistence(
  url: string,
  objects: CoverLetterObjectStore,
  enabled: () => boolean = () => false,
) {
  const pool = () =>
    postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
  const documentsPool = pool();
  const workPool = pool();
  const leasePool = pool();
  const work = new PostgresCoverLetterWorkStore(workPool, enabled);
  const documents = new PostgresCoverLetterStore(
    documentsPool,
    objects,
    Object.freeze({
      claimFinalDocument: work.claimFinalDocument.bind(work),
      recordSettled: async (reference) => {
        if (reference.purpose !== "final_document")
          throw new Error("CoverLetterPersistenceUnavailable");
        return work.recordSettled(structuredClone(reference));
      },
    }),
  );
  const lease = new PostgresCoverLetterStore(leasePool, objects);
  return {
    documents,
    work,
    candidateLease: Object.freeze({ withGenerationLease: lease.withGenerationLease.bind(lease) }),
    close: async () => {
      await Promise.all([documentsPool.end(), workPool.end(), leasePool.end()]);
    },
  };
}

/** Native preparation owns only scalar reservation/issue/receipt/prior-epoch operations.
 * Its lease uses a distinct connection; generated object reads/writes cannot be supplied. */
export function createNativeCoverLetterPersistence(
  url: string,
  enabled: () => boolean = () => false,
) {
  const pool = () =>
    postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });
  const documentsPool = pool(),
    workPool = pool(),
    leasePool = pool();
  const deniedObjects: CoverLetterObjectStore = {
    putIfAbsent: async () => {
      throw Error("NativePreparationObjectUnavailable");
    },
    read: async () => {
      throw Error("NativePreparationObjectUnavailable");
    },
  };
  const documents = new PostgresCoverLetterStore(documentsPool, deniedObjects);
  const lease = new PostgresCoverLetterStore(leasePool, deniedObjects);
  const work = new PostgresCoverLetterWorkStore(workPool, enabled);
  const ready = new PostgresNativeMaterialReadyStore(documentsPool, enabled);
  const admission = new PostgresNativeMaterialRegistry(documentsPool, enabled);
  return Object.freeze({
    documents: Object.freeze({ reserveGeneration: documents.reserveGeneration.bind(documents) }),
    candidateLease: Object.freeze({ withGenerationLease: lease.withGenerationLease.bind(lease) }),
    work: Object.freeze({
      issue: async (input: Parameters<PostgresCoverLetterWorkStore["issue"]>[0]) => {
        if (input.purpose !== "provider_dispatch") throw Error("NativePreparationWorkUnavailable");
        return work.issue(structuredClone(input));
      },
    }),
    ready: Object.freeze({ read: ready.read.bind(ready) }),
    admission: Object.freeze({ readPreviousEpoch: admission.readPreviousEpoch.bind(admission) }),
    close: async () => {
      await Promise.all([documentsPool.end(), workPool.end(), leasePool.end()]);
    },
  });
}
