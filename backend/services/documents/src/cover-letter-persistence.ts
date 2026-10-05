import postgres from "postgres";
import { type CoverLetterObjectStore, PostgresCoverLetterStore } from "./cover-letter-store.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

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
