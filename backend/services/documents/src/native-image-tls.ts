import { createPrivateKey, createPublicKey, timingSafeEqual, X509Certificate } from "node:crypto";
import { nativeOwnerClosed } from "./native-owner-rpc-contract.js";

const unavailable = () => Error("NativeImageConfigurationUnavailable");
export function nativeImageTls(raw: string, host: string): { key: Buffer; cert: Buffer } {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !nativeOwnerClosed(value, ["key", "cert"]) ||
      typeof value.key !== "string" ||
      typeof value.cert !== "string" ||
      Buffer.byteLength(value.key) > 16_384 ||
      Buffer.byteLength(value.cert) > 32_768
    )
      throw unavailable();
    const key = createPrivateKey(value.key);
    const cert = new X509Certificate(value.cert);
    const privatePublic = createPublicKey(key).export({ type: "spki", format: "der" });
    const publicKey = cert.publicKey.export({ type: "spki", format: "der" });
    if (
      privatePublic.length !== publicKey.length ||
      !timingSafeEqual(privatePublic, publicKey) ||
      !cert.checkHost(host) ||
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) <= Date.now() + 1_980_000 ||
      (key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) ||
      !["rsa", "ec", "ed25519"].includes(key.asymmetricKeyType ?? "")
    )
      throw unavailable();
    return { key: Buffer.from(value.key), cert: Buffer.from(value.cert) };
  } catch {
    throw unavailable();
  }
}
