import type { CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";

const validateCanonicalJobDetail = compileComponentValidator("CanonicalJobDetail");

function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      !value.includes("#") &&
      url.href === value
    );
  } catch {
    return false;
  }
}

export function parseJobDetail(value: unknown): CanonicalJobDetail | undefined {
  try {
    if (!validateCanonicalJobDetail(value)) return undefined;
    const detail = value as CanonicalJobDetail;
    if (!detail.sources.every((source) => safeSourceUrl(source.canonicalUrl))) return undefined;
    // Jobs resolves exact aliases. The canonical response ID need not equal the requested ID.
    return detail;
  } catch {
    return undefined;
  }
}
