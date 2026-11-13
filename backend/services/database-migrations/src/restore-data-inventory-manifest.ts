import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  loadCurrentRestoreManifest,
  parseRestoreManifest,
  type RestoreManifestSource,
} from "./restore-verifier.js";

/** Structural operator input only; task/snapshot provenance requires separate operator review. */
export function resolveRestoreDataManifest(environment: NodeJS.ProcessEnv): RestoreManifestSource {
  const compressed = environment.RESTORE_DATA_MANIFEST_GZIP_BASE64;
  const expected = environment.RESTORE_DATA_MANIFEST_SHA256;
  if (compressed === undefined && expected === undefined) return loadCurrentRestoreManifest();
  try {
    if (!compressed || compressed.length > 7_700 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compressed))
      throw new Error();
    const bytes = Buffer.from(compressed, "base64");
    if (bytes.toString("base64") !== compressed) throw new Error();
    const expanded = gunzipSync(bytes, { maxOutputLength: 65_536 });
    if (
      !expected ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      createHash("sha256").update(expanded).digest("hex") !== expected
    ) {
      throw new Error();
    }
    return {
      manifest: parseRestoreManifest(JSON.parse(expanded.toString("utf8")) as unknown),
      sha256: expected,
    };
  } catch {
    throw new Error("Restore data manifest input is invalid");
  }
}
