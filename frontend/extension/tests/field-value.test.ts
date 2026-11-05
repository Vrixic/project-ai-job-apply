import { describe, expect, it } from "vitest";
import { writtenValueMatches } from "../lib/field-value";

const control = (value: string, type = "text") => ({
  value,
  type,
  getAttribute: (name: string) => (name === "type" ? type : null),
});

describe("writtenValueMatches", () => {
  it("accepts the exact value", () => {
    expect(writtenValueMatches(control("Ada"), "Ada")).toBe(true);
    expect(writtenValueMatches(control("Adam"), "Ada")).toBe(false);
  });
  it("accepts a phone number a widget has reformatted", () => {
    expect(writtenValueMatches(control("+1 415-555-0100", "tel"), "(415) 555-0100")).toBe(true);
    expect(writtenValueMatches(control("4155550100", "tel"), "+1 415 555 0100")).toBe(true);
    expect(writtenValueMatches(control("+1 415-555-0100", "tel"), "+14155550100")).toBe(true);
  });
  it("rejects a different or truncated phone number", () => {
    expect(writtenValueMatches(control("+1 415-555-0199", "tel"), "415-555-0100")).toBe(false);
    expect(writtenValueMatches(control("555-0100", "tel"), "415-555-0100")).toBe(false);
    expect(writtenValueMatches(control("", "tel"), "415-555-0100")).toBe(false);
  });
  it("compares other field types exactly", () => {
    expect(writtenValueMatches(control("+1 415-555-0100"), "4155550100")).toBe(false);
  });
});
