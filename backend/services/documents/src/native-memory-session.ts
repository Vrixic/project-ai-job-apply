import type { ModelProvider } from "@ai-job-apply/ai-sdk";
import { ModelGateway } from "@ai-job-apply/ai-sdk/gateway";
import type {
  CoverLetterEvidenceSource,
  CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import { claimNativeMaterialProcess } from "./native-material-process.js";
import { OriginalCoverLetterGenerationActor } from "./original-cover-letter-generation.js";
import { TemporaryCoverLetterService } from "./temporary-cover-letter.js";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialCompletionAuthority,
  TemporaryMaterialStore,
} from "./temporary-materials.js";

/** Dedicated Linux content process only. The native module arms a kernel boot deadline on
 * load, disables core dumps/dumpability and permits only one completion binding. Never load it
 * into a shared API/worker process, Lambda, a browser, or a multi-candidate session. */
export interface KernelMemoryDeadline {
  shortenBoot(milliseconds: number): void;
  bindCompletion(completedAtMs: number, maximumLifetimeMs: number): void;
  terminate(): never;
}

export interface NativeMemorySessionOptions {
  documentVersion: number;
  identity: CoverLetterPreparationIdentity;
  source: CoverLetterEvidenceSource;
  provider: ModelProvider;
  work: ConstructorParameters<typeof OriginalCoverLetterGenerationActor>[2];
  completion: TemporaryMaterialCompletionAuthority;
  kernel: KernelMemoryDeadline;
  enabled?: () => boolean;
  /** Only lower native process limits; public material metadata keeps its original max expiry. */
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
  /** Private test/render adapter; production defaults to actual PDF/DOCX verification. */
  render?: ConstructorParameters<typeof TemporaryCoverLetterService>[5];
}

/** One native allocation and one immutable candidate/application/generation. No auth bypass,
 * issuer, database/object capability, listener, durable content or task-stop certificate.
 * Private authenticated transport/launcher must bind this allocation before activation. */
export function createNativeMemorySession(options: NativeMemorySessionOptions) {
  const enabled = options.enabled ?? (() => false);
  if (!enabled()) throw Error("NativeMemorySessionUnavailable");
  const lifetime = options.maximumLifetimeMs ?? GENERATED_MATERIAL_LIFETIME_MS;
  const documentVersion = options.documentVersion;
  const bootBudget = options.bootBudgetMs ?? 50_000;
  if (
    !Number.isSafeInteger(documentVersion) ||
    documentVersion < 1 ||
    documentVersion > 2_147_483_647 ||
    !Number.isSafeInteger(lifetime) ||
    lifetime < 1 ||
    lifetime > GENERATED_MATERIAL_LIFETIME_MS ||
    !Number.isSafeInteger(bootBudget) ||
    bootBudget < 1 ||
    bootBudget > 50_000
  )
    throw Error("NativeMemorySessionUnavailable");
  claimNativeMaterialProcess();
  // The boot deadline is already armed by native module initialization. This can only shorten it.
  options.kernel.shortenBoot(bootBudget);
  const identity = structuredClone(options.identity);
  const memory = new TemporaryMaterialStore();
  const temporary = new TemporaryCoverLetterService(
    memory,
    options.source,
    options.completion,
    enabled,
    () => new Date(),
    options.render,
  );
  const gateway = new ModelGateway(options.provider, {
    enabled,
    originalCompletionObserver: (completedAtMs) =>
      options.kernel.bindCompletion(completedAtMs, lifetime),
  });
  const actor = new OriginalCoverLetterGenerationActor(
    options.source,
    gateway,
    options.work,
    temporary,
    enabled,
    () => new Date(),
    documentVersion,
  );
  const reader = temporary.reader();
  const scoped = (owner: string, application: string) => {
    if (owner !== identity.ownerUserId || application !== identity.applicationId)
      throw Error("NativeMemorySessionUnavailable");
  };
  return Object.freeze({
    /** Fixed original identity only; no caller can replace it or start another generation. */
    generate: (signal?: AbortSignal) => actor.generate(identity, signal),
    reader: Object.freeze({
      current: (...args: Parameters<typeof reader.current>) => {
        scoped(args[0], args[1]);
        return reader.current(...args);
      },
      coverLetterPreview: (...args: Parameters<typeof reader.coverLetterPreview>) => {
        scoped(args[0], args[1]);
        return reader.coverLetterPreview(...args);
      },
      coverLetterFile: (...args: Parameters<typeof reader.coverLetterFile>) => {
        scoped(args[0], args[1]);
        return reader.coverLetterFile(...args);
      },
      discardApplication: async (
        ...args: Parameters<typeof reader.discardApplication>
      ): Promise<never> => {
        scoped(args[0], args[1]);
        // A material-process reply cannot certify its own death. The private task/process
        // observer must positively observe retirement before returning an owning cleanup ack.
        try {
          await reader.discardApplication(...args);
        } finally {
          options.kernel.terminate();
        }
      },
    }),
    /** Request local process retirement. It never returns an acknowledgement; the separate
     * trusted task/process observer must positively observe termination. Remote work is unchanged. */
    terminate: () => {
      memory.dispose();
      options.kernel.terminate();
    },
  });
}
