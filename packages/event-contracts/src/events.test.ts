import { describe, expect, it } from "vitest";
import { eventTypes, validateEventData } from "./index.js";

describe("event schemas", () => {
  it("accepts identifiers without candidate preference values", () => {
    expect(
      validateEventData(eventTypes.profilePreferencesUpdated, {
        preferenceSetId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        version: 1,
        operationId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
      }),
    ).toBe(true);
  });

  it("rejects unrestricted preference content", () => {
    expect(
      validateEventData(eventTypes.profilePreferencesUpdated, {
        preferenceSetId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        version: 1,
        operationId: "019b4e12-7ea3-7c36-9357-aea35ab542cb",
        targetRoles: ["Software Engineer"],
      }),
    ).toBe(false);
  });
});
