import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const mobileRequire = createRequire(new URL("../../frontend/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const forge = cliRequire("node-forge");
const certificates = cliRequire("@expo/code-signing-certificates");
const { asn1 } = forge;
const make = (type, value, constructed = false) =>
  asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
const digest = forge.md.sha256.create().update("generated dependency regression").digest().bytes();
const oid = () => make(asn1.Type.OID, asn1.oidToDer(forge.oids.sha256).bytes());
const nullParameter = () => make(asn1.Type.NULL, "");
const garbage = () => make(asn1.Type.OCTETSTRING, "generated malformed parameter");

// Generated local keys and malformed encodings only. No external certificates or signatures.
for (const exponent of [3, 65537]) {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: exponent,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
  const privateKey = forge.pki.privateKeyFromPem(pair.privateKey);
  function encodedSignature(children, extra = []) {
    const info = make(
      asn1.Type.SEQUENCE,
      [make(asn1.Type.SEQUENCE, children, true), make(asn1.Type.OCTETSTRING, digest), ...extra],
      true,
    );
    return privateKey.sign(asn1.toDer(info).bytes(), "NONE");
  }
  for (const parameters of [[], [nullParameter()]]) {
    test(`accepts valid SHA256 DigestInfo with ${parameters.length} parameters, e=${exponent}`, () => {
      const signature = encodedSignature([oid(), ...parameters]);
      assert.equal(publicKey.verify(digest, signature), true);
      assert.equal(publicKey.verify("wrong digest", signature), false);
    });
  }
  for (const [name, children] of [
    ["OID, NULL, garbage", [oid(), nullParameter(), garbage()]],
    ["OID, garbage without NULL", [oid(), garbage()]],
    ["OID, repeated NULL", [oid(), nullParameter(), nullParameter()]],
    ["OID, nonempty NULL", [oid(), make(asn1.Type.NULL, "generated invalid NULL content")]],
    ["OID, garbage, NULL", [oid(), garbage(), nullParameter()]],
    ["OID, nested SEQUENCE", [oid(), make(asn1.Type.SEQUENCE, [garbage()], true)]],
    ["empty AlgorithmIdentifier", []],
    ["missing OID", [nullParameter()]],
  ]) {
    test(`rejects nested ${name}, e=${exponent}`, () => {
      assert.throws(() => publicKey.verify(digest, encodedSignature(children)), /DigestInfo/);
    });
  }
  test(`retains outer DigestInfo element-count rejection, e=${exponent}`, () => {
    assert.throws(
      () => publicKey.verify(digest, encodedSignature([oid(), nullParameter()], [garbage()])),
      /DigestInfo/,
    );
  });
  test(`ordinary RSA signing remains compatible with the Node entry point, e=${exponent}`, () => {
    const md = forge.md.sha256.create().update("generated certificate compatibility");
    const signature = privateKey.sign(md);
    assert.equal(publicKey.verify(md.digest().bytes(), signature), true);
  });
  test(`actual Expo certificate validation and buffer signing remain compatible, e=${exponent}`, () => {
    const keyPair = { publicKey, privateKey };
    const certificate = certificates.generateSelfSignedCodeSigningCertificate({
      keyPair,
      validityNotBefore: new Date(Date.now() - 60_000),
      validityNotAfter: new Date(Date.now() + 60_000),
      commonName: "generated-dependency-test.example.test",
    });
    const parsed = certificates.convertCertificatePEMToCertificate(
      certificates.convertCertificateToCertificatePEM(certificate),
    );
    assert.doesNotThrow(() => certificates.validateSelfSignedCertificate(parsed, keyPair));
    const buffer = Buffer.from("generated Expo manifest compatibility");
    const signature = certificates.signBufferRSASHA256AndVerify(privateKey, parsed, buffer);
    assert.equal(verify("sha256", buffer, pair.publicKey, Buffer.from(signature, "base64")), true);
    assert.equal(
      verify(
        "sha256",
        Buffer.from("altered manifest"),
        pair.publicKey,
        Buffer.from(signature, "base64"),
      ),
      false,
    );
  });
  test(`actual Expo CSR round trip preserves signature verification, e=${exponent}`, () => {
    const csr = certificates.generateCSR({ publicKey, privateKey }, "generated-csr.example.test");
    const parsed = certificates.convertCSRPEMToCSR(certificates.convertCSRToCSRPEM(csr));
    assert.equal(parsed.verify(), true);
  });
}
