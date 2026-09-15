import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseD2WorkloadCommand,
  parseD2WorkloadPublicSettings,
} from "../start-development-d2-workload-session.mjs";

const confirmation = "RUN-D2-DISPOSABLE-PROCESSING-TO-REVIEW-V1";
test("workload stdin accepts only exact reviewed execution or cancellation", () => {
  const execute = { action: "execute", confirmation, reviewedScopeSha256: "a".repeat(64) };
  assert.deepEqual(parseD2WorkloadCommand(JSON.stringify(execute)), execute);
  assert.deepEqual(parseD2WorkloadCommand('{"action":"cancel"}'), { action: "cancel" });
  for (const value of [
    null,
    [],
    { action: "execute", confirmation },
    { ...execute, action: "delete" },
    { ...execute, confirmation: "another-confirmation" },
    { ...execute, reviewedScopeSha256: "A".repeat(64) },
    { ...execute, reviewedScopeSha256: ["a".repeat(64)] },
    { ...execute, accessToken: "private-marker" },
    { action: "cancel", extra: true },
  ]) {
    assert.throws(() => parseD2WorkloadCommand(JSON.stringify(value)));
  }
  assert.throws(() => parseD2WorkloadCommand("x".repeat(1025)));
  assert.throws(() => parseD2WorkloadCommand("{"));
});

const publicSettings =
  "EXTENSION_DEVELOPMENT_CONTRIBUTIONS=true\n" +
  "EXTENSION_API_ORIGIN=https://synthetic123.execute-api.us-east-2.amazonaws.com\n" +
  "EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION=synthetic-ugc-v1\n";
test("workload setup selects only exact development public values", () => {
  const expected = {
    apiOrigin: "https://synthetic123.execute-api.us-east-2.amazonaws.com",
    ugcPolicyVersion: "synthetic-ugc-v1",
  };
  assert.deepEqual(parseD2WorkloadPublicSettings(publicSettings), expected);
  assert.deepEqual(
    parseD2WorkloadPublicSettings(`\uFEFF${publicSettings}UNRELATED_SECRET=not-selected\n`),
    expected,
  );
  for (const text of [
    "",
    publicSettings.replace("=true", "=false"),
    publicSettings.replace("=true", "=TRUE"),
    publicSettings.replace("https://", "http://"),
    publicSettings.replace("us-east-2", "us-west-2"),
    publicSettings.replace("amazonaws.com", "amazonaws.com.evil.example"),
    publicSettings.replace("amazonaws.com", "amazonaws.com/path"),
    publicSettings.replace("synthetic-ugc-v1", "invalid value"),
  ])
    assert.throws(() => parseD2WorkloadPublicSettings(text));
});

test("launcher has no rights execution, token-output or browser-session extraction path", async () => {
  const source = await readFile(
    new URL("../start-development-d2-workload-session.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /runSessionOperator|buildIdentityAttestation|writeFile|execSync/u);
  assert.doesNotMatch(source, /chrome\.storage|browser\.cookies|process\.env\.[A-Z_]*TOKEN/u);
  assert.match(source, /maximumContributions: 1, publicationAllowed: false/u);
  assert.match(source, /encrypted-recovery-scope-retained-do-not-rerun/u);
});
