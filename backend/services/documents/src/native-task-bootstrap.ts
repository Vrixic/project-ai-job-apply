import { isMainThread } from "node:worker_threads";
import {
  createNativeCoverLetterRuntime,
  type NativeCoverLetterRuntimeOptions,
} from "./native-cover-letter-runtime.js";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import { createNativeOwnerEvidenceClient } from "./native-owner-evidence-client.js";
import { createNativeOwnerRpcClient } from "./native-owner-rpc-client.js";
import { readNativeTaskBinding } from "./native-task-metadata.js";

type Ports = Pick<NativeCoverLetterRuntimeOptions, "provider" | "transport" | "loadKernel">;
type Options = {
  deployment: Parameters<typeof readNativeTaskBinding>[0]["deployment"];
  ownerFunctionArn: string;
  environment?: () => Readonly<Record<string, string | undefined>>;
  enabled?: () => boolean;
  /** Image-owned provider/TLS/kernel configuration; never supplied by candidate requests. */
  loadPorts(context: {
    binding: Parameters<typeof createNativeOwnerRpcClient>[0]["binding"];
    identity: NativeCoverLetterRuntimeOptions["identity"];
  }): Promise<Ports>;
  testFetch?: typeof fetch;
  testClient?: Parameters<typeof createNativeOwnerRpcClient>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeOwnerRpcClient>[0]["testCredentials"];
  testStart?: typeof createNativeCoverLetterRuntime;
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
};
const unavailable = () => Error("NativeTaskBootstrapUnavailable");
let consumed = false;
/** Dedicated process: own ECS metadata -> authenticated original approval -> trusted ports ->
 * actual kernel/content runtime. No candidate evidence is loaded before kernel admission. */
export async function startNativeMaterialTask(options: Options) {
  const enabled = options.enabled ?? (() => false);
  let runtime: Awaited<ReturnType<typeof createNativeCoverLetterRuntime>> | undefined;
  try {
    if (
      !enabled() ||
      process.platform !== "linux" ||
      process.arch !== "x64" ||
      process.versions.node.split(".")[0] !== "24" ||
      !isMainThread ||
      consumed ||
      ((options.testFetch || options.testClient || options.testCredentials || options.testStart) &&
        process.env.NODE_ENV !== "test")
    )
      throw unavailable();
    consumed = true;
    const deployment = { ...options.deployment };
    const target = options.ownerFunctionArn;
    nativeLaunchControlVersion(target);
    if (target.split(":")[4] !== deployment.clusterArn.split(":")[4]) throw unavailable();
    const environment = { ...(options.environment ?? (() => process.env))() };
    const loadPorts = options.loadPorts;
    const start = options.testStart ?? createNativeCoverLetterRuntime;
    const injected = {
      ...(options.testClient ? { testClient: options.testClient } : {}),
      ...(options.testCredentials ? { testCredentials: { ...options.testCredentials } } : {}),
    };
    const limits = {
      ...(options.maximumLifetimeMs === undefined
        ? {}
        : { maximumLifetimeMs: options.maximumLifetimeMs }),
      ...(options.bootBudgetMs === undefined ? {} : { bootBudgetMs: options.bootBudgetMs }),
    };
    const binding = await readNativeTaskBinding({
      deployment,
      environment,
      enabled,
      ...(options.testFetch ? { testFetch: options.testFetch } : {}),
    });
    const rpcOptions = { binding, targetArn: target, enabled, ...injected };
    const rpc = createNativeOwnerRpcClient(rpcOptions);
    // The task can start before the launcher stores RunTask's ARN. Bounded read-only admission
    // observations wait for that original bind; they cannot claim, issue or renew work.
    const deadline = Date.now() + 20_000;
    while (true) {
      if (!enabled() || Date.now() >= deadline) throw unavailable();
      try {
        await rpc.checkAdmission(binding);
        break;
      } catch {
        if (!enabled() || Date.now() >= deadline) throw unavailable();
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!enabled() || Date.now() >= deadline) throw unavailable();
    const identity = await rpc.bootstrap();
    if (!enabled()) throw unavailable();
    const ports = await loadPorts({ binding, identity: structuredClone(identity) });
    const provider = ports.provider;
    const loadKernel = ports.loadKernel;
    const transport = {
      ...ports.transport,
      identity: { ...ports.transport.identity },
      tls: {
        key: Buffer.isBuffer(ports.transport.tls.key)
          ? Buffer.from(ports.transport.tls.key)
          : ports.transport.tls.key,
        cert: Buffer.isBuffer(ports.transport.tls.cert)
          ? Buffer.from(ports.transport.tls.cert)
          : ports.transport.tls.cert,
      },
    };
    await rpc.checkAdmission(binding);
    if (!enabled() || Date.now() >= identity.expiresAt.getTime()) throw unavailable();
    const evidence = createNativeOwnerEvidenceClient({ ...rpcOptions, context: identity });
    runtime = await start({
      ...limits,
      binding,
      identity,
      source: evidence.source,
      provider,
      loadKernel,
      transport,
      checkAdmission: rpc.checkAdmission,
      controls: {
        workFunctionArn: target,
        completionFunctionArn: target,
        ...(injected.testClient ? { testClient: injected.testClient } : {}),
        nativeRpc: {
          binding,
          ...(injected.testCredentials ? { testCredentials: injected.testCredentials } : {}),
        },
      },
      enabled,
    });
    if (!enabled()) {
      runtime.terminate();
      throw unavailable();
    }
    return runtime;
  } catch {
    throw unavailable();
  }
}
