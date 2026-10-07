import { SaxesParser } from "saxes";
import type { NativeTaskAllocation } from "./native-task-allocation.js";
import {
  NATIVE_CALLER_STS_BODY,
  NATIVE_CALLER_STS_ORIGIN,
  nativeTaskCallerUnavailable,
  validateNativeTaskCallerProof,
} from "./native-task-caller-contract.js";

function callerIdentity(bytes: Uint8Array) {
  const fields: Record<string, string> = {};
  const path: string[] = [];
  const seen = new Set<string>();
  const leaves = [
    "GetCallerIdentityResponse/GetCallerIdentityResult/Arn",
    "GetCallerIdentityResponse/GetCallerIdentityResult/Account",
    "GetCallerIdentityResponse/GetCallerIdentityResult/UserId",
    "GetCallerIdentityResponse/ResponseMetadata/RequestId",
  ];
  const containers = [
    "GetCallerIdentityResponse",
    "GetCallerIdentityResponse/GetCallerIdentityResult",
    "GetCallerIdentityResponse/ResponseMetadata",
  ];
  let current = "";
  let roots = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => {
    throw nativeTaskCallerUnavailable();
  });
  parser.on("processinginstruction", () => {
    throw nativeTaskCallerUnavailable();
  });
  parser.on("error", () => {
    throw nativeTaskCallerUnavailable();
  });
  parser.on("opentag", (tag) => {
    path.push(tag.local);
    const key = path.join("/");
    if (seen.has(key)) throw nativeTaskCallerUnavailable();
    seen.add(key);
    if (
      tag.prefix ||
      tag.uri !== "https://sts.amazonaws.com/doc/2011-06-15/" ||
      (!leaves.includes(key) && !containers.includes(key))
    )
      throw nativeTaskCallerUnavailable();
    if (path.length === 1) {
      roots++;
      if (roots !== 1 || Object.keys(tag.attributes).join(",") !== "xmlns")
        throw nativeTaskCallerUnavailable();
    } else if (Object.keys(tag.attributes).length !== 0) throw nativeTaskCallerUnavailable();
    if (leaves.includes(key) && Object.hasOwn(fields, key)) throw nativeTaskCallerUnavailable();
    current = "";
  });
  const text = (value: string) => {
    if (leaves.includes(path.join("/"))) current += value;
    else if (value.trim()) throw nativeTaskCallerUnavailable();
  };
  parser.on("text", text);
  parser.on("cdata", () => {
    throw nativeTaskCallerUnavailable();
  });
  parser.on("closetag", () => {
    const key = path.join("/");
    if (leaves.includes(key)) fields[key] = current;
    path.pop();
    current = "";
  });
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
  if (roots !== 1 || path.length || leaves.some((key) => !fields[key]))
    throw nativeTaskCallerUnavailable();
  const arn = fields["GetCallerIdentityResponse/GetCallerIdentityResult/Arn"];
  const account = fields["GetCallerIdentityResponse/GetCallerIdentityResult/Account"];
  const userId = fields["GetCallerIdentityResponse/GetCallerIdentityResult/UserId"];
  if (!arn || !account || !userId) throw nativeTaskCallerUnavailable();
  return { arn, account, userId };
}

/** AWS authenticates the signed fixed GetCallerIdentity request. Compare its account, exact
 * reviewed role and original ECS task session before any owning admission/evidence operation.
 * The proof is not task liveness, work settlement, death/purge evidence or consent renewal.
 * Managed role trust must prohibit non-ECS assumption/arbitrary task-named sessions. */
export function createScopedNativeTaskCallerVerifier(options: {
  scope: { allocation: Readonly<NativeTaskAllocation>; digest(requestSha256: string): string };
  taskRoleArn: string;
  enabled?: () => boolean;
  timeoutMs?: number;
  testFetch?: typeof fetch;
}) {
  const scope = options.scope;
  if (typeof options.taskRoleArn !== "string") throw nativeTaskCallerUnavailable();
  const account = scope.allocation.clusterArn.split(":")[4];
  const role = new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]{1,128}$`, "u").exec(
    options.taskRoleArn,
  );
  const roleName = options.taskRoleArn.split("/").at(-1);
  if (!role || !roleName || !/^[A-Za-z0-9_+=,.@-]{1,64}$/u.test(roleName))
    throw nativeTaskCallerUnavailable();
  const taskId = scope.allocation.taskArn.split("/").at(-1);
  const expectedArn = `arn:aws:sts::${account}:assumed-role/${roleName}/${taskId}`;
  const expectedUserId = new RegExp(`^AROA[A-Z0-9]{12,28}:${taskId}$`, "u");
  const enabled = options.enabled ?? (() => false);
  const timeout = options.timeoutMs ?? 3000;
  const injected = options.testFetch;
  const fetcher = injected ?? globalThis.fetch;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000)
    throw nativeTaskCallerUnavailable();
  let active = false;
  return Object.freeze({
    async verify(raw: unknown, requestSha256: string): Promise<void> {
      if (active || !enabled() || (injected && process.env.NODE_ENV !== "test"))
        throw nativeTaskCallerUnavailable();
      const context = scope.digest(requestSha256);
      if (!validateNativeTaskCallerProof(raw, context, Date.now()))
        throw nativeTaskCallerUnavailable();
      const proof = structuredClone(raw);
      active = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const chunks: Uint8Array[] = [];
      let bytes: Uint8Array | undefined;
      try {
        const response = await fetcher(`${NATIVE_CALLER_STS_ORIGIN}/`, {
          method: "POST",
          headers: proof.headers,
          body: NATIVE_CALLER_STS_BODY,
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          !enabled() ||
          controller.signal.aborted ||
          response.status !== 200 ||
          response.redirected ||
          !/^(?:text|application)\/xml(?:;|$)/iu.test(response.headers.get("content-type") ?? "")
        )
          throw nativeTaskCallerUnavailable();
        reader = response.body?.getReader();
        if (!reader) throw nativeTaskCallerUnavailable();
        let size = 0;
        while (true) {
          const next = await reader.read();
          if (next.value) chunks.push(next.value);
          if (!enabled() || controller.signal.aborted) throw nativeTaskCallerUnavailable();
          if (next.done) break;
          if (!next.value) throw nativeTaskCallerUnavailable();
          size += next.value.byteLength;
          if (size > 8192) throw nativeTaskCallerUnavailable();
        }
        bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const caller = callerIdentity(bytes);
        if (
          !enabled() ||
          controller.signal.aborted ||
          !validateNativeTaskCallerProof(proof, context, Date.now()) ||
          caller.account !== account ||
          caller.arn !== expectedArn ||
          !expectedUserId.test(caller.userId)
        )
          throw nativeTaskCallerUnavailable();
      } catch {
        throw nativeTaskCallerUnavailable();
      } finally {
        clearTimeout(timer);
        if (reader) {
          try {
            await reader.cancel();
          } catch {
          } finally {
            reader.releaseLock();
          }
        }
        bytes?.fill(0);
        for (const chunk of chunks) chunk.fill(0);
        // Clear owned credential-bearing headers after the real request/read settles.
        for (const key of Object.keys(proof.headers)) proof.headers[key] = "";
        active = false;
      }
    },
  });
}
