import postgres from "postgres";
import {
  type NativeResumeGenerationOwnerPorts,
  type NativeResumeOwnerQuery,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import { createNativeResumeOwnerControls } from "./native-resume-owner-controls.js";
import { createNativeResumeSource, nativeResumeSourceUnavailable } from "./native-resume-source.js";
import type { NormalizedDocumentReader } from "./normalized-document-reader.js";
import { PostgresParsedResumeSource } from "./parsed-resume-source.js";
import type { SourceDocumentReader } from "./source-document-reader.js";

/** Documents owns both pools. Only the candidate lease spans retained object I/O; normal owner
 * admission and Jobs source transactions have ended before the S3 read starts. */
export function createNativeResumeSourceStore(options: {
  url: string;
  ports: NativeResumeGenerationOwnerPorts;
  job(
    scope: { canonicalJobId: string; jobRevision: string; jobContextSha256: string },
    query: NativeResumeOwnerQuery,
  ): Promise<{ title: string; description: string }>;
  reader: NormalizedDocumentReader;
  /** Reads the candidate's own PDF so the generated resume can keep its design. */
  original?: SourceDocumentReader;
  enabled: () => boolean;
}) {
  const enabled = options.enabled,
    job = options.job;
  const config = {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: {
      statement_timeout: 10000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 15000,
    },
  } as const;
  const controls = postgres(options.url, config),
    lease = postgres(options.url, config);
  const store = new PostgresNativeResumeGenerationStore(controls, options.ports, enabled);
  const checkAdmission = createNativeResumeOwnerControls(store, enabled).checkAdmission;
  const source = createNativeResumeSource({
    store,
    parsed: new PostgresParsedResumeSource(controls),
    reader: options.reader,
    ...(options.original ? { original: options.original } : {}),
    job: (scope) =>
      controls.begin((tx) => job(scope, tx as unknown as NativeResumeOwnerQuery)) as Promise<{
        title: string;
        description: string;
      }>,
    candidateLease: {
      async withGenerationLease<T>(owner: string, run: () => Promise<T>): Promise<T> {
        if (!enabled()) throw nativeResumeSourceUnavailable();
        return lease.begin(async (tx) => {
          await tx`SELECT identity.require_active_candidate(${owner}::uuid)`;
          if (!enabled()) throw nativeResumeSourceUnavailable();
          const result = await run();
          if (!enabled()) throw nativeResumeSourceUnavailable();
          return result;
        }) as Promise<T>;
      },
    },
    enabled,
  });
  return Object.freeze({
    ...source,
    checkAdmission,
    close: async () => {
      await Promise.all([controls.end(), lease.end()]);
    },
  });
}
