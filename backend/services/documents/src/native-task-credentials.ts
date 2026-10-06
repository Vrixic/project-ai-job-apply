import { nativeTaskCallerUnavailable } from "./native-task-caller-contract.js";

/** Fixed ECS task credential endpoint only. No shared profiles, web identity, AssumeRole,
 * instance credentials, caller-selected origin, full URI or authorization-token file. */
export function nativeTaskCredentials(options: {
  relativeUri: string | undefined;
  accountId: string;
  enabled: () => boolean;
}) {
  const relative = options.relativeUri;
  const account = options.accountId;
  const enabled = options.enabled;
  const fetcher = globalThis.fetch;
  return async () => {
    if (
      !enabled() ||
      !/^[0-9]{12}$/u.test(account) ||
      typeof relative !== "string" ||
      !/^\/v2\/credentials\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
        relative,
      )
    )
      throw nativeTaskCallerUnavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const chunks: Uint8Array[] = [];
    let bytes: Uint8Array | undefined;
    try {
      const response = await fetcher(`http://169.254.170.2${relative}`, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (
        !enabled() ||
        controller.signal.aborted ||
        response.status !== 200 ||
        response.redirected ||
        !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "")
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
      const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        Object.keys(raw).sort().join(",") !== "AccessKeyId,Expiration,RoleArn,SecretAccessKey,Token"
      )
        throw nativeTaskCallerUnavailable();
      const value = raw as Record<string, unknown>;
      if (
        typeof value.RoleArn !== "string" ||
        !new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]{1,128}$`, "u").test(
          value.RoleArn,
        ) ||
        typeof value.AccessKeyId !== "string" ||
        !/^ASIA[A-Z0-9]{12,124}$/u.test(value.AccessKeyId) ||
        typeof value.SecretAccessKey !== "string" ||
        !/^[A-Za-z0-9/+=]{40}$/u.test(value.SecretAccessKey) ||
        typeof value.Token !== "string" ||
        !/^[\x21-\x7e]{16,8192}$/u.test(value.Token) ||
        typeof value.Expiration !== "string"
      )
        throw nativeTaskCallerUnavailable();
      const expiry = Date.parse(value.Expiration);
      if (
        !enabled() ||
        controller.signal.aborted ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() + 2000
      )
        throw nativeTaskCallerUnavailable();
      return {
        accessKeyId: value.AccessKeyId,
        secretAccessKey: value.SecretAccessKey,
        sessionToken: value.Token,
        expiration: new Date(expiry),
      };
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
    }
  };
}
