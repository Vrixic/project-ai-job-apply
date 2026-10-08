import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import type { NativeMemoryTransportOptions } from "./native-memory-transport.js";
import {
  sameTemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

const validProof = compileComponentValidator("ApplicationTemporaryMaterialAuthorization");
const wireLimit = 4096;

/** Normal authenticated Gateway metadata only. No generated body, token persistence, SQL,
 * model, grant issuance, request retries or lifetime renewal. Trust the configured HTTPS origin,
 * never an address received in a candidate request or authorization response. */
type Options = {
  apiOrigin: string;
  enabled?: () => boolean;
  fetch?: typeof fetch;
};
export function createNativeReadAuthorizationClient(
  options: Options,
): NativeMemoryTransportOptions["authorize"] {
  return createClient(options, "cover_letter", "cover-letter");
}
export function createNativeResumeReadAuthorizationClient(
  options: Options,
): NativeMemoryTransportOptions["authorize"] {
  return createClient(options, "tailored_resume", "resume");
}
function createClient(
  options: Options,
  kind: "cover_letter" | "tailored_resume",
  route: "cover-letter" | "resume",
): NativeMemoryTransportOptions["authorize"] {
  const enabled = options.enabled ?? (() => false);
  let origin: URL;
  try {
    origin = new URL(options.apiOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== options.apiOrigin ||
      origin.username ||
      origin.password
    )
      throw Error();
  } catch {
    throw Error("NativeReadAuthorizationUnavailable");
  }
  const apiOrigin = origin.origin;
  const fetcher = options.fetch ?? globalThis.fetch;
  return async (ownerUserId, applicationId, reference, signal, accessToken) => {
    let bytes: Uint8Array | undefined;
    const chunks: Uint8Array[] = [];
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (
        !enabled() ||
        signal.aborted ||
        !validateTemporaryMaterialReference(reference) ||
        reference.kind !== kind ||
        reference.ownerUserId !== ownerUserId ||
        reference.applicationId !== applicationId ||
        Date.now() >= reference.expiresAtMs ||
        typeof accessToken !== "string" ||
        accessToken.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(accessToken)
      )
        throw Error();
      const fixed = Object.freeze({ ...reference });
      const response = await fetcher(
        `${apiOrigin}/v1/applications/${applicationId}/${route}/authorization?generationId=${fixed.generationId}`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          signal,
        },
      );
      reader = response.body?.getReader();
      if (response.status === 409 && reader) {
        await reader.cancel();
        reader.releaseLock();
        reader = undefined;
        if (signal.aborted || !enabled()) throw Error();
        return null;
      }
      if (
        !enabled() ||
        signal.aborted ||
        response.status !== 200 ||
        response.headers.get("cache-control") !== "no-store" ||
        !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "") ||
        !reader
      )
        throw Error();
      let size = 0;
      while (true) {
        // Await the actual read. Abort is not proof that the underlying port settled.
        const next = await reader.read();
        if (next.value) chunks.push(next.value);
        if (signal.aborted || !enabled()) throw Error();
        if (next.done) break;
        if (!next.value) throw Error();
        size += next.value.byteLength;
        if (size > wireLimit) throw Error();
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!validProof(value)) throw Error();
      const proof =
        value as import("@ai-job-apply/api-contracts").ApplicationTemporaryMaterialAuthorization;
      const material = { ...proof.temporaryMaterial, ownerUserId, applicationId };
      if (
        !validateTemporaryMaterialReference(material) ||
        !sameTemporaryMaterialReference(fixed, material)
      )
        throw Error();
      await reader.cancel();
      reader.releaseLock();
      reader = undefined;
      if (signal.aborted || !enabled() || Date.now() >= fixed.expiresAtMs) throw Error();
      return {
        schemaVersion: 1,
        packetId: proof.packetId,
        packetHash: proof.packetHash,
        reference: material,
      };
    } catch {
      throw Error("NativeReadAuthorizationUnavailable");
    } finally {
      bytes?.fill(0);
      for (const chunk of chunks) chunk.fill(0);
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* No positive authorization follows a failed read. */
        }
        reader.releaseLock();
      }
    }
  };
}
