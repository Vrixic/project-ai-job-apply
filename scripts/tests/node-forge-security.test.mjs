import assert from "node:assert/strict";
import { constants, createHash, generateKeyPairSync, privateEncrypt, sign } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const mobileRequire = createRequire(new URL("../../frontend/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const forge = cliRequire("node-forge");
const { asn1 } = forge;
const message = Buffer.from("Synthetic dependency signature regression fixture");
const node = (type, value, constructed = false) =>
  asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
const sequence = (values) => node(asn1.Type.SEQUENCE, values, true);
const nullParameter = () => node(asn1.Type.NULL, "");
const garbage = () => node(asn1.Type.OCTETSTRING, "unconsumed synthetic bytes");

// Real RSA operations on ephemeral synthetic keys: no mocks and no retained key material.
// Signing a malformed DigestInfo isolates acceptance of its shape; it is not a claim to
// reproduce an attacker forging a signature without the private key.
for (const publicExponent of [3, 65537]) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent });
  const publicKey = forge.pki.publicKeyFromPem(
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  for (const algorithm of ["sha256", "sha384", "sha512"]) {
    const digest = createHash(algorithm).update(message).digest("latin1");
    const oid = () => node(asn1.Type.OID, asn1.oidToDer(forge.oids[algorithm]).getBytes());
    const digestInfo = (children, outerExtra = []) =>
      sequence([sequence(children), node(asn1.Type.OCTETSTRING, digest), ...outerExtra]);
    const signatureFor = (info) => {
      const der = Buffer.from(asn1.toDer(info).getBytes(), "latin1");
      const encoded = Buffer.concat([
        Buffer.from([0, 1]),
        Buffer.alloc(256 - der.length - 3, 255),
        Buffer.from([0]),
        der,
      ]);
      return privateEncrypt(
        { key: keys.privateKey, padding: constants.RSA_NO_PADDING },
        encoded,
      ).toString("latin1");
    };
    test(`RSA e=${publicExponent} ${algorithm} accepts standard Node signature`, () => {
      const signature = sign(algorithm, message, keys.privateKey).toString("latin1");
      assert.equal(publicKey.verify(digest, signature), true);
      assert.equal(publicKey.verify("incorrect digest", signature), false);
    });
    for (const includeNull of [false, true]) {
      test(`RSA e=${publicExponent} ${algorithm} accepts optional NULL=${includeNull}`, () => {
        const children = includeNull ? [oid(), nullParameter()] : [oid()];
        assert.equal(publicKey.verify(digest, signatureFor(digestInfo(children))), true);
      });
    }
    const malformed = {
      "garbage after OID": () => [oid(), garbage()],
      "garbage after NULL": () => [oid(), nullParameter(), garbage()],
      "duplicate NULL": () => [oid(), nullParameter(), nullParameter()],
      "extra nested sequence": () => [oid(), nullParameter(), sequence([garbage()])],
    };
    for (const [name, children] of Object.entries(malformed)) {
      test(`RSA e=${publicExponent} ${algorithm} rejects ${name}`, () => {
        assert.throws(
          () => publicKey.verify(digest, signatureFor(digestInfo(children()))),
          /does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo/,
        );
      });
    }
    test(`RSA e=${publicExponent} ${algorithm} still rejects outer garbage`, () => {
      assert.throws(
        () => publicKey.verify(digest, signatureFor(digestInfo([oid()], [garbage()]))),
        /does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo/,
      );
    });
  }
}
