import { isMainThread } from "node:worker_threads";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import { createNativeResumeOwnerRpcClient } from "./native-resume-owner-rpc-client.js";
import {
  createNativeResumeRuntime,
  type NativeResumeRuntimeOptions,
} from "./native-resume-runtime.js";
import { createNativeResumeSourceRpcClient } from "./native-resume-source-rpc-client.js";
import { readNativeResumeTaskBinding } from "./native-resume-task-metadata.js";

type Ports = Pick<NativeResumeRuntimeOptions, "transport" | "loadKernel" | "liveTailor">;
type Options = {
  deployment: Parameters<typeof readNativeResumeTaskBinding>[0]["deployment"];
  ownerFunctionArn: string;
  sourceFunctionArn: string;
  environment?: () => Readonly<Record<string, string | undefined>>;
  enabled?: () => boolean;
  /** Image-owned TLS/kernel configuration; never supplied by candidate requests. */
  loadPorts(context: {
    binding: Parameters<typeof createNativeResumeOwnerRpcClient>[0]["binding"];
    identity: NativeResumeRuntimeOptions["bootstrap"];
  }): Promise<Ports>;
  testFetch?: typeof fetch;
  testClient?: Parameters<typeof createNativeResumeOwnerRpcClient>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeResumeOwnerRpcClient>[0]["testCredentials"];
  testStart?: typeof createNativeResumeRuntime;
  maximumLifetimeMs?: number;
  bootBudgetMs?: number;
};
const unavailable = () => Error("NativeTaskBootstrapUnavailable");
let consumed = false;
/** Dedicated process: own ECS metadata -> authenticated original bootstrap -> trusted ports ->
 * actual kernel/content runtime. No candidate evidence is loaded before kernel admission. */
export async function startNativeResumeTask(options: Options) {
  const enabled = options.enabled ?? (() => false);
  let runtime: Awaited<ReturnType<typeof createNativeResumeRuntime>> | undefined;
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
    const sourceTarget = options.sourceFunctionArn;
    nativeLaunchControlVersion(sourceTarget);
    if (sourceTarget === target || sourceTarget.split(":")[4] !== target.split(":")[4])
      throw unavailable();
    nativeLaunchControlVersion(target);
    if (target.split(":")[4] !== deployment.clusterArn.split(":")[4]) throw unavailable();
    const environment = { ...(options.environment ?? (() => process.env))() };
    const loadPorts = options.loadPorts;
    const start = options.testStart ?? createNativeResumeRuntime;
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
    const binding = await readNativeResumeTaskBinding({
      deployment,
      environment,
      enabled,
      ...(options.testFetch ? { testFetch: options.testFetch } : {}),
    });
    const rpcOptions = { binding, targetArn: target, enabled, ...injected };
    const rpc = createNativeResumeOwnerRpcClient(rpcOptions);
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
    if (!enabled()) throw unavailable();
    const source = createNativeResumeSourceRpcClient({
      binding,
      bootstrap: identity,
      targetArn: sourceTarget,
      enabled,
      ...injected,
    });
    runtime = await start({
      ...limits,
      binding,
      bootstrap: identity,
      source,
      loadKernel,
      ...(ports.liveTailor ? { liveTailor: ports.liveTailor } : {}),
      transport,
      controls: {
        checkAdmission: rpc.checkAdmission,
        claimOriginalCompletion: rpc.claimOriginalCompletion,
        publishReady: rpc.publishReady,
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
