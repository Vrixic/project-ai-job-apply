#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIXTURE_ROLES = ["clean-pdf", "clean-docx", "invalid-pdf", "malware-test"];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, bytes);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildPdf(text) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source));
    source += object;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

function buildDocx(paragraphs) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const relationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`)
    .join("")}<w:sectPr/></w:body></w:document>`;
  return buildStoredZip([
    { name: "[Content_Types].xml", bytes: Buffer.from(contentTypes) },
    { name: "_rels/.rels", bytes: Buffer.from(relationships) },
    { name: "word/document.xml", bytes: Buffer.from(document) },
  ]);
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if ((name !== "--run-id" && name !== "--output-directory") || !value) {
      throw new Error(
        "Usage: development-document-processing-fixtures.mjs --run-id UUID --output-directory PATH",
      );
    }
    options[name.slice(2)] = value;
  }
  if (!RUN_ID_PATTERN.test(options["run-id"] ?? "") || !options["output-directory"]) {
    throw new Error("The generated-synthetic fixture arguments are invalid");
  }
  return { runId: options["run-id"], outputDirectory: path.resolve(options["output-directory"]) };
}

function canonicalEntries(entries) {
  return [...entries]
    .sort((left, right) => left.fixture.localeCompare(right.fixture))
    .map(({ fixture, fileName, mediaType, sizeBytes, sha256: digest }) => ({
      fixture,
      fileName,
      mediaType,
      sizeBytes,
      sha256: digest,
    }));
}

async function main() {
  const { runId, outputDirectory } = parseArguments(process.argv.slice(2));
  const compactRunId = runId.replaceAll("-", "");
  const definitions = [
    {
      fixture: "clean-pdf",
      fileName: `generated-${compactRunId}-clean.pdf`,
      mediaType: "application/pdf",
      bytes: buildPdf(`candidate-${compactRunId}@example.test`),
    },
    {
      fixture: "clean-docx",
      fileName: `generated-${compactRunId}-clean.docx`,
      mediaType: DOCX_MEDIA_TYPE,
      bytes: buildDocx(["Skills: TypeScript, PostgreSQL"]),
    },
    {
      fixture: "invalid-pdf",
      fileName: `generated-${compactRunId}-invalid.pdf`,
      mediaType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4\n% generated invalid acceptance fixture\n"),
    },
    {
      fixture: "malware-test",
      fileName: `generated-${compactRunId}-malware-test.pdf`,
      mediaType: "application/pdf",
      bytes: buildPdf("Harmless generated malware-disposition fixture"),
    },
  ];
  if (definitions.map(({ fixture }) => fixture).join("|") !== FIXTURE_ROLES.join("|")) {
    throw new Error("The fixture role boundary is invalid");
  }
  await mkdir(outputDirectory, { recursive: true });
  const entries = [];
  for (const definition of definitions) {
    const filePath = path.join(outputDirectory, definition.fileName);
    await writeFile(filePath, definition.bytes, { flag: "wx" });
    entries.push({
      fixture: definition.fixture,
      fileName: definition.fileName,
      mediaType: definition.mediaType,
      sizeBytes: definition.bytes.byteLength,
      sha256: sha256(definition.bytes),
      path: filePath,
    });
  }
  const manifest = canonicalEntries(entries);
  const fixtureSetSha256 = sha256(JSON.stringify(manifest));
  await writeFile(
    path.join(outputDirectory, "descriptor.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "development-document-processing-fixtures",
      runId,
      fixtureSetSha256,
      manifest,
      files: entries.map(({ fixture, path: filePath }) => ({ fixture, path: filePath })),
    }),
    { encoding: "utf8", flag: "wx" },
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : "Fixture generation failed"));
