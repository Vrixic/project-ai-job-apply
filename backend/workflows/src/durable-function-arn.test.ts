import { describe, expect, it } from "vitest";
import { durableFunctionArnMatches } from "./durable-function-arn.js";

const qualified = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:19";

describe("durable execution function ARN", () => {
  it("accepts the version-qualified ARN the service returns and the unqualified base", () => {
    expect(durableFunctionArnMatches(qualified, qualified)).toBe(true);
    expect(durableFunctionArnMatches(qualified.replace(/:19$/u, ""), qualified)).toBe(true);
  });

  it("refuses another version, function, account, region or shape", () => {
    for (const other of [
      qualified.replace(/:19$/u, ":18"),
      qualified.replace("synthetic-durable", "synthetic-other"),
      qualified.replace("123456789012", "210987654321"),
      qualified.replace("us-east-2", "us-west-2"),
      `${qualified}:extra`,
      `${qualified}/durable-execution/x/y`,
      "",
    ]) {
      expect(durableFunctionArnMatches(other, qualified)).toBe(false);
    }
    for (const bad of [undefined, null, 19, {}, []]) {
      expect(durableFunctionArnMatches(bad, qualified)).toBe(false);
    }
  });
});
