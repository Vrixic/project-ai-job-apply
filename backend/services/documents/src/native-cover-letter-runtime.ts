import { isMainThread } from "node:worker_threads";
import type { ModelProvider } from "@ai-job-apply/ai-sdk";
import type {
  CoverLetterEvidenceSource,
  CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { createNativeMaterialControls } from "./native-material-controls.js";
import { createNativeMemorySession, type KernelMemoryDeadline } from "./native-memory-session.js";
import {
  createNativeMemoryTransport,
  type NativeMemoryTransportOptions,
} from "./native-memory-transport.js";

export interface NativeCoverLetterRuntimeOptions {
  binding: NativeEvidenceBinding;
  identity: CoverLetterPreparationIdentity;
  source: CoverLetterEvidenceSource;
  provider: ModelProvider;
  controls: Omit<
    Parameters<typeof createNativeMaterialControls>[0],
    "allocation" | "original" | "consentExpiresAt" | "enabled"
  >;
  transport: Omit<NativeMemoryTransportOptions, "session" | "reference" | "enabled" | "tls"> & {
    tls: { key: string | Buffer; cert: string | Buffer };
  };
  /** Trusted bootstrap loads the reviewed module only after original private admission. */
  loadKernel(): KernelMemoryDeadline;
  /** Authenticated owning admission, not local equality or a native self-attestation. */
  checkAdmission(binding: Readonly<NativeEvidenceBinding>): Promise<void>;
  enabled?: () => boolean;
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
}

let started = false;
const unavailable = () => Error("NativeCoverLetterRuntimeUnavailable");

/** Dedicated one-candidate Linux process. Connects original controls, real memory rendering and
 * authenticated HTTPS reads; the trusted launcher owns listening/TLS routing. No SQL, generated
 * persistence, issuing/renewing work, saved draft, task-stop receipt or provider activation.
 * Private source/admission/provider adapters and managed deployment still require approval. */
export async function createNativeCoverLetterRuntime(options: NativeCoverLetterRuntimeOptions) {
  const enabled = options.enabled ?? (() => false);
  if (!enabled() || process.platform !== "linux" || !isMainThread || started) throw unavailable();
  const binding = nativeEvidenceBinding(options.binding);
  const identity = structuredClone(options.identity);
  if (
    identity.id !== binding.scope.generationId ||
    identity.ownerUserId !== binding.scope.ownerUserId ||
    identity.applicationId !== binding.scope.applicationId ||
    !/^[a-f0-9]{64}$/u.test(identity.jobContextHash) ||
    !/^[a-f0-9]{64}$/u.test(identity.confirmedFactsHash) ||
    !(identity.approvedAt instanceof Date) ||
    !(identity.expiresAt instanceof Date) ||
    !Number.isFinite(identity.approvedAt.getTime()) ||
    identity.expiresAt.getTime() !== identity.approvedAt.getTime() + 900_000 ||
    Date.now() < identity.approvedAt.getTime() ||
    Date.now() >= identity.expiresAt.getTime()
  )
    throw unavailable();
  // Consume process admission before the first await; timeout/failed admission never retries.
  started = true;
  const admit = options.checkAdmission;
  const source = options.source;
  const provider = options.provider;
  const loadKernel = options.loadKernel;
  const controlsOptions = {
    ...options.controls,
    ...(options.controls.nativeRpc
      ? {
          nativeRpc: {
            binding,
            ...(options.controls.nativeRpc.testCredentials
              ? { testCredentials: { ...options.controls.nativeRpc.testCredentials } }
              : {}),
          },
        }
      : {}),
  };
  const transportOptions = {
    ...options.transport,
    identity: { ...options.transport.identity },
    tls: {
      key: Buffer.isBuffer(options.transport.tls.key)
        ? Buffer.from(options.transport.tls.key)
        : options.transport.tls.key,
      cert: Buffer.isBuffer(options.transport.tls.cert)
        ? Buffer.from(options.transport.tls.cert)
        : options.transport.tls.cert,
    },
  };
  const limits = {
    ...(options.maximumLifetimeMs === undefined
      ? {}
      : { maximumLifetimeMs: options.maximumLifetimeMs }),
    ...(options.bootBudgetMs === undefined ? {} : { bootBudgetMs: options.bootBudgetMs }),
  };
  let kernel: KernelMemoryDeadline | undefined;
  let session: ReturnType<typeof createNativeMemorySession> | undefined;
  try {
    await admit(binding);
    if (!enabled()) throw unavailable();
    kernel = loadKernel();
    const controls = createNativeMaterialControls({
      ...controlsOptions,
      allocation: binding.allocation,
      original: binding.original,
      consentExpiresAt: identity.expiresAt.toISOString(),
      enabled,
    });
    session = createNativeMemorySession({
      ...limits,
      identity,
      kernel,
      provider,
      ...controls,
      enabled,
      source: {
        async load(ownerUserId, applicationId) {
          if (
            !enabled() ||
            ownerUserId !== identity.ownerUserId ||
            applicationId !== identity.applicationId
          )
            throw unavailable();
          await admit(binding);
          if (!enabled()) throw unavailable();
          const evidence = await source.load(ownerUserId, applicationId);
          await admit(binding);
          if (!enabled()) throw unavailable();
          return evidence;
        },
      },
    });
    const generated = await session.generate();
    if (generated.kind !== "ready" || !enabled()) throw unavailable();
    await admit(binding);
    if (!enabled() || Date.now() >= generated.reference.expiresAtMs) throw unavailable();
    const server = createNativeMemoryTransport({
      ...transportOptions,
      session,
      reference: generated.reference,
      enabled,
    });
    // Only immutable non-content metadata leaves bootstrap. Content is read over authenticated
    // transport; no extra session reader/render capability escapes this composition.
    const terminate = session.terminate;
    return Object.freeze({
      reference: Object.freeze({ ...generated.reference }),
      letter: Object.freeze({
        ...generated.letter,
        sourceFactIds: Object.freeze([...generated.letter.sourceFactIds]),
      }),
      server,
      terminate,
    });
  } catch {
    // Once a kernel/content allocation exists, refusal must retire it. This never acknowledges
    // process death or settles unknown remote provider work.
    if (session) session.terminate();
    if (kernel) kernel.terminate();
    throw unavailable();
  }
}
