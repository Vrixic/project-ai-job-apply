import {
  type OpenAiBackgroundResponseReference,
  type ProviderBackgroundTerminal,
  validateOpenAiBackgroundResponseReference,
  validateProviderBackgroundTerminal,
} from "./provider-background-contract.js";

export {
  type ProviderBackgroundTerminal,
  validateProviderBackgroundTerminal,
} from "./provider-background-contract.js";

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

/** Everything the gateway can disclose data for. Resume tailoring (ADR-059) only selects and orders the candidate's own
 * resume lines; it writes no text, so it is not a text generation purpose. */
export type GatewayPurpose = GenerationPurpose | "resume_tailoring";
export type DisclosureCategory = "profile_facts" | "job_posting" | "resume_content";

/**
 * Just-in-time approval to share the named data categories with an AI provider for one declared
 * purpose. Approval is short lived and never covers a different purpose or category.
 */
export interface DataDisclosureApproval {
  purpose: GatewayPurpose;
  categories: readonly DisclosureCategory[];
  approvedAt: Date;
}

export interface ProviderRequest {
  system: string;
  user: string;
  maxOutputChars: number;
  signal: AbortSignal;
  /** Opaque, content-free key that lets a provider reuse its cache of a shared prompt prefix. */
  cacheKey?: string;
}

export interface ModelProvider {
  readonly identity: ModelIdentity;
  complete(request: ProviderRequest): Promise<{ text: string }>;
  /** Internal lifecycle path: acknowledge original completed response before character/JSON
   * rejection. The gateway must still enforce output bounds before using this text. Failure
   * never falls back to another dispatch. Existing providers need not implement this port.
   */
  completeForLifecycle?(request: ProviderRequest): Promise<{ text: string }>;
  /** Private original background execution only. Capture must commit before polling/content use. */
  completeBackgroundForLifecycle?(
    request: ProviderRequest,
    capture: BackgroundResponseCapture,
  ): Promise<{ text: string }>;
  /** Opt-in original terminal observation only; never inferred from a rejected port. */
  completeBackgroundForTermination?(
    request: ProviderRequest,
    capture: BackgroundResponseCapture,
  ): Promise<{ text: string } | ProviderBackgroundTerminal>;
}

export interface BackgroundResponseCapture {
  reserve(): Promise<"reserved" | "already_reserved">;
  recordCreation(reference: OpenAiBackgroundResponseReference): Promise<void>;
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
      | "PROVIDER_REFUSED"
      | "OUTPUT_TOO_LARGE"
      | "OUTPUT_NOT_JSON",
  ) {
    super(`Model gateway refused: ${code}`);
    this.name = "ModelGatewayError";
  }
}

/** Thrown ONLY by a provider that holds positive proof from its service that the request was rejected before any model
 * work happened: a definitive client-side rejection such as permission denied, throttled, unknown model or a request
 * the service did not accept (ADR-059 addendum 16). On the receipt paths the gateway reports it as a `not_dispatched`
 * receipt, so the single-dispatch claim can be settled and the candidate sees a failed state at once. A timeout, an
 * abort, a transport error or a server fault is never this: its outcome is unknown and an unknown outcome is never
 * settled. It carries no provider text. */
export class ProviderRefusedError extends Error {
  constructor() {
    super("Provider refused the request before any model work");
    this.name = "ProviderRefusedError";
  }
}

