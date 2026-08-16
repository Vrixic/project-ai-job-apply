import { describe, expect, it } from "vitest";
import {
  eventTypes,
  ingestionDispatchNudgeIntegrityInput,
  outboxNudgeIntegrityInput,
  validateDocumentScanResult,
  validateEventData,
  validateIngestionDispatchNudge,
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

  it("accepts an identifier-only entitlement change and rejects billing payload leakage", () => {
    const data = {
      entitlementAccountId: "019b4e12-7ea3-7c36-9357-aea35ab542cc",
      userId: "019b4e12-7ea3-7c36-9357-aea35ab542cd",
      version: 2,
    };

    expect(validateEventData(eventTypes.subscriptionEntitlementChanged, data)).toBe(true);
    expect(
      validateEventData(eventTypes.subscriptionEntitlementChanged, {
        ...data,
        plan: "pro",
        provider: "stripe",
        accessThrough: "2026-09-15T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      validateEventData(eventTypes.subscriptionEntitlementChanged, {
        ...data,
        version: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
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

  it("accepts an exact identifier-only ingestion dispatch and rejects payload leakage", () => {
    const nudge = {
      schemaVersion: 1 as const,
      dispatchId: "019d09f8-65ab-7b65-8b90-60d976b78f07",
      executionId: "a".repeat(64),
      checkpointRevision: 0,
      workflowGeneration: 1,
      integrity: { algorithm: "sha256" as const, digest: "b".repeat(64) },
    };
    expect(validateIngestionDispatchNudge(nudge)).toBe(true);
    expect(ingestionDispatchNudgeIntegrityInput(nudge)).toBe(
      `{"schemaVersion":1,"dispatchId":"019d09f8-65ab-7b65-8b90-60d976b78f07","executionId":"${"a".repeat(64)}","checkpointRevision":0,"workflowGeneration":1}`,
    );
    expect(
      validateIngestionDispatchNudge({ ...nudge, sourceUrl: "https://jobs.example.test" }),
    ).toBe(false);
    expect(validateIngestionDispatchNudge({ ...nudge, workflowGeneration: 21 })).toBe(false);
  });

  it("accepts an identifier-only clean document scan result", () => {
    expect(
      validateDocumentScanResult({
        schemaVersion: 1,
        eventId: "7f6e7ed8-287c-49e1-a3df-0c789ffbb1f8",
        accountId: "362544434697",
        region: "us-east-2",
        protectionPlanArn:
          "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/plan123",
        bucketName: "applydash-development-candidate-documents",
        objectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
        objectVersion: "version-1",
        scanStatus: "COMPLETED",
        scanResult: "NO_THREATS_FOUND",
        observedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects content, unknown fields, and contradictory clean results", () => {
    const base = {
      schemaVersion: 1,
      eventId: "7f6e7ed8-287c-49e1-a3df-0c789ffbb1f8",
      accountId: "362544434697",
      region: "us-east-2",
      protectionPlanArn: "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/plan123",
      bucketName: "applydash-development-candidate-documents",
      objectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
      objectVersion: "version-1",
      scanStatus: "FAILED",
      scanResult: "NO_THREATS_FOUND",
      observedAt: "2026-08-12T12:00:00.000Z",
    };
    expect(validateDocumentScanResult(base)).toBe(false);
    expect(validateDocumentScanResult({ ...base, resumeText: "secret" })).toBe(false);
  });

  it.each([
    ["SKIPPED", "UNSUPPORTED"],
    ["SKIPPED", "ACCESS_DENIED"],
    ["FAILED", "FAILED"],
  ] as const)("accepts the GuardDuty %s/%s terminal pair", (scanStatus, scanResult) => {
    expect(
      validateDocumentScanResult({
        schemaVersion: 1,
        eventId: "7f6e7ed8-287c-49e1-a3df-0c789ffbb1f8",
        accountId: "362544434697",
        region: "us-east-2",
        protectionPlanArn:
          "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/plan123",
        bucketName: "applydash-development-candidate-documents",
        objectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
        objectVersion: "version-1",
        scanStatus,
        scanResult,
        observedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects every mismatched terminal status/result pair", () => {
    const base = {
      schemaVersion: 1,
      eventId: "7f6e7ed8-287c-49e1-a3df-0c789ffbb1f8",
      accountId: "362544434697",
      region: "us-east-2",
      protectionPlanArn: "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/plan123",
      bucketName: "applydash-development-candidate-documents",
      objectKey: "quarantine/019b4e12-7ea3-7c36-9357-aea35ab542ca/source",
      objectVersion: "version-1",
      observedAt: "2026-08-12T12:00:00.000Z",
    };
    expect(
      validateDocumentScanResult({ ...base, scanStatus: "COMPLETED", scanResult: "UNSUPPORTED" }),
    ).toBe(false);
    expect(
      validateDocumentScanResult({ ...base, scanStatus: "SKIPPED", scanResult: "FAILED" }),
    ).toBe(false);
    expect(
      validateDocumentScanResult({ ...base, scanStatus: "FAILED", scanResult: "ACCESS_DENIED" }),
    ).toBe(false);
  });
});
