import postgres from "postgres";
import { PostgresNativeMaterialReadyStore } from "./native-material-ready-store.js";
import {
  type NativeResumeGenerationOwnerPorts,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

/** Metadata only. Configuration must match the original image's reviewed baseHost.
 * No DNS, TLS, task liveness, content, credentials, launch or renewal capability. */
type LocationOptions = {
  baseHost: string;
  readAllocation(reference: TemporaryMaterialReference): Promise<string | null>;
  enabled?: () => boolean;
};
export function createNativeMaterialLocationReader(options: LocationOptions) {
  return createLocationReader(options, "cover_letter");
}
export function createNativeResumeLocationReader(options: LocationOptions) {
  return createLocationReader(options, "tailored_resume");
}
function createLocationReader(options: LocationOptions, kind: "cover_letter" | "tailored_resume") {
  const baseHost = options.baseHost;
  if (
    typeof baseHost !== "string" ||
    baseHost.length > 200 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(baseHost)
  )
    throw Error("NativeMaterialLocationUnavailable");
  const enabled = options.enabled ?? (() => false);
  const read = options.readAllocation;
  return async (
    reference: TemporaryMaterialReference,
    signal: AbortSignal,
  ): Promise<string | null> => {
    try {
      if (
        !enabled() ||
        signal.aborted ||
        !validateTemporaryMaterialReference(reference) ||
        reference.kind !== kind
      )
        return null;
      const fixed = Object.freeze({ ...reference });
      const available = () => enabled() && !signal.aborted && Date.now() < fixed.expiresAtMs;
      if (!available()) return null;
      const id = await read(fixed);
      if (
        !available() ||
        !id ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id)
      )
        return null;
      return `https://${id}.${baseHost}:8443`;
    } catch {
      throw Error("NativeMaterialLocationUnavailable");
    }
  };
}

/** Separate Documents-owned native Date/JSON pool; never use a Drizzle-mutated shared pool. */
export function createNativeMaterialLocationRuntime(
  url: string,
  baseHost: string,
  enabled: () => boolean,
) {
  // Validate configuration before even allocating the lazy connection pool.
  createNativeMaterialLocationReader({ baseHost, readAllocation: async () => null });
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const ready = new PostgresNativeMaterialReadyStore(sql, enabled);
  return Object.freeze({
    resolve: createNativeMaterialLocationReader({
      baseHost,
      readAllocation: ready.readAllocation.bind(ready),
      enabled,
    }),
    close: () => sql.end(),
  });
}

export function createNativeResumeLocationRuntime(
  url: string,
  baseHost: string,
  ports: NativeResumeGenerationOwnerPorts,
  enabled: () => boolean,
) {
  createNativeResumeLocationReader({ baseHost, readAllocation: async () => null });
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: {
      statement_timeout: 10000,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 15000,
    },
  });
  const store = new PostgresNativeResumeGenerationStore(sql, ports, enabled);
  return Object.freeze({
    resolve: createNativeResumeLocationReader({
      baseHost,
      readAllocation: store.readAllocation.bind(store),
      enabled,
    }),
    close: () => sql.end(),
  });
}