export interface GatewayOptions {
  /** Native memory-session host only: synchronous scalar notification before decoding/control
   * awaits. Applies only to generateOriginalWithCompletion; failure withholds generated content. */
  originalCompletionObserver?: (completedAtMs: number) => void;
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
  /** Opaque, content-free key for provider prompt caching (never derived from candidate content). */
  cacheKey?: string;
  purpose: GatewayPurpose;
  /** Data categories this request will place in the prompt. */
  categories: readonly DisclosureCategory[];
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

/** Original foreground actor receipt. The timeout requests cancellation but this port keeps
 * awaiting the actual provider promise; an abort alone is never completion evidence. A host
 * must bound admission and physically retire an actor whose provider never acknowledges. */
export type OriginalModelGatewayCompletion =
  | Extract<ModelGatewayCompletion, { kind: "not_dispatched" }>
  | (Exclude<ModelGatewayCompletion, { kind: "not_dispatched" }> & { completedAtMs: number })
  | { kind: "completed_discarded"; completedAtMs: number; model: ModelIdentity };

/** Internal original lifecycle receipts, never inferred from caught errors or deadlines.
 * `not_dispatched` comes only from gateway-local pre-provider refusal or a provider's typed
 * `ProviderRefusedError` (positive proof from its service); completed receipts
 * require original provider fulfillment. Neither is candidate approval or quiescence proof.
 */
export type ModelGatewayCompletion =
  | { kind: "completed"; result: GatewayResult }
  | {
      kind: "not_dispatched";
      code:
        | "MODEL_DISABLED"
        | "DISCLOSURE_MISSING"
        | "DISCLOSURE_PURPOSE_MISMATCH"
        | "DISCLOSURE_CATEGORY_MISSING"
        | "DISCLOSURE_STALE"
        | "INPUT_TOO_LARGE"
        | "PROVIDER_REFUSED";
      model: ModelIdentity;
      promptId: string;
      promptVersion: string;
    }
  | {
      kind: "completed_rejected";
      code: "OUTPUT_TOO_LARGE" | "OUTPUT_NOT_JSON";
      model: ModelIdentity;
      promptId: string;
      promptVersion: string;
      outputCharacters: number;
    };

export type ModelGatewayBackgroundCompletion =
  | ModelGatewayCompletion
  | (ProviderBackgroundTerminal & {
      model: ModelIdentity;
      promptId: string;
      promptVersion: string;
    });

function completionOnly(completion: ModelGatewayBackgroundCompletion): ModelGatewayCompletion {
  if (completion.kind === "terminal_no_content") throw new ModelGatewayError("PROVIDER_FAILED");
  return completion;
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
    const completion = completionOnly(await this.generateLifecycle(request, disclosure, false));
    if (completion.kind !== "completed") throw new ModelGatewayError(completion.code);
    return completion.result;
  }

  /** Private lifecycle consumer only. Known local refusals return non-dispatch metadata.
   * Provider rejections/aborts/lost responses still throw, including our own error classes.
   * Completed rejection requires original fulfillment and never carries rejected text.
   */
  async generateWithCompletion(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
  ): Promise<ModelGatewayCompletion> {
    return completionOnly(await this.generateLifecycle(request, disclosure, true));
  }

  /** No background request, recovery or second dispatch. Late original fulfillment closes
   * only the foreground provider phase and returns no content. */
  async generateOriginalWithCompletion(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
  ): Promise<OriginalModelGatewayCompletion> {
    const original: { completedAtMs?: number; timedOut?: boolean } = {};
    const completion = completionOnly(
      await this.generateLifecycle(request, disclosure, true, undefined, false, original),
    );
    if (completion.kind === "not_dispatched") return completion;
    const completedAtMs = original.completedAtMs;
    if (
      typeof completedAtMs !== "number" ||
      !Number.isSafeInteger(completedAtMs) ||
      completedAtMs < 0
    )
      throw new ModelGatewayError("PROVIDER_FAILED");
    if (original.timedOut) {
      const model = completion.kind === "completed" ? completion.result.model : completion.model;
      if (completion.kind === "completed") completion.result.value = undefined;
      return { kind: "completed_discarded", completedAtMs, model };
    }
    return { ...completion, completedAtMs };
  }

  /** Opt-in private actor path. Never falls back to foreground generation. */
  async generateWithBackgroundCapture(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
    capture: BackgroundResponseCapture,
  ): Promise<ModelGatewayCompletion> {
    return completionOnly(
      await this.generateBackgroundLifecycle(request, disclosure, capture, false),
    );
  }

  /** Only a positively captured original response and fulfilled terminal provider port qualify. */
  async generateWithBackgroundTermination(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
    capture: BackgroundResponseCapture,
  ): Promise<ModelGatewayBackgroundCompletion> {
    return this.generateBackgroundLifecycle(request, disclosure, capture, true);
  }

