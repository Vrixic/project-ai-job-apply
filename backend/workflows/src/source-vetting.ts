import {
  OpenAiSourceVettingProvider,
  SourceVettingGateway,
  sourceVettingPromptVersion,
} from "@ai-job-apply/ai-sdk";
import {
  AutomatedSourceVetting,
  type VettingAssessorPort,
  type VettingAuditRecord,
} from "@ai-job-apply/trust-service";

type TrustPort = ConstructorParameters<typeof AutomatedSourceVetting>[0]["application"];

/**
 * Composition for automated source vetting (ADR-054). Everything is off unless the exact value
 * `true` is set; the model path, the audit sink and the Trust authority are all injected. It runs
 * nothing by itself: a scheduled host (an AWS addition, not part of this change) calls
 * `vetPending`. Audit lines carry identifiers and enumerations, never posting text.
 */
export function createAutomatedSourceVetting(options: {
  application: TrustPort;
  /** The automated reviewer identity the Trust authority port authorizes for this one purpose. */
  reviewerId: string;
  environment: Readonly<Record<string, string | undefined>>;
  apiKey: () => string | undefined;
  log: (entry: Record<string, unknown>) => void;
  fetch?: typeof fetch;
  now?: () => Date;
}): AutomatedSourceVetting {
  const enabled = () => options.environment.SOURCE_VETTING_ENABLED === "true";
  const provider = new OpenAiSourceVettingProvider({
    enabled,
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const gateway = new SourceVettingGateway(provider, { enabled });
  const assessor: VettingAssessorPort = {
    async assess(posting) {
      const assessment = await gateway.assess({
        ...posting,
        locations: [...posting.locations],
      });
      return {
        decision: assessment.decision,
        concerns: assessment.concerns,
        confidence: assessment.confidence,
        model: assessment.model,
        promptId: assessment.promptId,
        promptVersion: assessment.promptVersion,
      };
    },
  };
  return new AutomatedSourceVetting({
    application: options.application,
    assessor,
    audit: {
      async record(entry: VettingAuditRecord) {
        options.log({ event: "trust.source_vetting", ...entry });
      },
    },
    reviewerId: options.reviewerId,
    enabled,
    promptVersion: sourceVettingPromptVersion,
    ...(options.now ? { now: options.now } : {}),
  });
}
