/**
 * Adapter declarations and the enablement gate. An adapter runs page actions only when every
 * condition holds, and each condition fails closed:
 *
 * 1. its kill switch is on (default off),
 * 2. live ATS effects are approved (D3-012, LR-D3-01/02; default off),
 * 3. it has authorized, sanitized, QA-accepted, unexpired provider-derived fixture evidence for the
 *    exact variant (ADR-021). Synthetic fixtures never count.
 *
 * Without 2 and 3 an adapter can at most suggest values (no page action).
 */

export type Provider = "greenhouse" | "lever" | "ashby" | "generic";

export interface AdapterCapabilities {
  autofill: boolean;
  fileAttach: boolean;
  confirmationDetection: boolean;
}

export interface AdapterDeclaration {
  id: string;
  provider: Provider;
  version: string;
  variants: readonly string[];
  capabilities: AdapterCapabilities;
}

export interface FixtureEvidence {
  /** Execution acceptance binds reviewed code; legacy detector evidence grants no execution. */
  adapterVersion?: string;
  implementationSha256?: string;
  kind: "provider_derived" | "synthetic";
  authorizationRecordId: string;
  sanitizationScanPassedAt: string;
  qaRepresentativenessAcceptedAt: string;
  expiresAt: string;
  variantIds: readonly string[];
}

export interface AdapterControls {
  /** Per-adapter kill switch. Absent means off. */
  enabled: Readonly<Record<string, boolean>>;
  /** True only after D3-012 approval of live ATS effects. */
  liveEffectsApproved: boolean;
  fixtureEvidence: Readonly<Record<string, FixtureEvidence | undefined>>;
}

export type AdapterMode = "off" | "suggest_only" | "autofill";

export interface AdapterStatus {
  mode: AdapterMode;
  reasons: string[];
}

export const DEFAULT_CONTROLS: AdapterControls = {
  enabled: {},
  liveEffectsApproved: false,
  fixtureEvidence: {},
};

/**
 * The three concrete adapters are declared here so their state is visible, but none is enabled:
 * their provider-derived fixture evidence is a human gate (D3-013).
 */
export const ADAPTER_DECLARATIONS: readonly AdapterDeclaration[] = [
  {
    id: "greenhouse-application-v1",
    provider: "greenhouse",
    version: "1.0.0",
    variants: ["greenhouse-standard-v1"],
    capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
  },
  {
    id: "lever-application-v1",
    provider: "lever",
    version: "0.0.0",
    variants: [],
    capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
  },
  {
    id: "ashby-application-v1",
    provider: "ashby",
    version: "1.0.0",
    variants: ["ashby-standard-v1"],
    capabilities: { autofill: true, fileAttach: true, confirmationDetection: true },
  },
  {
    id: "generic-assisted-v1",
    provider: "generic",
    version: "1.0.0",
    variants: ["generic"],
    capabilities: { autofill: false, fileAttach: false, confirmationDetection: false },
  },
];

export class AdapterRegistry {
  private readonly byId: Map<string, AdapterDeclaration>;

  constructor(
    declarations: readonly AdapterDeclaration[] = ADAPTER_DECLARATIONS,
    private readonly controls: AdapterControls = DEFAULT_CONTROLS,
  ) {
    this.byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  }

  get(id: string): AdapterDeclaration | undefined {
    return this.byId.get(id);
  }

  executionStatus(
    id: string,
    variantId: string,
    version: string,
    implementationSha256: string,
    now: Date,
  ): AdapterStatus {
    const status = this.status(id, variantId, now);
    if (status.mode !== "autofill") return status;
    const declaration = this.get(id);
    if (!declaration?.capabilities.fileAttach || !declaration.capabilities.confirmationDetection)
      return { mode: "suggest_only", reasons: ["execution_capability_unavailable"] };
    const evidence = this.controls.fixtureEvidence[id];
    if (
      declaration?.version !== version ||
      evidence?.adapterVersion !== version ||
      !/^[a-f0-9]{64}$/u.test(implementationSha256) ||
      evidence.implementationSha256 !== implementationSha256
    )
      return { mode: "suggest_only", reasons: ["execution_implementation_not_accepted"] };
    return status;
  }

  status(id: string, variantId: string, now: Date): AdapterStatus {
    const adapter = this.byId.get(id);
    if (!adapter) return { mode: "off", reasons: ["unknown_adapter"] };
    if (this.controls.enabled[id] !== true) return { mode: "off", reasons: ["kill_switch_off"] };
    if (adapter.provider === "generic") return { mode: "suggest_only", reasons: [] };

    const reasons: string[] = [];
    if (!this.controls.liveEffectsApproved) reasons.push("live_effects_not_approved");
    const evidence = this.controls.fixtureEvidence[id];
    if (!evidence) reasons.push("no_fixture_evidence");
    else {
      if (evidence.kind !== "provider_derived")
        reasons.push("fixture_evidence_not_provider_derived");
      if (!evidence.authorizationRecordId) reasons.push("fixture_source_not_authorized");
      if (!evidence.sanitizationScanPassedAt) reasons.push("fixture_scan_missing");
      if (!evidence.qaRepresentativenessAcceptedAt) reasons.push("fixture_qa_acceptance_missing");
      if (!(Date.parse(evidence.expiresAt) > now.getTime()))
        reasons.push("fixture_evidence_expired");
      if (!evidence.variantIds.includes(variantId) || !adapter.variants.includes(variantId)) {
        reasons.push("variant_not_covered");
      }
    }
    if (reasons.length > 0) return { mode: "suggest_only", reasons };
    return { mode: adapter.capabilities.autofill ? "autofill" : "suggest_only", reasons: [] };
  }
}
