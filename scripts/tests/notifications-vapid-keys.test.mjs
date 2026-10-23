import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../generate-notifications-vapid-keys.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("prints one usable VAPID identity and nothing else", () => {
  const result = run("--subject", "mailto:ops@example.com");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const { secret, publicKey } = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(secret).sort(), ["privateKeyPem", "publicKey", "subject"]);
  assert.equal(secret.publicKey, publicKey);
  assert.equal(secret.subject, "mailto:ops@example.com");
  const point = Buffer.from(publicKey, "base64url");
  assert.equal(point.length, 65);
  assert.equal(point[0], 4);
  // The published key is the public half of the stored private key.
  const privateKey = createPrivateKey(secret.privateKeyPem);
  const derived = createPublicKey(privateKey).export({ format: "jwk" });
  assert.equal(
    Buffer.concat([
      Buffer.from([4]),
      Buffer.from(derived.x, "base64url"),
      Buffer.from(derived.y, "base64url"),
    ]).toString("base64url"),
    publicKey,
  );
  const message = Buffer.from("probe");
  const signature = sign("sha256", message, { key: privateKey, dsaEncoding: "ieee-p1363" });
  assert.equal(
    verify(
      "sha256",
      message,
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      signature,
    ),
    true,
  );
});

test("generates a fresh identity each time", () => {
  const first = JSON.parse(run("--subject", "https://example.com/contact").stdout);
  const second = JSON.parse(run("--subject", "https://example.com/contact").stdout);
  assert.notEqual(first.publicKey, second.publicKey);
});

test("refuses a missing or malformed subject without printing a key", () => {
  for (const args of [
    [],
    ["--subject"],
    ["--subject", "ops@example.com"],
    ["--subject", "http://example.com"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage/u);
  }
});
