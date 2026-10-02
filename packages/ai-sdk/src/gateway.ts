/**
 * The only approved path to a model provider. It enforces, before any candidate data leaves the
 * platform: an explicit kill switch (default off), a just-in-time candidate disclosure approval for
 * the exact purpose, bounded input and output, a hard timeout, and strict JSON output. Provider
 * identity and prompt version are returned so quality can be measured by version.
 */

export interface ModelIdentity {
  provider: string;
  model: string;
  version: string;
}

export const generationPurposes = ["cover_letter", "narrative_answer"] as const;
export type GenerationPurpose = (typeof generationPurposes)[number];

/**
 * Just-in-time approval to share the named data categories with an AI provider for one declared
 * purpose. Approval is short lived and never covers a different purpose or category.
 */
export interface DataDisclosureApproval {
  purpose: GenerationPurpose;
  categories: readonly ("profile_facts" | "job_posting")[];
  approvedAt: Date;
}

export interface ProviderRequest {
  system: string;
  user: string;
  maxOutputChars: number;
  signal: AbortSignal;
}

export interface ModelProvider {
  readonly identity: ModelIdentity;
  complete(request: ProviderRequest): Promise<{ text: string }>;
}

export class ModelGatewayError extends Error {
  constructor(
    readonly code:
      | "MODEL_DISABLED"
      | "DISCLOSURE_MISSING"
      | "DISCLOSURE_PURPOSE_MISMATCH"
      | "DISCLOSURE_CATEGORY_MISSING"
      | "DISCLOSURE_STALE"
      | "INPUT_TOO_LARGE"
      | "PROVIDER_TIMEOUT"
      | "PROVIDER_FAILED"
      | "OUTPUT_TOO_LARGE"
      | "OUTPUT_NOT_JSON",
  ) {
    super(`Model gateway refused: ${code}`);
    this.name = "ModelGatewayError";
  }
}

export interface GatewayOptions {
  /** Must return true for any model call to happen. Default-off keeps generation dark. */
  enabled: () => boolean;
  clock?: () => Date;
  timeoutMs?: number;
  maxInputChars?: number;
  maxOutputChars?: number;
  disclosureMaxAgeMs?: number;
}

export interface GatewayRequest {
  promptId: string;
  promptVersion: string;
  purpose: GenerationPurpose;
  /** Data categories this request will place in the prompt. */
  categories: readonly ("profile_facts" | "job_posting")[];
  system: string;
  user: string;
}

export interface GatewayResult {
  value: unknown;
  model: ModelIdentity;
  promptId: string;
  promptVersion: string;
  outputCharacters: number;
}

export class ModelGateway {
  private readonly clock: () => Date;
  private readonly timeoutMs: number;
  private readonly maxInputChars: number;
  private readonly maxOutputChars: number;
  private readonly disclosureMaxAgeMs: number;

  constructor(
    private readonly provider: ModelProvider,
    private readonly options: GatewayOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxInputChars = options.maxInputChars ?? 40_000;
    this.maxOutputChars = options.maxOutputChars ?? 8_000;
    this.disclosureMaxAgeMs = options.disclosureMaxAgeMs ?? 15 * 60 * 1000;
  }

  get identity(): ModelIdentity {
    return this.provider.identity;
  }

  async generate(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
  ): Promise<GatewayResult> {
    if (!this.options.enabled()) throw new ModelGatewayError("MODEL_DISABLED");
    if (!disclosure) throw new ModelGatewayError("DISCLOSURE_MISSING");
    if (disclosure.purpose !== request.purpose) {
      throw new ModelGatewayError("DISCLOSURE_PURPOSE_MISMATCH");
    }
    if (!request.categories.every((category) => disclosure.categories.includes(category))) {
      throw new ModelGatewayError("DISCLOSURE_CATEGORY_MISSING");
    }
    const age = this.clock().getTime() - disclosure.approvedAt.getTime();
    if (
      !Number.isFinite(age) ||
      !Number.isFinite(this.disclosureMaxAgeMs) ||
      this.disclosureMaxAgeMs < 0 ||
      age < 0 ||
      age > this.disclosureMaxAgeMs
    ) {
      throw new ModelGatewayError("DISCLOSURE_STALE");
    }
    if (request.system.length + request.user.length > this.maxInputChars) {
      throw new ModelGatewayError("INPUT_TOO_LARGE");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let text: string;
    try {
      const result = await Promise.race([
        this.provider.complete({
          system: request.system,
          user: request.user,
          maxOutputChars: this.maxOutputChars,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new ModelGatewayError("PROVIDER_TIMEOUT")),
          );
        }),
      ]);
      text = result.text;
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    } finally {
      clearTimeout(timer);
    }
    if (text.length > this.maxOutputChars) throw new ModelGatewayError("OUTPUT_TOO_LARGE");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ModelGatewayError("OUTPUT_NOT_JSON");
    }
    return {
      value,
      model: this.provider.identity,
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      outputCharacters: text.length,
    };
  }
}
