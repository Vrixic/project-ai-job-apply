import { describe, expect, it } from "vitest";
import {
  isPreparationFunctionArn,
  matchesPreparationExecutionArn,
  PreparationDispatchError,
  preparationExecutionName,
} from "./preparation-dispatch.js";

const eventId = "019d04cf-1f80-7000-8000-000000000101";
const arn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-preparation:7";

describe("preparation dispatch identities", () => {
  it("derives one stable name from a canonical event UUID, including case aliases", () => {
    expect(preparationExecutionName(eventId)).toBe(`preparation-${eventId}`);
    expect(preparationExecutionName(eventId.toUpperCase())).toBe(`preparation-${eventId}`);
    expect(() => preparationExecutionName("private candidate text")).toThrow(
      PreparationDispatchError,
    );
  });
  it("permits only exact numeric function versions", () => {
    expect(isPreparationFunctionArn(arn)).toBe(true);
    for (const target of [
      arn.replace(":7", ""),
      arn.replace(":7", ":live"),
      arn.replace(":7", ":$LATEST"),
      arn.replace(":7", ":0"),
      `${arn}/extra`,
      null,
    ])
      expect(isPreparationFunctionArn(target)).toBe(false);
  });
  it("binds the ARN to exact version, event name and a bounded opaque execution ID", () => {
    const name = preparationExecutionName(eventId);
    const execution = `${arn}/durable-execution/${name}/synthetic-execution-v1`;
    expect(matchesPreparationExecutionArn(execution, arn, name)).toBe(true);
    for (const invalid of [
      execution.replace(":7/", ":8/"),
      execution.replace(eventId, "019d04cf-1f80-7000-8000-000000000102"),
      `${execution}/extra`,
      execution.replace("synthetic-execution-v1", ""),
      execution.replace("synthetic-execution-v1", "x".repeat(1_024)),
      `${execution}\n`,
    ])
      expect(matchesPreparationExecutionArn(invalid, arn, name)).toBe(false);
  });
});
