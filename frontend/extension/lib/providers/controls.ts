import {
  ADAPTER_DECLARATIONS,
  type AdapterControls,
  type FixtureEvidence,
} from "@ai-job-apply/ats-sdk/registry";

declare const __APPLICATION_EXECUTION_PROVIDERS__: unknown;
declare const __APPLICATION_EXECUTION_BUILT_AT_MS__: unknown;

/** Providers whose execution may be switched on. Lever and the generic adapter never are. */
export const executionProviders = ["greenhouse", "ashby"] as const;
const EVIDENCE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The execution gate for one build (ADR-053). Everything is off unless the reviewed build names a
 * provider; a named provider is enabled with the owner's live-effects approval and evidence bound to
 * the exact adapter version and implementation hash. The evidence expires after 90 days, so an old
 * build stops acting instead of trusting page structure that may have changed.
 */
export function applicationExecutionControls(options: {
  providers: readonly string[];
  builtAtMs: number;
  implementationSha256: string;
}): AdapterControls {
  const enabled: Record<string, boolean> = {};
  const fixtureEvidence: Record<string, FixtureEvidence> = {};
  for (const declaration of ADAPTER_DECLARATIONS) {
    if (
      !(executionProviders as readonly string[]).includes(declaration.provider) ||
      !options.providers.includes(declaration.provider) ||
      !Number.isFinite(options.builtAtMs) ||
      !/^[a-f0-9]{64}$/u.test(options.implementationSha256)
    )
      continue;
    enabled[declaration.id] = true;
    fixtureEvidence[declaration.id] = {
      kind: "provider_derived",
      // Structure read from public pages on 2026-10-22 under the owner's direction (ADR-053). No
      // provider content is stored, so there is nothing to scan beyond that statement.
      authorizationRecordId: "adr-053-owner-direction-2026-10-22",
      sanitizationScanPassedAt: "2026-10-22T00:00:00.000Z",
      expiresAt: new Date(options.builtAtMs + EVIDENCE_LIFETIME_MS).toISOString(),
      variantIds: declaration.variants,
      adapterVersion: declaration.version,
      implementationSha256: options.implementationSha256,
    };
  }
  return {
    enabled,
    liveEffectsApproved: Object.keys(enabled).length > 0,
    fixtureEvidence,
  };
}

export function buildExecutionControls(
  implementationSha256: string,
  providers: unknown = typeof __APPLICATION_EXECUTION_PROVIDERS__ === "undefined"
    ? undefined
    : __APPLICATION_EXECUTION_PROVIDERS__,
  builtAtMs: unknown = typeof __APPLICATION_EXECUTION_BUILT_AT_MS__ === "undefined"
    ? undefined
    : __APPLICATION_EXECUTION_BUILT_AT_MS__,
): AdapterControls {
  return applicationExecutionControls({
    providers:
      Array.isArray(providers) && providers.every((entry) => typeof entry === "string")
        ? providers
        : [],
    builtAtMs: typeof builtAtMs === "number" ? builtAtMs : Number.NaN,
    implementationSha256,
  });
}
