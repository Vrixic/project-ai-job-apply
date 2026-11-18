import { describe, expect, it } from "vitest";
import { parseExtensionMessage } from "../lib/messages";

describe("extension message boundary", () => {
  it("accepts only exact known requests", () => {
    expect(parseExtensionMessage({ action: "status" })).toEqual({ action: "status" });
    expect(parseExtensionMessage({ action: "shared_jobs_refresh" })).toEqual({
      action: "shared_jobs_refresh",
    });
    expect(
      parseExtensionMessage({ action: "shared_jobs_refresh", owner: "forbidden" }),
    ).toBeUndefined();
    expect(parseExtensionMessage({ action: "clear_queue" })).toEqual({ action: "clear_queue" });
    expect(parseExtensionMessage({ action: "retry_stopped" })).toEqual({
      action: "retry_stopped",
    });
    expect(
      parseExtensionMessage({
        action: "enqueue",
        approvedFields: ["title", "location"],
        intent: "contribute",
      }),
    ).toEqual({ action: "enqueue", approvedFields: ["title", "location"], intent: "contribute" });
    expect(parseExtensionMessage({ action: "status", token: "forbidden" })).toBeUndefined();
    expect(
      parseExtensionMessage({
        action: "enqueue",
        approvedFields: ["privateNote"],
        intent: "contribute",
      }),
    ).toBeUndefined();
    expect(parseExtensionMessage({ action: "unknown" })).toBeUndefined();
    const contributionId = "018f0000-0000-7000-8000-000000000004";
    expect(parseExtensionMessage({ action: "contribution_refresh", contributionId })).toEqual({
      action: "contribution_refresh",
      contributionId,
    });
    expect(parseExtensionMessage({ action: "withdraw", confirmed: true, contributionId })).toEqual({
      action: "withdraw",
      confirmed: true,
      contributionId,
    });
    expect(parseExtensionMessage({ action: "withdraw", contributionId })).toBeUndefined();
    expect(
      parseExtensionMessage({ action: "cancel_contribution", contributionId }),
    ).toBeUndefined();
    expect(
      parseExtensionMessage({ action: "cancel_contribution", contributionId, confirmed: true }),
    ).toEqual({ action: "cancel_contribution", contributionId, confirmed: true });
    expect(
      parseExtensionMessage({
        action: "cancel_contribution",
        contributionId,
        confirmed: true,
        token: "forbidden",
      }),
    ).toBeUndefined();
    const evidenceDigestSha256 = "a".repeat(64);
    expect(
      parseExtensionMessage({
        action: "appeal",
        confirmed: true,
        contributionId,
        evidenceDigestSha256,
      }),
    ).toEqual({ action: "appeal", confirmed: true, contributionId, evidenceDigestSha256 });
    expect(
      parseExtensionMessage({
        action: "appeal",
        confirmed: true,
        contributionId,
        evidenceText: "raw evidence",
      }),
    ).toBeUndefined();
  });

  it("accepts a fill-only apply only with the exact flag and link", () => {
    const reviewLink = "https://workspace.example.invalid/jobs?application=a&job=b";
    expect(
      parseExtensionMessage({ action: "application_native_apply", reviewLink, fillOnly: true }),
    ).toEqual({ action: "application_native_apply", reviewLink, fillOnly: true });
    expect(
      parseExtensionMessage({ action: "application_native_apply", reviewLink, fillOnly: false }),
    ).toBeUndefined();
    expect(
      parseExtensionMessage({ action: "application_native_apply", reviewLink, extra: true }),
    ).toBeUndefined();
    expect(parseExtensionMessage({ action: "application_native_apply", reviewLink })).toEqual({
      action: "application_native_apply",
      reviewLink,
    });
  });

  it("accepts the choice-step flag only on a fill-only apply, with exact values", () => {
    const reviewLink = "https://app.example/review";
    expect(
      parseExtensionMessage({
        action: "application_native_apply",
        reviewLink,
        fillOnly: true,
        skipChoices: true,
      }),
    ).toEqual({
      action: "application_native_apply",
      reviewLink,
      fillOnly: true,
      skipChoices: true,
    });
    expect(
      parseExtensionMessage({
        action: "application_native_apply",
        reviewLink,
        fillOnly: true,
        skipDraftOffer: true,
        skipChoices: true,
      }),
    ).toEqual({
      action: "application_native_apply",
      reviewLink,
      fillOnly: true,
      skipDraftOffer: true,
      skipChoices: true,
    });
    for (const bad of [
      { action: "application_native_apply", reviewLink, skipChoices: true },
      { action: "application_native_apply", reviewLink, fillOnly: true, skipChoices: "yes" },
      { action: "application_native_apply", reviewLink, fillOnly: true, skipChoices: false },
      { action: "application_native_apply", reviewLink, fillOnly: true, answers: [] },
    ])
      expect(parseExtensionMessage(bad)).toBeUndefined();
  });

  it("accepts a restricted-answer confirmation only with a link, a plain ref and a boolean", () => {
    const reviewLink = "https://app.example/review";
    expect(
      parseExtensionMessage({
        action: "application_native_choice_confirm",
        reviewLink,
        ref: "f4",
        accept: true,
      }),
    ).toEqual({ action: "application_native_choice_confirm", reviewLink, ref: "f4", accept: true });
    expect(parseExtensionMessage({ action: "application_native_choices", reviewLink })).toEqual({
      action: "application_native_choices",
      reviewLink,
    });
    for (const bad of [
      { action: "application_native_choice_confirm", reviewLink, ref: "f4" },
      { action: "application_native_choice_confirm", reviewLink, ref: "f 4", accept: true },
      { action: "application_native_choice_confirm", reviewLink, ref: "f4", accept: "yes" },
      {
        action: "application_native_choice_confirm",
        reviewLink,
        ref: "f4",
        accept: true,
        option: "Yes",
      },
      { action: "application_native_choices", reviewLink, answers: [] },
    ])
      expect(parseExtensionMessage(bad)).toBeUndefined();
  });
});
