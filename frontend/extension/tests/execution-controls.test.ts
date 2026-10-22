import { AdapterRegistry, ADAPTER_DECLARATIONS } from "@ai-job-apply/ats-sdk/registry";
import { describe, expect, it } from "vitest";
import { applicationExecutionControls, buildExecutionControls } from "../lib/providers/controls";

const sha = "a".repeat(64);
const now = Date.parse("2026-10-22T12:00:00Z");
const status = (providers: string[], id: string, variant: string, at = now) => {
  const registry = new AdapterRegistry(
    ADAPTER_DECLARATIONS,
    applicationExecutionControls({ providers, builtAtMs: now, implementationSha256: sha }),
  );
  const declaration = ADAPTER_DECLARATIONS.find((entry) => entry.id === id);
  return registry.executionStatus(id, variant, declaration?.version ?? "", sha, new Date(at));
};

describe("execution controls (ADR-053)", () => {
  it("is entirely off when the build names no provider or no usable hash", () => {
    expect(
      applicationExecutionControls({ providers: [], builtAtMs: now, implementationSha256: sha }),
    ).toEqual({
      enabled: {},
      liveEffectsApproved: false,
      fixtureEvidence: {},
    });
    expect(buildExecutionControls(sha)).toEqual({
      enabled: {},
      liveEffectsApproved: false,
      fixtureEvidence: {},
    });
    expect(
      applicationExecutionControls({
        providers: ["ashby"],
        builtAtMs: now,
        implementationSha256: "x",
      }).enabled,
    ).toEqual({});
    expect(buildExecutionControls(sha, ["ashby"], undefined).enabled).toEqual({});
  });
  it("enables only the named reviewed provider at its exact variant", () => {
    expect(status(["greenhouse"], "greenhouse-application-v1", "greenhouse-standard-v1").mode).toBe(
      "autofill",
    );
    expect(status(["greenhouse"], "ashby-application-v1", "ashby-standard-v1").mode).toBe("off");
    expect(status(["ashby"], "ashby-application-v1", "ashby-standard-v1").mode).toBe("autofill");
    expect(status(["ashby"], "ashby-application-v1", "other-variant").mode).toBe("suggest_only");
  });
  it("never enables Lever or the generic adapter through the build", () => {
    expect(
      applicationExecutionControls({
        providers: ["lever", "generic"],
        builtAtMs: now,
        implementationSha256: sha,
      }).enabled,
    ).toEqual({});
  });
  it("stops acting once the evidence is 90 days old", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(
      status(["ashby"], "ashby-application-v1", "ashby-standard-v1", now + 89 * day).mode,
    ).toBe("autofill");
    const expired = status(["ashby"], "ashby-application-v1", "ashby-standard-v1", now + 91 * day);
    expect(expired.mode).toBe("suggest_only");
    expect(expired.reasons).toContain("fixture_evidence_expired");
  });
  it("refuses an implementation that differs from the one the evidence names", () => {
    const registry = new AdapterRegistry(
      ADAPTER_DECLARATIONS,
      applicationExecutionControls({
        providers: ["ashby"],
        builtAtMs: now,
        implementationSha256: sha,
      }),
    );
    expect(
      registry.executionStatus(
        "ashby-application-v1",
        "ashby-standard-v1",
        "1.0.0",
        "b".repeat(64),
        new Date(now),
      ).reasons,
    ).toContain("execution_implementation_not_accepted");
  });
});