  private async generateBackgroundLifecycle(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
    capture: BackgroundResponseCapture,
    terminalReceipts: boolean,
  ): Promise<ModelGatewayBackgroundCompletion> {
    let originalCapture: BackgroundResponseCapture;
    try {
      if (
        !capture ||
        typeof capture !== "object" ||
        Array.isArray(capture) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(capture))
      )
        throw new ModelGatewayError("PROVIDER_FAILED");
      const keys = Reflect.ownKeys(capture);
      if (
        keys.length !== 2 ||
        !keys.every((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(capture, key);
          return (
            typeof key === "string" &&
            ["reserve", "recordCreation"].includes(key) &&
            descriptor?.enumerable === true &&
            Object.hasOwn(descriptor, "value") &&
            typeof descriptor.value === "function"
          );
        })
      )
        throw new ModelGatewayError("PROVIDER_FAILED");
      originalCapture = {
        reserve: capture.reserve.bind(capture),
        recordCreation: capture.recordCreation.bind(capture),
      };
    } catch {
      throw new ModelGatewayError("PROVIDER_FAILED");
    }
    return this.generateLifecycle(request, disclosure, true, originalCapture, terminalReceipts);
  }

  private async generateLifecycle(
    request: GatewayRequest,
    disclosure: DataDisclosureApproval | undefined,
    nonDispatchReceipts: boolean,
    backgroundCapture?: BackgroundResponseCapture,
    terminalReceipts = false,
    original?: { completedAtMs?: number; timedOut?: boolean },
  ): Promise<ModelGatewayBackgroundCompletion> {
    const capture = () => ({
      model: structuredClone(this.provider.identity),
      promptId: request.promptId,
      promptVersion: request.promptVersion,
    });
    // Ordinary refusal must not consult provider identity or evaluate validation twice.
    const earlyProvenance = nonDispatchReceipts ? capture() : undefined;
    // Only these locally known branches prove no provider port was invoked. Never infer
    // non-dispatch from an exception, including a provider-thrown ModelGatewayError.
    const refused = (
      code: Extract<ModelGatewayCompletion, { kind: "not_dispatched" }>["code"],
    ): ModelGatewayCompletion => {
      if (!earlyProvenance) throw new ModelGatewayError(code);
      return { kind: "not_dispatched", code, ...earlyProvenance };
    };
    if (!this.options.enabled()) return refused("MODEL_DISABLED");
    if (!disclosure) return refused("DISCLOSURE_MISSING");
    if (disclosure.purpose !== request.purpose) {
      return refused("DISCLOSURE_PURPOSE_MISMATCH");
    }
    if (!request.categories.every((category) => disclosure.categories.includes(category))) {
      return refused("DISCLOSURE_CATEGORY_MISSING");
    }
    const age = this.clock().getTime() - disclosure.approvedAt.getTime();
    if (
      !Number.isFinite(age) ||
      !Number.isFinite(this.disclosureMaxAgeMs) ||
      this.disclosureMaxAgeMs < 0 ||
      age < 0 ||
      age > this.disclosureMaxAgeMs
    ) {
      return refused("DISCLOSURE_STALE");
    }
    if (request.system.length + request.user.length > this.maxInputChars) {
      return refused("INPUT_TOO_LARGE");
    }
    const backgroundPort = backgroundCapture
      ? ((terminalReceipts ? this.provider.completeBackgroundForTermination : undefined) ??
        this.provider.completeBackgroundForLifecycle)
      : undefined;
    if (backgroundCapture && !backgroundPort) return refused("MODEL_DISABLED");
    const admittedApprovalTime = backgroundCapture ? disclosure.approvedAt.getTime() : undefined;
    const provenance = earlyProvenance ?? capture();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let reservationAttempted = false;
    let reservationAcknowledged = false;
    let captureAttempted = false;
    let captureAcknowledged = false;
    let capturedReference: OpenAiBackgroundResponseReference | undefined;
    let text: string;
    try {
      const providerRequest = {
        system: request.system,
        user: request.user,
        maxOutputChars: this.maxOutputChars,
        signal: controller.signal,
        ...(request.cacheKey ? { cacheKey: request.cacheKey } : {}),
      };
      const dispatch = () => {
        if (backgroundCapture) {
          if (!backgroundPort || admittedApprovalTime === undefined)
            throw new ModelGatewayError("PROVIDER_FAILED");
          return backgroundPort.call(this.provider, providerRequest, {
            reserve: async () => {
              if (reservationAttempted) throw new ModelGatewayError("PROVIDER_FAILED");
              reservationAttempted = true;
              const kind = await backgroundCapture.reserve();
              const currentAge = this.clock().getTime() - admittedApprovalTime;
              if (!this.options.enabled()) throw new ModelGatewayError("MODEL_DISABLED");
              if (
                !Number.isFinite(currentAge) ||
                currentAge < 0 ||
                currentAge > this.disclosureMaxAgeMs
              )
                throw new ModelGatewayError("DISCLOSURE_STALE");
              reservationAcknowledged = kind === "reserved";
              return kind;
            },
            recordCreation: async (reference) => {
              if (
                !reservationAcknowledged ||
                captureAttempted ||
                !validateOpenAiBackgroundResponseReference(reference)
              )
                throw new ModelGatewayError("PROVIDER_FAILED");
              captureAttempted = true;
              const original = structuredClone(reference);
              await backgroundCapture.recordCreation(structuredClone(original));
              capturedReference = original;
              captureAcknowledged = true;
            },
          });
        }
        return this.provider.completeForLifecycle !== undefined
          ? this.provider.completeForLifecycle(providerRequest)
          : this.provider.complete(providerRequest);
      };
      const result = original
        ? await dispatch()
        : await Promise.race([
            dispatch(),
            new Promise<never>((_, reject) => {
              controller.signal.addEventListener("abort", () =>
                reject(new ModelGatewayError("PROVIDER_TIMEOUT")),
              );
            }),
          ]);
      if (original) {
        // Capture before decoding/grounding or any control-plane/rendering await.
        original.completedAtMs = this.clock().getTime();
        original.timedOut = controller.signal.aborted;
        try {
          this.options.originalCompletionObserver?.(original.completedAtMs);
        } catch {
          original.timedOut = true;
        }
      }
      if (backgroundCapture && !captureAcknowledged) throw new ModelGatewayError("PROVIDER_FAILED");
      if ("kind" in result) {
        if (
          !terminalReceipts ||
          !validateProviderBackgroundTerminal(result) ||
          !captureAcknowledged ||
          !capturedReference ||
          result.reference.responseId !== capturedReference.responseId ||
          result.reference.createdAt !== capturedReference.createdAt ||
          controller.signal.aborted ||
          !this.options.enabled()
        )
          throw new ModelGatewayError("PROVIDER_FAILED");
        return { ...structuredClone(result), ...provenance };
      }
      text = result.text;
    } catch (error) {
      if (error instanceof ProviderRefusedError) {
        // Positive proof of non-dispatch exists only for the foreground receipt paths. Anywhere else it is an ordinary
        // provider failure, and a plain exception is never inferred to be non-dispatch.
        if (earlyProvenance && !backgroundCapture)
          return { kind: "not_dispatched", code: "PROVIDER_REFUSED", ...earlyProvenance };
        throw new ModelGatewayError("PROVIDER_FAILED");
      }
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("PROVIDER_FAILED");
    } finally {
      clearTimeout(timer);
    }
    if (typeof text !== "string") throw new ModelGatewayError("PROVIDER_FAILED");
    const metadata = {
      ...provenance,
      outputCharacters: text.length,
    };
    if (text.length > this.maxOutputChars)
      return { kind: "completed_rejected", code: "OUTPUT_TOO_LARGE", ...metadata };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: "completed_rejected", code: "OUTPUT_NOT_JSON", ...metadata };
    }
    return {
      kind: "completed",
      result: { value, ...metadata },
    };
  }
}
