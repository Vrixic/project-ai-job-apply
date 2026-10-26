import { describe, expect, it } from "vitest";
import { failureFields } from "./failure-fields.js";

describe("failureFields", () => {
  it("keeps only fixed-format fields, never a message", () => {
    const error = Object.assign(new Error("Key (email)=(a@b.example) already exists"), {
      name: "PostgresError",
      code: "55000",
      where: "PL/pgSQL function documents.protect_native_resume_generation() line 6 at RAISE",
    });
    expect(failureFields(error)).toEqual({
      errorName: "PostgresError",
      sqlState: "55000",
      sqlFunction: "documents.protect_native_resume_generation",
    });
  });

  it("drops anything that does not have the expected shape", () => {
    const odd = Object.assign(new Error("x"), {
      name: "bad name!",
      code: "not a code!",
      where: "line 1 of some other text with a@b.example",
      $metadata: { httpStatusCode: 99 },
    });
    expect(failureFields(odd)).toEqual({});
    expect(failureFields(undefined)).toEqual({});
    expect(failureFields("text")).toEqual({});
  });
});
