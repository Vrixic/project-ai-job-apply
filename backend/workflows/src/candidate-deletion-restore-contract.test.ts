import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CandidateDeletionRestoreConfiguration,
  type CandidateDeletionRestoreInspection,
  CURRENT_PRIMARY_RESTORE_MANIFEST_SHA256,
  CURRENT_RESTORE_MANIFEST_SHA256,
  calculateRestoreConfigurationSha256,
  loadRestoreEnvironment,
  RESTORE_CONFIGURATION_KEYS,
  RESTORE_ENVIRONMENT_KEYS,
  RESTORE_INVOCATION_BUDGET_MS,
  RESTORE_MAXIMUM_LIFETIME_MS,
  restoreDigest,
  restoreInspectionSha256,
  serializeRestoreConfiguration,
  validateRestoreCompletionDiagnosisResult,
  validateRestoreConfiguration,
  validateRestoreInspectionResult,
  validateRestoreReplayResult,
  validateRestoreRequest,
} from "./candidate-deletion-restore-contract.js";
import { ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256 } from "./candidate-deletion-restore-policy.js";

interface SyntheticFixture {
  schemaVersion: number;
  classification: string;
  now: string;
  configuration: CandidateDeletionRestoreConfiguration;
  environment: Record<string, string>;
  configurationSha256: string;
  invokedFunctionArn: string;
  inspect: Record<string, unknown>;
  replay: Record<string, unknown>;
  markerSnapshotSha256: string;
  storePreflightSha256: string;
  documentAbsenceSha256: string;
  restoredPreflightSha256: string;
  inspectionSha256: string;
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../scripts/tests/fixtures/candidate-deletion-restore-contract.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as SyntheticFixture;
const now = new Date(fixture.now);
const catalogSha256 = ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256;
const configurationError = "CandidateDeletionRestoreConfigurationRejected";
const environmentError = "CandidateDeletionRestoreEnvironmentRejected";
const requestError = "CandidateDeletionRestoreRequestRejected";

function configuration(
  mutation: Record<string, unknown> = {},
): CandidateDeletionRestoreConfiguration {
  return { ...fixture.configuration, ...mutation };
}

function environment(
  mutation: Record<string, string | undefined> = {},
  rehash = true,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...fixture.environment, ...mutation };
  if (rehash) result.RESTORE_REPLAY_CONFIG_SHA256 = calculateRestoreConfigurationSha256(result);
  return result;
}

function inspection(): CandidateDeletionRestoreInspection {
  return {
    schemaVersion: 1,
    action: "inspect",
    outcome: "inspected",
    runId: fixture.configuration.runId,
    sourceSha: fixture.configuration.sourceSha,
    configurationSha256: fixture.configurationSha256,
    functionVersion: "1",
    expiresAt: fixture.configuration.expiresAt,
    markerSnapshotSha256: fixture.markerSnapshotSha256,
    restoredPreflightSha256: fixture.restoredPreflightSha256,
    inspectionSha256: fixture.inspectionSha256,
    markersValidated: 2,
    historicalPolicyMarkers: 1,
    currentPolicyMarkers: 1,
    restoredSubjectsPresent: 1,
    restoredSubjectsAbsent: 1,
    documentKeysChecked: 2,
    documentVersionsObserved: 0,
  };
}

function replayResult() {
  return {
    ...inspection(),
    action: "replay",
    outcome: "replayed",
    restoredUsersReconciled: 1,
    restoredUsersAbsent: 1,
    restoredUsersAlreadyReconciled: 0,
    s3Writes: 0,
    recoveryLedgerWrites: 0,
    identityProviderCalls: 0,
  };
}

