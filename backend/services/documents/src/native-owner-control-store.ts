import postgres from "postgres";
import { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { createTemporaryMaterialCompletionHandler } from "./temporary-material-completion-handler.js";
import { PostgresTemporaryMaterialCompletionStore } from "./temporary-material-completion-store.js";

/** Documents owns these SQL clients. Only original scalar controls and candidate lease escape;
 * no object store, document body, issue/renew, renderer/model or maintenance port is created. */
export function createNativeOwnerControlStore(
  url: string,
  targetArn: string,
  enabled: () => boolean,
) {
  const config = {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  } as const;
  const controls = postgres(url, config);
  const lease = postgres(url, config);
  const work = new PostgresCoverLetterWorkStore(controls, enabled);
  const completion = new PostgresTemporaryMaterialCompletionStore(controls, enabled);
  return Object.freeze({
    async checkEvidenceContext(
      raw: Readonly<NativeEvidenceBinding>,
      context: { jobContextHash: string; confirmedFactsHash: string },
    ) {
      if (
        !enabled() ||
        !/^[a-f0-9]{64}$/u.test(context.jobContextHash) ||
        !/^[a-f0-9]{64}$/u.test(context.confirmedFactsHash)
      )
        throw Error("NativeOwnerRpcUnavailable");
      const binding = nativeEvidenceBinding(raw);
      const [row] = await controls`SELECT d.id FROM documents.cover_letters d
        JOIN documents.cover_letter_work_authorizations w ON w.document_id=d.id AND w.user_id=d.user_id
        WHERE d.id=${binding.scope.generationId} AND d.user_id=${binding.scope.ownerUserId}
          AND d.application_id=${binding.scope.applicationId} AND d.status='pending'
          AND d.job_revision=${context.jobContextHash} AND d.confirmed_facts_hash=${context.confirmedFactsHash}
          AND w.id=${binding.original.id} AND w.purpose='provider_dispatch' AND w.request_sha256=${binding.original.requestSha256}
          AND w.consent_expires_at > clock_timestamp()`;
      if (!enabled() || !row) throw Error("NativeOwnerRpcUnavailable");
    },
    work: createCoverLetterProviderControlHandler({
      functionArn: targetArn,
      enabled,
      work: {
        claimProviderDispatch: work.claimProviderDispatch.bind(work),
        settleProviderDispatch: work.settleProviderDispatch.bind(work),
        settleRejectedProviderDispatch: work.settleRejectedProviderDispatch.bind(work),
        settleUndispatchedProviderDispatch: work.settleUndispatchedProviderDispatch.bind(work),
      },
    }),
    completion: createTemporaryMaterialCompletionHandler({
      functionArn: targetArn,
      enabled,
      store: completion,
    }),
    candidateLease: Object.freeze({
      async withGenerationLease<T>(ownerUserId: string, run: () => Promise<T>): Promise<T> {
        if (!enabled()) throw Error("NativeOwnerRpcUnavailable");
        return lease.begin(async (tx) => {
          await tx`SELECT identity.require_active_candidate(${ownerUserId}::uuid)`;
          if (!enabled()) throw Error("NativeOwnerRpcUnavailable");
          const result = await run();
          if (!enabled()) throw Error("NativeOwnerRpcUnavailable");
          return result;
        }) as Promise<T>;
      },
    }),
    close: async () => {
      await Promise.all([controls.end(), lease.end()]);
    },
  });
}
