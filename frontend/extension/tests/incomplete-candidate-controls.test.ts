import { describe, expect, it, vi } from "vitest";
import { incompleteCandidateControls } from "../lib/application-run";
import type { ApplicationInspection, ApplicationProvider } from "../lib/providers/types";

type Plan = Parameters<typeof incompleteCandidateControls>[2];

function scenario(satisfied: Record<string, boolean>) {
  const controls = Object.fromEntries(Object.keys(satisfied).map((ref) => [ref, { ref }]));
  const provider = {
    controlsSatisfied: vi.fn(
      (found: readonly { ref?: string }[]) => satisfied[found[0]?.ref ?? ""] === true,
    ),
  } as unknown as ApplicationProvider;
  const inspection = {
    form: {
      fields: [
        { ref: "name", required: true },
        { ref: "essay", required: true },
        { ref: "referral", required: false },
        { ref: "other", required: true },
      ],
    },
    resolve: (ref: string) => [controls[ref]],
  } as unknown as ApplicationInspection;
  return { provider, inspection };
}

const plan = (...refs: string[]): Plan => ({
  actions: [
    { kind: "fill", ref: "name", fieldKey: "identity.legal_name.first", value: "x" },
    { kind: "skip", ref: "other", reason: "unmapped_optional" },
    ...refs.map((ref) => ({
      kind: "require_user" as const,
      ref,
      fieldKey: null,
      reason: "unmapped_required" as const,
    })),
  ],
  requiresTakeover: false,
  unresolvedRequired: refs,
});

describe("incompleteCandidateControls", () => {
  it("counts the candidate-only controls that are not complete, and nothing else", () => {
    const { provider, inspection } = scenario({
      name: false,
      essay: false,
      referral: true,
      other: false,
    });
    // Only the planned candidate-only controls count, not a fill or a skipped control.
    expect(incompleteCandidateControls(provider, inspection, plan("essay", "referral"))).toBe(1);
    expect(incompleteCandidateControls(provider, inspection, plan("essay"))).toBe(1);
    expect(incompleteCandidateControls(provider, inspection, plan("referral"))).toBe(0);
    expect(incompleteCandidateControls(provider, inspection, plan())).toBe(0);
  });

  it("is zero once the candidate has answered them all, and counts each one that is still empty", () => {
    expect(
      incompleteCandidateControls(
        ...(Object.values(scenario({ essay: true, referral: true })) as [
          ApplicationProvider,
          ApplicationInspection,
        ]),
        plan("essay", "referral"),
      ),
    ).toBe(0);
    const open = scenario({ essay: false, referral: false });
    expect(
      incompleteCandidateControls(open.provider, open.inspection, plan("essay", "referral")),
    ).toBe(2);
  });

  it("tells the provider whether each control is required, and reads nothing else", () => {
    const { provider, inspection } = scenario({ essay: true, referral: true });
    incompleteCandidateControls(provider, inspection, plan("essay", "referral"));
    const calls = (provider.controlsSatisfied as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map(([, required]) => required)).toEqual([true, false]);
  });
});
