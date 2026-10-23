#!/usr/bin/env node
// Generates a Web Push VAPID identity (ADR-056) for the notifications dispatcher.
//
//   node scripts/generate-notifications-vapid-keys.mjs --subject mailto:ops@example.com
//
// Prints one JSON object to stdout and nothing else:
//   { "secret": { publicKey, privateKeyPem, subject }, "publicKey": "<base64url>" }
// Put `secret` (as a JSON string) into the Secrets Manager container Terraform creates, and give
// `publicKey` to the `notifications_push_public_key` variable. The private key never needs to be
// written to disk: pipe the output straight into the AWS CLI.
import { generateKeyPairSync } from "node:crypto";

const subjectIndex = process.argv.indexOf("--subject");
const subject = subjectIndex > 0 ? process.argv[subjectIndex + 1] : undefined;
if (!subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/u.test(subject)) {
  process.stderr.write(
    "Usage: generate-notifications-vapid-keys.mjs --subject mailto:you@example.com\n",
  );
  process.exit(2);
}

const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = pair.publicKey.export({ format: "jwk" });
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x ?? "", "base64url"),
  Buffer.from(jwk.y ?? "", "base64url"),
]).toString("base64url");
const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

process.stdout.write(
  `${JSON.stringify({ secret: { publicKey, privateKeyPem, subject }, publicKey })}\n`,
);
