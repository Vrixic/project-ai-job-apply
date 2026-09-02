import { describe, expect, it } from "vitest";
import { parseExtensionMessage } from "../lib/messages";

describe("extension message boundary", () => {
  it("accepts only exact known requests", () => {
    expect(parseExtensionMessage({ action: "status" })).toEqual({ action: "status" });
    expect(parseExtensionMessage({ action: "clear_queue" })).toEqual({ action: "clear_queue" });
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
  });
});
