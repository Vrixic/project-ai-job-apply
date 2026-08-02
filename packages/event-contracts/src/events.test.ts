import { describe, expect, it } from "vitest";
import {
  eventTypes,
  outboxNudgeIntegrityInput,
  validateEventData,
  validateOutboxNudge,
} from "./index.js";

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

  it("rejects inherited-object event type names", () => {
    expect(validateEventData("__proto__", {})).toBe(false);
    expect(validateEventData("constructor", {})).toBe(false);
  });

  it("accepts a versioned identifier-only outbox nudge", () => {
    const nudge = {
      schemaVersion: 1 as const,
      eventId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
      eventType: eventTypes.profilePreferencesUpdated,
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      integrity: { algorithm: "sha256" as const, digest: "a".repeat(64) },
    };

    expect(validateOutboxNudge(nudge)).toBe(true);
    expect(outboxNudgeIntegrityInput(nudge)).toBe(
      '{"schemaVersion":1,"eventId":"019b4e12-7ea3-7c36-9357-aea35ab542ca","eventType":"profile.preferences.updated.v1","traceparent":"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}',
    );
  });

  it("rejects candidate values and unknown nudge fields", () => {
    expect(
      validateOutboxNudge({
        schemaVersion: 1,
        eventId: "019b4e12-7ea3-7c36-9357-aea35ab542ca",
        eventType: eventTypes.profilePreferencesUpdated,
        integrity: { algorithm: "sha256", digest: "a".repeat(64) },
        locations: ["New York, NY"],
      }),
    ).toBe(false);
  });
});
