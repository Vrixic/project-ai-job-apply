import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const modulePath = resolve(root, "infrastructure/terraform/modules/cover-letter-provider-objects");
const planPath = join(tmpdir(), `cover-letter-policy-${process.pid}-${Date.now()}.tfplan`);
const key = "arn:aws:kms:us-east-2:111122223333:key/11111111-2222-3333-4444-555555555555";
const bucket = "arn:aws:s3:::synthetic-candidate-documents";
const document = "019a4000-0000-7000-8000-000000000001";
const slot = (name) => `${bucket}/normalized/${document}/generation/${name}.v1.json`;
const terraform = (args) =>
  execFileSync("terraform", [`-chdir=${modulePath}`, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2_000_000,
  });

let policy;
terraform(["init", "-backend=false", "-input=false", "-no-color"]);
try {
  terraform([
    "plan",
    "-input=false",
    "-no-color",
    `-out=${planPath}`,
    "-var=bucket_name=synthetic-candidate-documents",
    "-var=account_id=111122223333",
    `-var=kms_key_arn=${key}`,
  ]);
  const plan = JSON.parse(terraform(["show", "-json", planPath]));
  assert.equal(plan.resource_changes?.length ?? 0, 0, "The module must never create resources");
  assert.equal(plan.planned_values.root_module.resources?.length ?? 0, 0);
  policy = JSON.parse(plan.planned_values.outputs.policy_json.value);
} finally {
  // Only the single synthetic plan file created here; no recursive filesystem removal.
  if (existsSync(planPath)) unlinkSync(planPath);
}

