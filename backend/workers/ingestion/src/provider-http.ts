import type { SourcePollResult } from "./contract.js";

type Fetch = typeof globalThis.fetch;

export const approvedCompanyDomainPattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function canonicalProviderText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.normalize("NFC").trim();
  const unsafeControl = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13;
  });
  if (!normalized || normalized.length > maximum || unsafeControl) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export function approvedCompanyConfiguration(
  companyName: unknown,
  verifiedCompanyDomain: unknown,
): Readonly<{ companyName: string; verifiedCompanyDomain: string }> {
  const canonicalCompanyName = canonicalProviderText(companyName, "The approved company name", 500);
  const canonicalDomain = canonicalProviderText(
    verifiedCompanyDomain,
    "The approved company domain",
    253,
  ).toLowerCase();
  if (!approvedCompanyDomainPattern.test(canonicalDomain)) {
    throw new Error("The approved company domain is invalid");
  }
  return Object.freeze({
    companyName: canonicalCompanyName,
    verifiedCompanyDomain: canonicalDomain,
  });
}

export function validateAcquisitionBounds(
  requestTimeoutMs: number,
  maximumResponseBytes: number,
  provider: string,
): void {
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 100 ||
    requestTimeoutMs > 10_000 ||
    !Number.isInteger(maximumResponseBytes) ||
    maximumResponseBytes < 1_024 ||
    maximumResponseBytes > 1_000_000
  ) {
    throw new Error(`The ${provider} acquisition bounds are invalid`);
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  provider: string,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json")
    throw new Error(`The ${provider} response type is invalid`);
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error(`The ${provider} response exceeds its byte limit`);
  }
  if (!response.body) throw new Error(`The ${provider} response body is missing`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`The ${provider} response exceeds its byte limit`);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export type PublicJsonFetchResult =
  | { kind: "success"; payload: unknown }
  | Extract<SourcePollResult, { kind: "retry" }>;

export async function fetchPublicJson(options: {
  fetch: Fetch;
  url: string;
  signal: AbortSignal;
  requestTimeoutMs: number;
  maximumResponseBytes: number;
  provider: string;
}): Promise<PublicJsonFetchResult> {
  const timeout = AbortSignal.timeout(options.requestTimeoutMs);
  const combined = AbortSignal.any([options.signal, timeout]);
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      method: "GET",
      redirect: "error",
      signal: combined,
      headers: { accept: "application/json" },
    });
  } catch {
    return {
      kind: "retry",
      reason: timeout.aborted && !options.signal.aborted ? "timeout" : "source_unavailable",
    };
  }
  if (response.status === 429) return { kind: "retry", reason: "rate_limited" };
  if (!response.ok) return { kind: "retry", reason: "source_unavailable" };
  return {
    kind: "success",
    payload: await readBoundedJson(response, options.maximumResponseBytes, options.provider),
  };
}
