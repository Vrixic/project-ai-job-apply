import { describe, expect, it } from "vitest";
import { parseExtensionMessage } from "../lib/messages";

describe("extension message boundary", () => {
  it("accepts only exact known requests", () => {
    expect(parseExtensionMessage({ action: "status" })).toEqual({ action: "status" });
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
});