const list = (value) => (Array.isArray(value) ? value : [value]);
const glob = (pattern, value) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
      .replace(/\*/gu, ".*")
      .replace(/\?/gu, ".")}$`,
    "u",
  ).test(value);

/** Local evaluator for the emitted operators only. Not AWS's IAM simulator or S3 service. */
function conditions(statement, context) {
  return Object.entries(statement.Condition ?? {}).every(([operator, entries]) =>
    Object.entries(entries).every(([name, expected]) => {
      const value = context[name];
      switch (operator) {
        case "Null":
          return String(value === undefined) === expected;
        case "StringEquals":
          return value !== undefined && list(expected).includes(value);
        case "StringNotEquals":
          return value === undefined || !list(expected).includes(value);
        case "Bool":
          return value !== undefined && String(value) === expected;
        default:
          throw new Error(`Unsupported operator ${operator}`);
      }
    }),
  );
}

function decision(action, resource, context = {}, statements = policy.Statement) {
  let allowed = false;
  for (const statement of statements) {
    // Resource-scoped NotAction covers only actions applicable to ordinary S3 ARNs here.
    const actionMatches = statement.Action
      ? list(statement.Action).some((pattern) => glob(pattern, action))
      : action.startsWith("s3:") &&
        !list(statement.NotAction).some((pattern) => glob(pattern, action));
    const resourceMatches = statement.Resource
      ? list(statement.Resource).some((pattern) => glob(pattern, resource))
      : !list(statement.NotResource).some((pattern) => glob(pattern, resource));
    if (!actionMatches || !resourceMatches || !conditions(statement, context)) continue;
    if (statement.Effect === "Deny") return "explicit_deny";
    assert.equal(statement.Effect, "Allow");
    allowed = true;
  }
  return allowed ? "allow" : "implicit_deny";
}

const headers = {
  "aws:SecureTransport": "true",
  "s3:if-match": '"synthetic-original-etag"',
  "s3:x-amz-server-side-encryption": "aws:kms",
  "s3:x-amz-server-side-encryption-aws-kms-key-id": key,
};
const extraGrant = { Effect: "Allow", Action: ["s3:*"], Resource: ["*"] };
const deny = (action, resource, context = headers) => {
  for (const statements of [policy.Statement, [...policy.Statement, extraGrant]])
    assert.equal(decision(action, resource, context, statements), "explicit_deny");
};

for (const name of ["request", "dispatch", "result"]) {
  for (const action of ["s3:GetObject", "s3:GetObjectVersion"])
    test(`${action} permits fixed ${name} slot`, () =>
      assert.equal(decision(action, slot(name), headers), "allow"));
}
for (const name of ["dispatch", "result"])
  test(`permits encrypted ETag replacement of ${name}`, () =>
    assert.equal(decision("s3:PutObject", slot(name), headers), "allow"));

test("request remains immutable despite extra grants", () => deny("s3:PutObject", slot("request")));
for (const resource of [
  bucket,
  `${bucket}/normalized/${document}/cover-letter.v1.json`,
  `${bucket}/quarantine/resume.pdf`,
  `${bucket}/normalized/${document}/generation/other.v1.json`,
  "arn:aws:s3:::other-bucket/normalized/synthetic/generation/result.v1.json",
  "arn:aws:s3:us-east-2:111122223333:accesspoint/synthetic/object/normalized/synthetic/generation/result.v1.json",
])
  test(`refuses resources outside slots: ${resource}`, () => {
    for (const action of ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:ListBucket"])
      deny(action, resource);
  });

for (const action of [
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "s3:PutObjectAcl",
  "s3:PutObjectTagging",
  "s3:PutObjectVersionTagging",
  "s3:RestoreObject",
  "s3:PutObjectRetention",
  "s3:PutObjectLegalHold",
  "s3:AbortMultipartUpload",
  "s3:ListMultipartUploadParts",
  "s3:ReplicateObject",
  "s3:ReplicateDelete",
])
  test(`refuses ${action} even with extra grants`, () => deny(action, slot("result")));

for (const value of [undefined, "", "*"])
  test(`refuses non-specific If-Match ${String(value)}`, () =>
    deny("s3:PutObject", slot("result"), { ...headers, "s3:if-match": value }));
test("If-None-Match never substitutes for If-Match", () =>
  deny("s3:PutObject", slot("result"), {
    ...headers,
    "s3:if-match": undefined,
    "s3:if-none-match": "*",
  }));
test("no multipart creation/part exception", () =>
  deny("s3:PutObject", slot("result"), {
    ...headers,
    "s3:if-match": undefined,
    "s3:ObjectCreationOperation": "false",
  }));
test("refuses copy even with a valid match and encryption", () =>
  deny("s3:PutObject", slot("result"), {
    ...headers,
    "s3:x-amz-copy-source": "other-bucket/candidate-artifact",
  }));
for (const [name, values] of [
  ["s3:x-amz-server-side-encryption", [undefined, "AES256"]],
  [
    "s3:x-amz-server-side-encryption-aws-kms-key-id",
    [undefined, "alias/synthetic", key.replace("111122223333", "999988887777")],
  ],
])
  for (const value of values)
    test(`refuses missing/wrong ${name}: ${String(value)}`, () =>
      deny("s3:PutObject", slot("result"), { ...headers, [name]: value }));
for (const action of ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"])
  test(`refuses insecure ${action}`, () =>
    deny(action, slot("result"), { ...headers, "aws:SecureTransport": "false" }));

for (const [action, resource] of [
  ["kms:Decrypt", key],
  [
    "secretsmanager:GetSecretValue",
    "arn:aws:secretsmanager:us-east-2:111122223333:secret:synthetic",
  ],
  ["lambda:InvokeFunction", "arn:aws:lambda:us-east-2:111122223333:function:synthetic:1"],
  [
    "logs:PutLogEvents",
    "arn:aws:logs:us-east-2:111122223333:log-group:synthetic:log-stream:synthetic",
  ],
])
  test(`neither grants nor denies separate ${action} port`, () => {
    assert.equal(decision(action, resource, headers), "implicit_deny");
    assert.equal(
      decision(action, resource, headers, [
        ...policy.Statement,
        { Effect: "Allow", Action: [action], Resource: [resource] },
      ]),
      "allow",
    );
  });

test("guard regressions are detected against a broad extra grant", () => {
  for (const [sid, action, resource, context] of [
    [
      "DenyMissingIfMatch",
      "s3:PutObject",
      slot("result"),
      { ...headers, "s3:if-match": undefined },
    ],
    ["DenyNonSpecificIfMatch", "s3:PutObject", slot("result"), { ...headers, "s3:if-match": "*" }],
    ["DenyWritesOutsideReplacementSlots", "s3:PutObject", slot("request"), headers],
    ["DenyOtherS3Actions", "s3:DeleteObjectVersion", slot("result"), headers],
    ["DenyS3OutsideGenerationSlots", "s3:GetObject", `${bucket}/quarantine/resume.pdf`, headers],
    [
      "DenyCopySource",
      "s3:PutObject",
      slot("result"),
      { ...headers, "s3:x-amz-copy-source": "synthetic/source" },
    ],
    [
      "DenyWrongEncryptionKey",
      "s3:PutObject",
      slot("result"),
      { ...headers, "s3:x-amz-server-side-encryption-aws-kms-key-id": "alias/synthetic" },
    ],
  ]) {
    assert.ok(policy.Statement.some((statement) => statement.Sid === sid));
    assert.equal(
      decision(action, resource, context, [
        ...policy.Statement.filter((statement) => statement.Sid !== sid),
        extraGrant,
      ]),
      "allow",
      sid,
    );
  }
});
