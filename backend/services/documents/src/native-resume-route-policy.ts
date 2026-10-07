import { isIPv4 } from "node:net";

/** Scalar route intent, supplied only by the private owning workflow after original task
 * observation. It must be persisted unchanged before any DNS effect. No candidate input. */
export interface NativeResumeRouteIntent {
  allocationId: string;
  publicIp: string;
  hostedZoneId: string;
  baseHost: string;
}
export type NativeResumeRouteConfiguration = Pick<
  NativeResumeRouteIntent,
  "hostedZoneId" | "baseHost"
>;
export interface NativeResumeRouteSnapshot {
  intent: NativeResumeRouteIntent;
  expiresAtMs: number;
}
export function nativeResumeRouteConfiguration(input: NativeResumeRouteConfiguration) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 2 ||
    !["hostedZoneId", "baseHost"].every((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      return field?.enumerable && "value" in field && typeof field.value === "string";
    }) ||
    !/^Z[A-Z0-9]{1,31}$/u.test(input.hostedZoneId) ||
    input.baseHost.length > 200 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(input.baseHost)
  )
    throw Error("NativeResumeDnsUnavailable");
  return Object.freeze({ hostedZoneId: input.hostedZoneId, baseHost: input.baseHost });
}
export function nativeResumeRouteSnapshot(input: NativeResumeRouteSnapshot) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== 2 ||
    !["intent", "expiresAtMs"].every((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      return field?.enumerable && "value" in field;
    }) ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.expiresAtMs <= 0 ||
    input.expiresAtMs > 8_640_000_000_000_000
  )
    throw Error("NativeResumeDnsUnavailable");
  return Object.freeze({
    intent: nativeResumeRouteIntent(input.intent),
    expiresAtMs: input.expiresAtMs,
  });
}

export function nativeResumePublicIpv4(value: unknown): value is string {
  if (typeof value !== "string" || !isIPv4(value)) return false;
  const [a = 0, b = 0, c = 0] = value.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export function nativeResumeRouteIntent(input: NativeResumeRouteIntent) {
  const keys = ["allocationId", "publicIp", "hostedZoneId", "baseHost"] as const;
  if (
    !input ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length ||
    !keys.every((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      return field?.enumerable && "value" in field && typeof field.value === "string";
    })
  )
    throw Error("NativeResumeDnsUnavailable");
  const { allocationId, publicIp, hostedZoneId, baseHost } = input;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(allocationId) ||
    !nativeResumePublicIpv4(publicIp) ||
    !/^Z[A-Z0-9]{1,31}$/u.test(hostedZoneId) ||
    baseHost.length > 200 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(baseHost)
  )
    throw Error("NativeResumeDnsUnavailable");
  return Object.freeze({ allocationId, publicIp, hostedZoneId, baseHost });
}
