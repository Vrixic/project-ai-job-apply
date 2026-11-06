import type { extractGenericForm } from "@ai-job-apply/ats-sdk/extract";
import type { PacketValue } from "@ai-job-apply/ats-sdk/plan";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";

export type ApplicationProviderId = "greenhouse" | "ashby";

/** Structure-only view of one employer application page. Never holds entered values. */
export interface ApplicationInspection {
  identity: { tenant: string; jobId: string };
  form: ReturnType<typeof extractGenericForm>;
  structure: string;
  /** A changed URL, root, structure, challenge or control identity invalidates all handles. */
  resolve(ref: string): readonly Element[];
  dispose(): void;
}

/** Only reviewed adapter source supplies this profile. Page data never chooses selectors. */
export interface ExecutionProfile {
  variantId: string;
  adapterVersion: string;
  implementationSha256: string;
  submitSelector: string;
  /** Candidate nodes for the provider's confirmation message. */
  confirmationSelector: string;
  /** Case-insensitive pattern a candidate node's text must match, when the page has no reference. */
  confirmationText?: string;
  /** Only elements with no child elements count, so a wrapper's inherited text never matches. */
  confirmationLeafOnly?: boolean;
  /** Attribute holding the provider's reference; empty when the page shows none. */
  confirmationReferenceAttribute: string;
}

export interface FillAuthority {
  registry: AdapterRegistry;
  variantId: string;
  deadline: number;
  signal: AbortSignal;
  revalidateApproval(): Promise<void>;
  /** The furthest the deadline may be from now: the short lease unless a fill-only run has more. */
  maximumMs?: number;
  /** Submission composition must distinguish a stopped fill from candidate-only review. */
  throwOnFailure?: boolean;
  /** Names the field being filled, for a refusal message. Never any value. */
  onField?(fieldKey: string): void;
  /** Scrolls the control about to be filled into view for the candidate. Moves the view only. */
  reveal?(control: Element): Promise<void>;
}

/**
 * One ATS provider's page knowledge (ADR-053). The executor owns every guard (dispatch, one-shot
 * click, deadlines, file binding); a provider only says what the page is and how to drive it.
 */
export interface ApplicationProvider {
  readonly id: ApplicationProviderId;
  /** Registry declaration id, e.g. `greenhouse-application-v1`. */
  readonly adapterId: string;
  /** Variant the extension selects when it arms an application page of this provider. */
  readonly variantId: string;
  /** Exact supported host and path metadata only. This is not fixture acceptance. */
  identity(url: string): { tenant: string; jobId: string } | undefined;
  /** An interactive challenge or credential prompt. An invisible badge is not one (ADR-053). */
  challengePresent(document: Document): boolean;
  inspect(document: Document, expectedUrl: string): ApplicationInspection;
  fill(
    inspection: ApplicationInspection,
    packet: readonly PacketValue[],
    authority: FillAuthority,
  ): Promise<{
    filled: readonly string[];
    selected?: readonly string[];
    notes?: readonly string[];
    reviewRequired: boolean;
  }>;
  /** The one element that contains the application's controls and submit control. */
  root(document: Document): Element;
  /** The one submit control inside the root for the profile's selector. */
  submitControl(root: Element, profile: Readonly<ExecutionProfile>): HTMLElement;
  /** Whether every required control in the root currently satisfies the page's own validation. */
  rootValid(root: Element): boolean;
  /**
   * Whether the candidate has completed a control the extension may not fill. Answers only yes or
   * no (a required control must also be non-empty); the entered value is never kept or sent.
   */
  controlsSatisfied(controls: readonly Element[], required: boolean): boolean;
  /**
   * A provider that confirms by moving the same document to another URL (client-side navigation)
   * says which one. Only honored after the one click; any other URL change stops the run.
   */
  isConfirmationUrl?(employerUrl: string, currentUrl: string): boolean;
  /**
   * A board that swaps its upload control for its own "attached" display once it accepts a file says
   * whether it now shows this file name. The replaced control is not looked up again.
   */
  attachmentAccepted?(root: Element, fileName: string): boolean;
  profile(variantId: string, adapterVersion: string): Readonly<ExecutionProfile> | undefined;
}
