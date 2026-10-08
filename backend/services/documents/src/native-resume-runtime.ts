import { isMainThread } from "node:worker_threads";
import type { KernelMemoryDeadline } from "./native-memory-session.js";
import { nativeOwnerJson } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeBootstrap,
  validateNativeResumeBootstrap,
} from "./native-resume-owner-rpc-contract.js";
import {
  createNativeResumeSession,
  type NativeResumeSessionOptions,
} from "./native-resume-session.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import {
  createNativeResumeTransport,
  type NativeResumeTransportOptions,
} from "./native-resume-transport.js";
import type { TemporaryMaterialReference } from "./temporary-material-reference.js";

export interface NativeResumeRuntimeOptions {
  binding: NativeResumeTaskBinding;
  bootstrap: NativeResumeBootstrap;
  source: NativeResumeSessionOptions["source"];
  controls: {
    checkAdmission(binding: Readonly<NativeResumeTaskBinding>): Promise<void>;
    claimOriginalCompletion: NativeResumeSessionOptions["completion"]["claimOriginalCompletion"];
    publishReady(reference: Readonly<TemporaryMaterialReference>): Promise<void>;
  };
  transport: Omit<
    NativeResumeTransportOptions,
    "session" | "reference" | "tailoringVersion" | "enabled" | "tls"
  > & { tls: { key: string | Buffer; cert: string | Buffer } };
  loadKernel(): KernelMemoryDeadline;
  enabled?: () => boolean;
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
}
let started = false;
const unavailable = () => Error("NativeResumeRuntimeUnavailable");
/** One original resume per dedicated process. Authenticated owner/source ports are injected by
 * trusted bootstrap. The kernel is armed before retained candidate source is admitted. */
export async function createNativeResumeRuntime(options: NativeResumeRuntimeOptions) {
  const enabled = options.enabled ?? (() => false);
  if (!enabled() || process.platform !== "linux" || !isMainThread || started) throw unavailable();
  const binding = nativeResumeTaskBinding(options.binding);
  if (!validateNativeResumeBootstrap(options.bootstrap, binding)) throw unavailable();
  const bootstrap: NativeResumeBootstrap = JSON.parse(nativeOwnerJson(options.bootstrap));
  const admit = options.controls.checkAdmission.bind(options.controls),
    complete = options.controls.claimOriginalCompletion.bind(options.controls),
    ready = options.controls.publishReady.bind(options.controls),
    load = options.source.load.bind(options.source),
    loadKernel = options.loadKernel;
  const transport = {
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
  const authorize = transport.authorize;
  const limits = {
    ...(options.maximumLifetimeMs === undefined
      ? {}
      : { maximumLifetimeMs: options.maximumLifetimeMs }),
    ...(options.bootBudgetMs === undefined ? {} : { bootBudgetMs: options.bootBudgetMs }),
  };
  started = true;
  let kernel: KernelMemoryDeadline | undefined,
    session: ReturnType<typeof createNativeResumeSession> | undefined;
  const check = async () => {
    if (!enabled()) throw unavailable();
    await admit(binding);
    if (!enabled()) throw unavailable();
  };
  try {
    await check();
    kernel = loadKernel();
    session = createNativeResumeSession({
      identity: bootstrap.identity,
      source: { load },
      completion: { claimOriginalCompletion: complete },
      checkAdmission: check,
      kernel,
      enabled,
      ...limits,
    });
    const generated = await session.generate();
    await check();
    await ready(generated.reference);
    await check();
    if (Date.now() >= generated.reference.expiresAtMs) throw unavailable();
    const server = createNativeResumeTransport({
      ...transport,
      session,
      reference: generated.reference,
      tailoringVersion: generated.tailoringVersion,
      enabled,
      authorize: async (owner, application, reference, signal, token) => {
        if (signal.aborted) throw unavailable();
        await check();
        const proof = await authorize(owner, application, reference, signal, token);
        await check();
        if (signal.aborted) throw unavailable();
        return proof;
      },
    });
    return Object.freeze({
      reference: Object.freeze({ ...generated.reference }),
      baseDocumentId: generated.baseDocumentId,
      baseVersion: generated.baseVersion,
      tailoringVersion: generated.tailoringVersion,
      server,
      terminate: session.terminate,
    });
  } catch {
    if (session) session.terminate();
    if (kernel) kernel.terminate();
    throw unavailable();
  }
}