describe("cross-runtime restore contract fixture", () => {
  it("accepts bounded committed preservation evidence and rejects partial or extra fields", () => {
    const digest = { sha256: "a".repeat(64), relationCount: 105, rowCount: 12, byteCount: 240 };
    const preservation = { schemaVersion: 1, unchanged: digest, reconciled: digest };
    expect(validateRestoreReplayResult({ ...replayResult(), preservation })).toBe(true);
    for (const mutation of [
      { relationCount: 95 },
      { rowCount: 100001 },
      { byteCount: 67108865 },
      { sha256: "invalid" },
      { extra: true },
    ]) {
      expect(
        validateRestoreReplayResult({
          ...replayResult(),
          preservation: { ...preservation, unchanged: { ...digest, ...mutation } },
        }),
      ).toBe(false);
    }
    expect(
      validateRestoreReplayResult({ ...replayResult(), preservation: { unchanged: digest } }),
    ).toBe(false);
    expect(validateRestoreInspectionResult({ ...inspection(), preservation })).toBe(false);
  });

  it("binds the generated fixture, actual policy catalog, canonical environment and request hashes", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.classification).toBe("generated-synthetic-no-live-identity");
    expect(fixture.configuration.acceptedPolicyCatalogSha256).toBe(catalogSha256);
    expect(Object.keys(fixture.configuration)).toEqual([...RESTORE_CONFIGURATION_KEYS]);
    expect(serializeRestoreConfiguration(configuration())).toBe(
      fixture.environment.RESTORE_REPLAY_CONFIG_JSON,
    );
    expect(calculateRestoreConfigurationSha256(fixture.environment)).toBe(
      fixture.configurationSha256,
    );
    expect(loadRestoreEnvironment(environment(), catalogSha256, now)).toEqual({
      configuration: fixture.configuration,
      configurationSha256: fixture.configurationSha256,
    });
    expect(
      validateRestoreRequest(
        { ...fixture.inspect },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toEqual(fixture.inspect);
    expect(
      validateRestoreRequest(
        { ...fixture.replay },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toEqual(fixture.replay);
  });

  it("binds primary recovery to current 87-migration source while retaining the isolated fixture", () => {
    const bytes = readFileSync(
      new URL("../../services/database-migrations/restore-manifest.v1.json", import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      CURRENT_PRIMARY_RESTORE_MANIFEST_SHA256,
    );
    const manifest = JSON.parse(bytes.toString("utf8"));
    expect(
      manifest.contributors.flatMap((owner: { migrations: unknown[] }) => owner.migrations),
    ).toHaveLength(87);
    expect(
      manifest.contributors
        .find((owner: { owner: string }) => owner.owner === "documents")
        .migrations.at(-1).version,
    ).toBe("0018_native_resume_legacy_launch_rejection");
    expect(fixture.configuration.restoreManifestSha256).toBe(CURRENT_RESTORE_MANIFEST_SHA256);
  });

  it("agrees with independently framed SHA256 and composed preflight/inspection fixtures", () => {
    const pairs = RESTORE_ENVIRONMENT_KEYS.filter((key) => key !== "RESTORE_REPLAY_CONFIG_SHA256")
      .sort()
      .map((key) => [key, fixture.environment[key]]);
    expect(
      createHash("sha256")
        .update(`candidate-deletion-restore-configuration-v1\n${JSON.stringify(pairs)}\n`, "utf8")
        .digest("hex"),
    ).toBe(fixture.configurationSha256);
    expect(
      restoreDigest("candidate-deletion-restore-preflight-v1", [
        fixture.storePreflightSha256,
        fixture.documentAbsenceSha256,
      ]),
    ).toBe(fixture.restoredPreflightSha256);
    expect(
      restoreInspectionSha256(
        fixture.configurationSha256,
        fixture.markerSnapshotSha256,
        fixture.restoredPreflightSha256,
      ),
    ).toBe(fixture.inspectionSha256);
    expect(restoreDigest("another-domain", pairs)).not.toBe(fixture.configurationSha256);
  });

  it("uses stable explicit configuration order and excludes only its self-referential digest", () => {
    const reordered = Object.fromEntries(
      Object.entries(configuration()).reverse(),
    ) as unknown as CandidateDeletionRestoreConfiguration;
    expect(serializeRestoreConfiguration(reordered)).toBe(
      fixture.environment.RESTORE_REPLAY_CONFIG_JSON,
    );
    const reorderedEnvironment = Object.fromEntries(Object.entries(fixture.environment).reverse());
    expect(calculateRestoreConfigurationSha256(reorderedEnvironment)).toBe(
      fixture.configurationSha256,
    );
    expect(
      calculateRestoreConfigurationSha256({
        ...reorderedEnvironment,
        RESTORE_REPLAY_CONFIG_SHA256: "a".repeat(64),
      }),
    ).toBe(fixture.configurationSha256);
  });
});

describe("restore configuration strict isolated target", () => {
  it("freezes valid configuration and accepts the exact invocation budget boundary", () => {
    const result = validateRestoreConfiguration(configuration(), catalogSha256, now);
    expect(Object.isFrozen(result)).toBe(true);
    expect(RESTORE_MAXIMUM_LIFETIME_MS).toBe(30 * 60_000);
    expect(RESTORE_INVOCATION_BUDGET_MS).toBe(300_000);
    const exactBudget = new Date(
      Date.parse(fixture.configuration.expiresAt) - RESTORE_INVOCATION_BUDGET_MS,
    );
    expect(validateRestoreConfiguration(configuration(), catalogSha256, exactBudget)).toEqual(
      fixture.configuration,
    );
  });

  it.each(RESTORE_CONFIGURATION_KEYS)("rejects missing %s", (key) => {
    const value: Record<string, unknown> = { ...configuration() };
    delete value[key];
    expect(() => validateRestoreConfiguration(value, catalogSha256, now)).toThrow(
      configurationError,
    );
  });

  it.each([
    ["extra arbitrary SQL", { sql: "SELECT 'synthetic'" }],
    ["candidate locator", { userId: "synthetic-not-allowed" }],
    ["schema version", { schemaVersion: 2 }],
    ["malformed run ID", { runId: "run" }],
    ["uppercase run ID", { runId: "A".repeat(32) }],
    ["short account", { accountId: "12345678901" }],
    ["wrong region", { region: "us-east-1" }],
    ["malformed source SHA", { sourceSha: "a".repeat(39) }],
    ["uppercase source SHA", { sourceSha: "A".repeat(40) }],
    ["source SHA whitespace", { sourceSha: `${"a".repeat(40)}\n` }],
    ["wrong source identifier", { sourceIdentifier: "ai-job-apply-staging" }],
    ["wrong source resource shape", { sourceDbiResourceId: "db-lowercase" }],
    ["wrong target resource shape", { targetDbiResourceId: "db-small" }],
    ["same DB resource", { targetDbiResourceId: fixture.configuration.sourceDbiResourceId }],
    ["same boundary hash", { targetBoundarySha256: fixture.configuration.sourceBoundarySha256 }],
    ["live target identifier", { targetIdentifier: "ai-job-apply-development" }],
    [
      "staging target identifier",
      { targetIdentifier: "ai-job-apply-staging-restore-20260908000000" },
    ],
    ["arbitrary target identifier", { targetIdentifier: "arbitrary-target" }],
    ["live source host reused", { targetHostname: fixture.configuration.sourceHostname }],
    [
      "wrong target-host identity",
      {
        targetHostname:
          "ai-job-apply-development-restore-20260908000001.abcdefghijkl.us-east-2.rds.amazonaws.com",
      },
    ],
    [
      "wrong source-host identity",
      { sourceHostname: "other-development.abcdefghijkl.us-east-2.rds.amazonaws.com" },
    ],
    ["local host", { targetHostname: "localhost" }],
    [
      "URL instead of hostname",
      { targetHostname: `https://${fixture.configuration.targetHostname}` },
    ],
    [
      "wrong host region",
      { targetHostname: fixture.configuration.targetHostname.replace("us-east-2", "us-east-1") },
    ],
    [
      "malicious host suffix",
      { targetHostname: `${fixture.configuration.targetHostname}.invalid` },
    ],
    ["hostname whitespace", { targetHostname: `${fixture.configuration.targetHostname} ` }],
    ["wrong database", { databaseName: "postgres" }],
    ["wrong port", { databasePort: 5433 }],
    ["string port", { databasePort: "5432" }],
    ["unknown manifest", { restoreManifestSha256: "a".repeat(64) }],
    ["unknown policy catalog", { acceptedPolicyCatalogSha256: "a".repeat(64) }],
    ["nonhex context", { restoreContextSha256: "g".repeat(64) }],
    ["newline boundary", { sourceBoundarySha256: `${"a".repeat(64)}\n` }],
    ["invalid issue date", { issuedAt: "2026-02-30T00:00:00.000Z" }],
    ["noncanonical issue date", { issuedAt: "2026-09-08T00:00:00Z" }],
    ["offset issue date", { issuedAt: "2026-09-08T00:00:00.000+00:00" }],
    ["future issue date", { issuedAt: "2026-09-08T00:02:00.000Z" }],
    ["expiry before issue", { expiresAt: "2026-09-07T23:59:00.000Z" }],
    ["expiry equal to issue", { expiresAt: fixture.configuration.issuedAt }],
    ["overlong approval window", { expiresAt: "2026-09-08T00:30:00.001Z" }],
    ["insufficient invocation time", { expiresAt: "2026-09-08T00:05:59.999Z" }],
    ["expiry whitespace", { expiresAt: `${fixture.configuration.expiresAt}\n` }],
  ])("rejects %s", (_label, mutation) => {
    expect(() => validateRestoreConfiguration(configuration(mutation), catalogSha256, now)).toThrow(
      configurationError,
    );
  });

  it.each([null, [], "configuration", 1, false])("rejects non-object configuration %j", (value) => {
    expect(() => validateRestoreConfiguration(value, catalogSha256, now)).toThrow(
      configurationError,
    );
  });

  it("rejects invalid, expired and spoofed current dates and catalog identities", () => {
    expect(() =>
      validateRestoreConfiguration(configuration(), catalogSha256, new Date(Number.NaN)),
    ).toThrow(configurationError);
    expect(() =>
      validateRestoreConfiguration(
        configuration(),
        catalogSha256,
        new Date(fixture.configuration.expiresAt),
      ),
    ).toThrow(configurationError);
    expect(() => validateRestoreConfiguration(configuration(), "a".repeat(63), now)).toThrow(
      configurationError,
    );
    expect(() => validateRestoreConfiguration(configuration(), `${catalogSha256}\n`, now)).toThrow(
      configurationError,
    );
    const spoofed = new Date("2099-01-01T00:00:00.000Z");
    spoofed.getTime = () => now.getTime();
    expect(() => validateRestoreConfiguration(configuration(), catalogSha256, spoofed)).toThrow(
      configurationError,
    );
  });
});

describe("restore immutable environment binding", () => {
  it("allows standard Lambda reserved credentials and platform ambient values without hashing secret values", () => {
    const value = environment({
      AWS_REGION: "us-east-2",
      AWS_DEFAULT_REGION: "us-east-2",
      AWS_ACCESS_KEY_ID: "synthetic-key",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret",
      AWS_SESSION_TOKEN: "synthetic-session",
      AWS_LAMBDA_FUNCTION_NAME: "synthetic-function",
      PATH: "synthetic-path",
    });
    expect(loadRestoreEnvironment(value, catalogSha256, now).configurationSha256).toBe(
      fixture.configurationSha256,
    );
  });

  it.each(RESTORE_ENVIRONMENT_KEYS)("rejects missing %s", (key) => {
    expect(() =>
      loadRestoreEnvironment(environment({ [key]: undefined }, false), catalogSha256, now),
    ).toThrow(environmentError);
  });

  it.each([
    "DATABASE_URL",
    "DATABASE_PASSWORD",
    "CANDIDATE_RIGHTS_POLICY_VERSION",
    "RESTORE_TARGET_HOST",
    "AUTH0_DOMAIN",
    "OIDC_ISSUER",
    "D2_VERIFICATION_CLIENT_SECRET",
    "PGHOST",
    "PGPASSWORD",
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_S3",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "AWS_EC2_METADATA_SERVICE_ENDPOINT",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_CONFIG_FILE",
    "NODE_OPTIONS",
  ])("rejects ambient override %s", (key) => {
    expect(() =>
      loadRestoreEnvironment(
        environment({ [key]: "synthetic-unapproved-override" }),
        catalogSha256,
        now,
      ),
    ).toThrow(environmentError);
  });

  it.each([
    ["nonproduction runtime", { NODE_ENV: "development" }],
    ["short release SHA", { RELEASE_SHA: "b".repeat(40) }],
    ["uppercase release SHA", { RELEASE_SHA: "B".repeat(64) }],
    ["trailing release whitespace", { RELEASE_SHA: `${"b".repeat(64)}\n` }],
    ["document bucket URL", { CANDIDATE_DOCUMENT_BUCKET: "https://synthetic.example" }],
    [
      "same document/ledger bucket",
      { CANDIDATE_DOCUMENT_BUCKET: fixture.environment.CANDIDATE_DELETION_RECOVERY_BUCKET },
    ],
    ["wrong region", { AWS_REGION: "us-west-2" }],
    ["wrong default region", { AWS_DEFAULT_REGION: "us-west-2" }],
    [
      "secret in another account",
      {
        DATABASE_SECRET_ID: fixture.environment.DATABASE_SECRET_ID?.replace(
          "123456789012",
          "999999999999",
        ),
      },
    ],
    [
      "secret in another region",
      {
        DATABASE_SECRET_ID: fixture.environment.DATABASE_SECRET_ID?.replace(
          "us-east-2",
          "us-east-1",
        ),
      },
    ],
    [
      "database URL secret override",
      { DATABASE_SECRET_ID: "postgres://synthetic:synthetic@localhost/test" },
    ],
    [
      "secret ARN whitespace",
      { DATABASE_SECRET_ID: `${fixture.environment.DATABASE_SECRET_ID}\n` },
    ],
    [
      "KMS key in another account",
      {
        CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN:
          fixture.environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN?.replace(
            "123456789012",
            "999999999999",
          ),
      },
    ],
    [
      "KMS alias",
      {
        CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN:
          "arn:aws:kms:us-east-2:123456789012:alias/synthetic",
      },
    ],
    [
      "KMS key whitespace",
      {
        CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN: `${fixture.environment.CANDIDATE_DELETION_RECOVERY_KMS_KEY_ARN}\n`,
      },
    ],
    ["malformed JSON", { RESTORE_REPLAY_CONFIG_JSON: "{" }],
    ["JSON null", { RESTORE_REPLAY_CONFIG_JSON: "null" }],
    ["oversized JSON", { RESTORE_REPLAY_CONFIG_JSON: "x".repeat(3_073) }],
    [
      "trailing JSON whitespace",
      { RESTORE_REPLAY_CONFIG_JSON: `${fixture.environment.RESTORE_REPLAY_CONFIG_JSON}\n` },
    ],
    [
      "pretty-printed JSON",
      { RESTORE_REPLAY_CONFIG_JSON: JSON.stringify(configuration(), null, 2) },
    ],
    [
      "duplicated JSON key",
      {
        RESTORE_REPLAY_CONFIG_JSON: fixture.environment.RESTORE_REPLAY_CONFIG_JSON?.replace(
          '"schemaVersion":1',
          '"schemaVersion":1,"schemaVersion":1',
        ),
      },
    ],
    [
      "reordered JSON",
      {
        RESTORE_REPLAY_CONFIG_JSON: JSON.stringify(
          Object.fromEntries(Object.entries(configuration()).reverse()),
        ),
      },
    ],
  ])("rejects %s even with a recomputed outer digest", (_label, mutation) => {
    expect(() => loadRestoreEnvironment(environment(mutation), catalogSha256, now)).toThrow();
  });

  it("rejects otherwise-valid source or target substitutions when the reviewed hash is unchanged", () => {
    for (const mutation of [
      { sourceSha: "f".repeat(40) },
      { targetDbiResourceId: "db-SYNTHETICREPLACEMENT12345" },
      { sourceDbiResourceId: "db-SYNTHETICREPLACEMENT12345" },
    ]) {
      const value = environment(
        { RESTORE_REPLAY_CONFIG_JSON: serializeRestoreConfiguration(configuration(mutation)) },
        false,
      );
      expect(() => loadRestoreEnvironment(value, catalogSha256, now)).toThrow(environmentError);
    }
    expect(() =>
      loadRestoreEnvironment(
        environment({ RESTORE_REPLAY_CONFIG_SHA256: "a".repeat(64) }, false),
        catalogSha256,
        now,
      ),
    ).toThrow(environmentError);
  });

  it("rejects excessive total environment bytes before processing a secret reference", () => {
    expect(() =>
      loadRestoreEnvironment(
        environment({ DATABASE_SECRET_ID: "a".repeat(4_096) }),
        catalogSha256,
        now,
      ),
    ).toThrow(environmentError);
  });
});

describe("restore request exact numeric-version invocation", () => {
  it("accepts/freeze only the exact numeric qualified ARN", () => {
    expect(
      Object.isFrozen(
        validateRestoreRequest(
          { ...fixture.inspect },
          configuration(),
          fixture.configurationSha256,
          fixture.invokedFunctionArn,
        ),
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(
        validateRestoreRequest(
          { ...fixture.replay },
          configuration(),
          fixture.configurationSha256,
          fixture.invokedFunctionArn,
        ),
      ),
    ).toBe(true);
  });

  it.each([
    ["unknown action", { action: "delete" }],
    ["wrong run", { runId: "a".repeat(32) }],
    ["wrong config hash", { configurationSha256: "a".repeat(64) }],
    ["wrong schema", { schemaVersion: 2 }],
    ["extra candidate", { userId: "synthetic" }],
    ["extra SQL", { sql: "synthetic" }],
    ["caller database", { targetHostname: "synthetic" }],
    ["latest", { functionVersion: "$LATEST" }],
    ["alias", { functionVersion: "live" }],
    ["zero", { functionVersion: "0" }],
    ["leading zero", { functionVersion: "01" }],
    ["numeric type", { functionVersion: 1 }],
    ["negative", { functionVersion: "-1" }],
    ["oversized version", { functionVersion: "1".repeat(11) }],
    ["version whitespace", { functionVersion: "1\n" }],
  ])("rejects %s", (_label, mutation) => {
    expect(() =>
      validateRestoreRequest(
        { ...fixture.inspect, ...mutation },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
  });

  it.each(["schemaVersion", "action", "runId", "configurationSha256", "functionVersion"])(
    "rejects missing request %s",
    (key) => {
      const request = { ...fixture.inspect };
      delete request[key];
      expect(() =>
        validateRestoreRequest(
          request,
          configuration(),
          fixture.configurationSha256,
          fixture.invokedFunctionArn,
        ),
      ).toThrow(requestError);
    },
  );

  it.each([
    fixture.invokedFunctionArn.replace(/:1$/u, ""),
    fixture.invokedFunctionArn.replace(/:1$/u, ":$LATEST"),
    fixture.invokedFunctionArn.replace(/:1$/u, ":live"),
    fixture.invokedFunctionArn.replace(/:1$/u, ":2"),
    fixture.invokedFunctionArn.replace("us-east-2", "us-east-1"),
    fixture.invokedFunctionArn.replace("123456789012", "999999999999"),
    fixture.invokedFunctionArn.replace(fixture.configuration.runId, "a".repeat(32)),
    `${fixture.invokedFunctionArn}\n`,
  ])("rejects wrong or unqualified invoked ARN %s", (arn) => {
    expect(() =>
      validateRestoreRequest(
        { ...fixture.inspect },
        configuration(),
        fixture.configurationSha256,
        arn,
      ),
    ).toThrow(requestError);
  });

  it.each([
    undefined,
    "",
    "a".repeat(63),
    "A".repeat(64),
    `${"a".repeat(64)}\n`,
    ` ${"a".repeat(64)}`,
  ])("requires an exact reviewed inspection digest %j", (reviewedInspectionSha256) => {
    expect(() =>
      validateRestoreRequest(
        { ...fixture.replay, reviewedInspectionSha256 },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
  });

  it("does not let inspect carry replay approval or arbitrary nested transport payload", () => {
    expect(() =>
      validateRestoreRequest(
        { ...fixture.inspect, reviewedInspectionSha256: fixture.inspectionSha256 },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
    expect(() =>
      validateRestoreRequest(
        { ...fixture.replay, entries: [] },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
    expect(() =>
      validateRestoreRequest(
        [fixture.inspect],
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
  });
});

describe("restore inspection digest and aggregate response schemas", () => {
  it.each([0, 1, 2])(
    "binds digest component %s and rejects malformed/whitespace values",
    (index) => {
      const original = [
        fixture.configurationSha256,
        fixture.markerSnapshotSha256,
        fixture.restoredPreflightSha256,
      ];
      for (const malformed of [
        "",
        "a".repeat(63),
        "A".repeat(64),
        `${"a".repeat(64)}\n`,
        ` ${"a".repeat(64)}`,
      ]) {
        const parts = [...original];
        parts[index] = malformed;
        expect(() =>
          restoreInspectionSha256(parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""),
        ).toThrow("CandidateDeletionRestoreInspectionRejected");
      }
      original[index] = "f".repeat(64);
      expect(
        restoreInspectionSha256(original[0] ?? "", original[1] ?? "", original[2] ?? ""),
      ).not.toBe(fixture.inspectionSha256);
    },
  );

  it("accepts only aggregate inspection/replay results and fixed zero cloud-write counts", () => {
    expect(validateRestoreInspectionResult(inspection())).toBe(true);
    expect(validateRestoreReplayResult(replayResult())).toBe(true);
    expect(validateRestoreInspectionResult(replayResult())).toBe(false);
    expect(validateRestoreReplayResult(inspection())).toBe(false);
    for (const key of ["s3Writes", "recoveryLedgerWrites", "identityProviderCalls"]) {
      expect(validateRestoreReplayResult({ ...replayResult(), [key]: 1 })).toBe(false);
    }
  });

  it.each([
    "entries",
    "userId",
    "documentObjects",
    "sourceObjectKey",
    "credentials",
    "query",
    "unexpected",
  ])("rejects response extras %s", (key) => {
    expect(
      validateRestoreInspectionResult({ ...inspection(), [key]: "forbidden-synthetic-field" }),
    ).toBe(false);
    expect(
      validateRestoreReplayResult({ ...replayResult(), [key]: "forbidden-synthetic-field" }),
    ).toBe(false);
  });

  it("requires every declared result field", () => {
    for (const key of Object.keys(inspection())) {
      const result: Record<string, unknown> = { ...inspection() };
      delete result[key];
      expect(validateRestoreInspectionResult(result)).toBe(false);
    }
    for (const key of Object.keys(replayResult())) {
      const result: Record<string, unknown> = { ...replayResult() };
      delete result[key];
      expect(validateRestoreReplayResult(result)).toBe(false);
    }
  });

  it.each([
    "markersValidated",
    "historicalPolicyMarkers",
    "currentPolicyMarkers",
    "restoredSubjectsPresent",
    "restoredSubjectsAbsent",
  ])("bounds aggregate counter %s", (key) => {
    for (const invalid of [-1, 0.5, 1_001, "1"]) {
      expect(validateRestoreInspectionResult({ ...inspection(), [key]: invalid })).toBe(false);
      expect(validateRestoreReplayResult({ ...replayResult(), [key]: invalid })).toBe(false);
    }
  });

  it("bounds documents, reconciliation counts and zero observed cloud versions", () => {
    expect(validateRestoreInspectionResult({ ...inspection(), documentKeysChecked: 20_001 })).toBe(
      false,
    );
    expect(validateRestoreInspectionResult({ ...inspection(), documentVersionsObserved: 1 })).toBe(
      false,
    );
    for (const key of [
      "restoredUsersReconciled",
      "restoredUsersAbsent",
      "restoredUsersAlreadyReconciled",
    ]) {
      expect(validateRestoreReplayResult({ ...replayResult(), [key]: 1_001 })).toBe(false);
      expect(validateRestoreReplayResult({ ...replayResult(), [key]: -1 })).toBe(false);
    }
  });

  it.each([
    "runId",
    "sourceSha",
    "configurationSha256",
    "functionVersion",
    "expiresAt",
    "markerSnapshotSha256",
    "restoredPreflightSha256",
    "inspectionSha256",
  ])("rejects trailing newline in response %s", (key) => {
    const source = inspection() as unknown as Record<string, unknown>;
    expect(validateRestoreInspectionResult({ ...source, [key]: `${source[key]}\n` })).toBe(false);
    expect(validateRestoreReplayResult({ ...replayResult(), [key]: `${source[key]}\n` })).toBe(
      false,
    );
  });
});

describe("private completion diagnosis transport", () => {
  function request() {
    return { ...fixture.inspect, action: "diagnose_completion" };
  }
  function result() {
    return {
      schemaVersion: 1,
      action: "diagnose_completion",
      outcome: "persisted_candidate",
      runId: fixture.configuration.runId,
      sourceSha: fixture.configuration.sourceSha,
      configurationSha256: fixture.configurationSha256,
      functionVersion: "1",
      expiresAt: fixture.configuration.expiresAt,
      markerSnapshotSha256: fixture.markerSnapshotSha256,
      markersValidated: 1,
      comparison: {
        requestMatchesTag: false,
        ledgerMatchesTag: false,
        persistedPairAgrees: true,
        completionCollisions: ["request_completion_mismatch", "ledger_completion_mismatch"],
      },
      reason: null,
      corroboration: "persisted_transaction",
      candidate: {
        correctedCompletedAt: fixture.configuration.issuedAt,
        evidenceSha256: "a".repeat(64),
        candidateSha256: "b".repeat(64),
      },
      dispatchEvidence: null,
      databaseWrites: 0,
      s3Writes: 0,
      recoveryLedgerWrites: 0,
      identityProviderCalls: 0,
    };
  }

  it("uses the exact existing five request bindings and numeric invocation identity", () => {
    const value = validateRestoreRequest(
      request(),
      configuration(),
      fixture.configurationSha256,
      fixture.invokedFunctionArn,
    );
    expect(value).toEqual(request());
    expect(Object.isFrozen(value)).toBe(true);
    for (const key of Object.keys(request())) {
      const changed: Record<string, unknown> = request();
      delete changed[key];
      expect(() =>
        validateRestoreRequest(
          changed,
          configuration(),
          fixture.configurationSha256,
          fixture.invokedFunctionArn,
        ),
      ).toThrow(requestError);
    }
    for (const arn of [
      fixture.invokedFunctionArn.replace(/:1$/u, ""),
      fixture.invokedFunctionArn.replace(/:1$/u, ":2"),
      fixture.invokedFunctionArn.replace("us-east-2", "us-east-1"),
    ]) {
      expect(() =>
        validateRestoreRequest(request(), configuration(), fixture.configurationSha256, arn),
      ).toThrow(requestError);
    }
  });

  function dispatchEvidence(attemptCount = 1) {
    return {
      status: "acknowledged_unclaimed",
      attemptCount,
      bindingSha256: ["c".repeat(64), "d".repeat(64), "e".repeat(64)].slice(0, attemptCount),
      latestCreatedAt: fixture.configuration.issuedAt.replace(/Z$/u, "000Z"),
      latestAcknowledgedAt: fixture.configuration.issuedAt.replace(/Z$/u, "000Z"),
    };
  }

  it.each([1, 2, 3])(
    "accepts only %i opaque acknowledged dispatch bindings, never approval",
    (count) => {
      const response = { ...result(), dispatchEvidence: dispatchEvidence(count) };
      expect(validateRestoreCompletionDiagnosisResult(response)).toBe(true);
      expect(validateRestoreInspectionResult(response)).toBe(false);
      expect(validateRestoreReplayResult(response)).toBe(false);
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...response,
          outcome: "consistent",
          candidate: null,
          corroboration: null,
          comparison: {
            requestMatchesTag: true,
            ledgerMatchesTag: true,
            persistedPairAgrees: true,
            completionCollisions: [],
          },
        }),
      ).toBe(true);
    },
  );

  it("keeps unavailable dispatch evidence null and never attaches it to a refusal", () => {
    expect(validateRestoreCompletionDiagnosisResult(result())).toBe(true);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        outcome: "refused",
        candidate: null,
        corroboration: null,
        reason: "dispatch_corroboration_missing",
        dispatchEvidence: dispatchEvidence(),
      }),
    ).toBe(false);
    for (const dispatch of [undefined, [], {}, false, 0, "synthetic-secret-sentinel"]) {
      expect(
        validateRestoreCompletionDiagnosisResult({ ...result(), dispatchEvidence: dispatch }),
      ).toBe(false);
    }
  });

  it("requires every exact dispatch field and rejects execution locators, rows and raw proof", () => {
    for (const key of Object.keys(dispatchEvidence())) {
      const dispatch: Record<string, unknown> = dispatchEvidence();
      delete dispatch[key];
      expect(
        validateRestoreCompletionDiagnosisResult({ ...result(), dispatchEvidence: dispatch }),
      ).toBe(false);
    }
    for (const key of [
      "executionName",
      "executionArn",
      "operationId",
      "eventId",
      "rows",
      "sql",
      "credentials",
      "writerExclusionProof",
      "restoreTime",
    ]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          dispatchEvidence: { ...dispatchEvidence(), [key]: "synthetic-secret-sentinel" },
        }),
      ).toBe(false);
    }
  });

  it("rejects untyped, out-of-range, duplicate, unordered and mismatched dispatch inventories", () => {
    for (const attemptCount of [-1, 0, 4, 1.5, "1", true, null, [], {}]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          dispatchEvidence: { ...dispatchEvidence(), attemptCount },
        }),
      ).toBe(false);
    }
    for (const bindingSha256 of [
      [],
      null,
      "c".repeat(64),
      ["c".repeat(64), "d".repeat(64)],
      ["C".repeat(64)],
      ["c".repeat(63)],
      [`${"c".repeat(64)}\n`],
      [null],
      [{}],
      [["c".repeat(64)]],
      ["synthetic-secret-sentinel"],
    ]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          dispatchEvidence: { ...dispatchEvidence(), bindingSha256 },
        }),
      ).toBe(false);
    }
    for (const bindingSha256 of [
      ["c".repeat(64), "c".repeat(64)],
      ["d".repeat(64), "c".repeat(64)],
    ]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          dispatchEvidence: { ...dispatchEvidence(2), bindingSha256 },
        }),
      ).toBe(false);
    }
    for (const status of [
      "pending",
      "acknowledged_unclaimed\n",
      "synthetic-secret-sentinel",
      null,
      [],
    ]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          dispatchEvidence: { ...dispatchEvidence(), status },
        }),
      ).toBe(false);
    }
  });

  it("preserves canonical microsecond dispatch clocks without truncation or invented cutoff", () => {
    for (const key of ["latestCreatedAt", "latestAcknowledgedAt"]) {
      for (const value of [
        "2026-02-30T00:00:00.000000Z",
        "2026-09-08T00:00:00Z",
        "2026-09-08T00:00:00.000Z",
        "2026-09-08T00:00:00.0000001Z",
        "2026-09-08T00:00:00.000000+00:00",
        "2026-09-08T00:00:00.000000Z\n",
        "0000-01-01T00:00:00.000000Z",
        "2099-01-01T00:00:00.000000Z",
        null,
        [],
        {},
      ]) {
        expect(
          validateRestoreCompletionDiagnosisResult({
            ...result(),
            dispatchEvidence: { ...dispatchEvidence(), [key]: value },
          }),
        ).toBe(false);
      }
    }
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        dispatchEvidence: {
          ...dispatchEvidence(),
          latestCreatedAt: fixture.configuration.expiresAt.replace(/Z$/u, "000Z"),
        },
      }),
    ).toBe(false);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        dispatchEvidence: {
          ...dispatchEvidence(),
          latestAcknowledgedAt: fixture.configuration.expiresAt.replace(/Z$/u, "000Z"),
        },
      }),
    ).toBe(true);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        dispatchEvidence: {
          ...dispatchEvidence(),
          latestCreatedAt: fixture.configuration.issuedAt.replace(/Z$/u, "123Z"),
          latestAcknowledgedAt: fixture.configuration.issuedAt.replace(/Z$/u, "456Z"),
        },
      }),
    ).toBe(true);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        dispatchEvidence: {
          ...dispatchEvidence(),
          latestCreatedAt: fixture.configuration.issuedAt.replace(/Z$/u, "001Z"),
        },
      }),
    ).toBe(false);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        dispatchEvidence: {
          ...dispatchEvidence(),
          latestAcknowledgedAt: fixture.configuration.expiresAt.replace(/Z$/u, "001Z"),
        },
      }),
    ).toBe(false);
  });

  it.each([
    "userId",
    "requestId",
    "key",
    "versionId",
    "sql",
    "targetHostname",
    "reviewedInspectionSha256",
  ])("rejects diagnostic request extra %s", (key) => {
    expect(() =>
      validateRestoreRequest(
        { ...request(), [key]: "synthetic-secret-sentinel" },
        configuration(),
        fixture.configurationSha256,
        fixture.invokedFunctionArn,
      ),
    ).toThrow(requestError);
  });

  it("accepts fixed candidate, consistent and early refusal shapes separately from Inspect/Replay", () => {
    expect(validateRestoreCompletionDiagnosisResult(result())).toBe(true);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        outcome: "consistent",
        candidate: null,
        corroboration: null,
        comparison: {
          requestMatchesTag: true,
          ledgerMatchesTag: true,
          persistedPairAgrees: true,
          completionCollisions: [],
        },
      }),
    ).toBe(true);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        outcome: "refused",
        candidate: null,
        corroboration: null,
        comparison: null,
        reason: "row_cardinality",
      }),
    ).toBe(true);
    expect(validateRestoreInspectionResult(result())).toBe(false);
    expect(validateRestoreReplayResult(result())).toBe(false);
    expect(validateRestoreCompletionDiagnosisResult(inspection())).toBe(false);
    expect(validateRestoreCompletionDiagnosisResult(replayResult())).toBe(false);
  });

  it("requires every result and candidate field and rejects all locator/row/secret additions", () => {
    for (const key of Object.keys(result())) {
      const changed: Record<string, unknown> = result();
      delete changed[key];
      expect(validateRestoreCompletionDiagnosisResult(changed)).toBe(false);
    }
    for (const key of Object.keys(result().candidate)) {
      const candidate: Record<string, unknown> = { ...result().candidate };
      delete candidate[key];
      expect(validateRestoreCompletionDiagnosisResult({ ...result(), candidate })).toBe(false);
    }
    for (const key of [
      "bucketName",
      "key",
      "versionId",
      "userId",
      "rows",
      "sql",
      "credentials",
      "inspectionSha256",
    ]) {
      const secret = "synthetic-secret-sentinel";
      expect(validateRestoreCompletionDiagnosisResult({ ...result(), [key]: secret })).toBe(false);
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          candidate: { ...result().candidate, [key]: secret },
        }),
      ).toBe(false);
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          comparison: { ...result().comparison, [key]: secret },
        }),
      ).toBe(false);
    }
  });

  it("requires exactly one marker and zero writes with real scalar numeric types", () => {
    for (const key of [
      "markersValidated",
      "databaseWrites",
      "s3Writes",
      "recoveryLedgerWrites",
      "identityProviderCalls",
    ]) {
      for (const bad of [-1, 2, 1.5, "0", null, [], {}]) {
        expect(validateRestoreCompletionDiagnosisResult({ ...result(), [key]: bad })).toBe(false);
      }
    }
    expect(validateRestoreCompletionDiagnosisResult({ ...result(), markersValidated: 0 })).toBe(
      false,
    );
  });

  it("rejects contradictory outcomes, nonboolean comparisons, duplicates and untrusted enum strings", () => {
    for (const candidate of [null, [], "synthetic-secret-sentinel", {}]) {
      expect(validateRestoreCompletionDiagnosisResult({ ...result(), candidate })).toBe(false);
    }
    for (const comparison of [
      null,
      [],
      {},
      {
        ...result().comparison,
        completionCollisions: ["request_completion_mismatch", "request_completion_mismatch"],
      },
      { ...result().comparison, completionCollisions: ["synthetic-secret-sentinel"] },
    ]) {
      expect(validateRestoreCompletionDiagnosisResult({ ...result(), comparison })).toBe(false);
    }
    for (const key of ["requestMatchesTag", "ledgerMatchesTag", "persistedPairAgrees"]) {
      for (const bad of [null, "false", 0, [], {}]) {
        expect(
          validateRestoreCompletionDiagnosisResult({
            ...result(),
            comparison: { ...result().comparison, [key]: bad },
          }),
        ).toBe(false);
      }
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          comparison: {
            ...result().comparison,
            [key]:
              !result().comparison[
                key as "requestMatchesTag" | "ledgerMatchesTag" | "persistedPairAgrees"
              ],
          },
        }),
      ).toBe(false);
    }
    for (const outcome of ["refused", "consistent", "replayed", "synthetic-secret-sentinel"]) {
      expect(validateRestoreCompletionDiagnosisResult({ ...result(), outcome })).toBe(false);
    }
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        reason: "synthetic-secret-sentinel",
      }),
    ).toBe(false);
    expect(
      validateRestoreCompletionDiagnosisResult({ ...result(), corroboration: "operator_claim" }),
    ).toBe(false);
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        outcome: "refused",
        candidate: null,
        corroboration: null,
        reason: "synthetic-secret-sentinel",
      }),
    ).toBe(false);
  });

  it("rejects malformed proof digests and noncanonical, impossible or later-than-expiry timestamps", () => {
    for (const key of ["evidenceSha256", "candidateSha256"]) {
      for (const value of ["", "A".repeat(64), "a".repeat(63), `${"a".repeat(64)}\n`, null, []]) {
        expect(
          validateRestoreCompletionDiagnosisResult({
            ...result(),
            candidate: { ...result().candidate, [key]: value },
          }),
        ).toBe(false);
      }
    }
    for (const correctedCompletedAt of [
      "2026-02-30T00:00:00.000Z",
      "2026-09-08T00:00:00Z",
      "2026-09-08T00:00:00.000+00:00",
      "2099-01-01T00:00:00.000Z",
      "synthetic-secret-sentinel",
      null,
    ]) {
      expect(
        validateRestoreCompletionDiagnosisResult({
          ...result(),
          candidate: { ...result().candidate, correctedCompletedAt },
        }),
      ).toBe(false);
    }
    expect(
      validateRestoreCompletionDiagnosisResult({
        ...result(),
        expiresAt: "2026-02-30T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("explicit development primary deletion recovery", () => {
  function primary() {
    return configuration({
      recoveryMode: "primary_recovery",
      restoreManifestSha256: CURRENT_PRIMARY_RESTORE_MANIFEST_SHA256,
      targetIdentifier: fixture.configuration.sourceIdentifier,
      targetHostname: fixture.configuration.sourceHostname,
      targetDbiResourceId: fixture.configuration.sourceDbiResourceId,
      targetBoundarySha256: fixture.configuration.sourceBoundarySha256,
    });
  }
  it("admits only explicit same-primary metadata and binds the mode to environment hash", () => {
    const config = primary();
    expect(validateRestoreConfiguration(config, catalogSha256, now)).toEqual(config);
    const env = environment({ RESTORE_REPLAY_CONFIG_JSON: serializeRestoreConfiguration(config) });
    expect(loadRestoreEnvironment(env, catalogSha256, now).configuration).toEqual(config);
    expect(env.RESTORE_REPLAY_CONFIG_SHA256).not.toBe(fixture.configurationSha256);
    const omitted = { ...config };
    delete omitted.recoveryMode;
    expect(() => validateRestoreConfiguration(omitted, catalogSha256, now)).toThrow(
      configurationError,
    );
  });
  it.each([
    { recoveryMode: "isolated" },
    { restoreManifestSha256: CURRENT_RESTORE_MANIFEST_SHA256 },
    { targetIdentifier: fixture.configuration.targetIdentifier },
    { targetHostname: fixture.configuration.targetHostname },
    { targetDbiResourceId: fixture.configuration.targetDbiResourceId },
    { targetBoundarySha256: fixture.configuration.targetBoundarySha256 },
    { expiresAt: "2026-09-08T21:00:00.000Z" },
  ])("refuses primary substitution or renewed admission %j", (mutation) => {
    expect(() =>
      validateRestoreConfiguration({ ...primary(), ...mutation }, catalogSha256, now),
    ).toThrow(configurationError);
  });
});
