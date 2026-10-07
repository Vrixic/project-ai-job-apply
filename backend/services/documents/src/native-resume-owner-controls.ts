import postgres from "postgres";
import {
  type NativeResumeGenerationOwnerPorts,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import { nativeResumeOwnerUnavailable } from "./native-resume-owner-rpc-contract.js";
import type { NativeResumeOwnerRpcOwners } from "./native-resume-owner-rpc-handler.js";
import { nativeResumeTaskBinding } from "./native-resume-task-binding.js";

/** No issue, reserve, launch, cancellation or retirement operation escapes to a task. */
export function createNativeResumeOwnerControls(
  store: Pick<
    PostgresNativeResumeGenerationStore,
    "checkTaskAdmission" | "readLaunch" | "claimOriginalCompletion" | "publishReady"
  >,
  enabled: () => boolean = () => false,
): NativeResumeOwnerRpcOwners {
  const check = store.checkTaskAdmission.bind(store),
    read = store.readLaunch.bind(store),
    complete = store.claimOriginalCompletion.bind(store),
    ready = store.publishReady.bind(store);
  const capture: typeof nativeResumeTaskBinding = (raw) => {
    if (!enabled()) throw nativeResumeOwnerUnavailable();
    return nativeResumeTaskBinding(raw);
  };
  return Object.freeze({
    async checkAdmission(raw) {
      const b = capture(raw);
      await check(b.scope, b.allocation, b.configurationSha256);
      if (!enabled()) throw nativeResumeOwnerUnavailable();
    },
    async bootstrap(raw) {
      const b = capture(raw);
      await check(b.scope, b.allocation, b.configurationSha256);
      const record = await read(b.scope, b.configurationSha256);
      if (!enabled() || record.state !== "bound" || record.ready || record.reference !== null)
        throw nativeResumeOwnerUnavailable();
      await check(b.scope, b.allocation, b.configurationSha256);
      if (!enabled()) throw nativeResumeOwnerUnavailable();
      return {
        identity: { ...record.reservation.identity },
        normalizedSha256: record.reservation.normalizedSha256,
        canonicalJobId: record.reservation.application.canonicalJobId,
      };
    },
    async claimOriginalCompletion(raw, material) {
      const b = capture(raw);
      return complete(b.scope, material);
    },
    async publishReady(raw, material) {
      const b = capture(raw);
      await ready(b.scope, material);
      if (!enabled()) throw nativeResumeOwnerUnavailable();
    },
  } satisfies NativeResumeOwnerRpcOwners);
}

/** Documents-owned bounded scalar pool. Owning Applications/Jobs ports execute on its transaction. */
export function createNativeResumeOwnerControlStore(
  url: string,
  ports: NativeResumeGenerationOwnerPorts,
  enabled: () => boolean,
) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: {
      statement_timeout: 10000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 10000,
    },
  });
  const controls = createNativeResumeOwnerControls(
    new PostgresNativeResumeGenerationStore(sql, ports, enabled),
    enabled,
  );
  return Object.freeze({ ...controls, close: () => sql.end() });
}
