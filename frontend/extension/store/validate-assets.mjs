import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const forbiddenMetadataChunks = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);
const expectedAssets = {
  "edge-logo-300x300.png": { width: 300, height: 300, colorType: 6, maxBytes: 1_000_000 },
  "promo-small-440x280.png": { width: 440, height: 280, colorType: 2, maxBytes: 2_000_000 },
};

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectPng(data, name) {
  if (data.length < 33 || !data.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`Store asset is not a PNG: ${name}`);
  }
  let offset = 8;
  let header;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < data.length) {
    if (offset + 12 > data.length)
      throw new Error(`Store asset has a truncated PNG chunk: ${name}`);
    const length = data.readUInt32BE(offset);
    const typeStart = offset + 4;
    const payloadStart = typeStart + 4;
    const crcStart = payloadStart + length;
    const next = crcStart + 4;
    if (next > data.length) throw new Error(`Store asset has a truncated PNG payload: ${name}`);
    const type = data.subarray(typeStart, payloadStart).toString("ascii");
    const expectedCrc = data.readUInt32BE(crcStart);
    const actualCrc = crc32(data.subarray(typeStart, crcStart));
    if (actualCrc !== expectedCrc)
      throw new Error(`Store asset has an invalid PNG checksum: ${name}`);
    if (forbiddenMetadataChunks.has(type)) {
      throw new Error(`Store asset contains forbidden metadata chunk ${type}: ${name}`);
    }
    if (type === "IHDR") {
      if (header || length !== 13 || offset !== 8) {
        throw new Error(`Store asset has an invalid PNG header: ${name}`);
      }
      header = {
        width: data.readUInt32BE(payloadStart),
        height: data.readUInt32BE(payloadStart + 4),
        bitDepth: data[payloadStart + 8],
        colorType: data[payloadStart + 9],
      };
    } else if (type === "IDAT") {
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || next !== data.length) {
        throw new Error(`Store asset has invalid trailing PNG data: ${name}`);
      }
      sawEnd = true;
    }
    offset = next;
  }
  if (!header || !sawImageData || !sawEnd || header.bitDepth !== 8) {
    throw new Error(`Store asset is not a complete 8-bit PNG: ${name}`);
  }
  return header;
}

export async function validateStoreAssets(root = extensionRoot) {
  const assetDirectory = join(root, "store", "assets");
  const names = (await readdir(assetDirectory)).sort();
  const expectedNames = Object.keys(expectedAssets).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("Store asset allowlist does not match the reviewed candidate");
  }
  let totalBytes = 0;
  for (const name of names) {
    const path = join(assetDirectory, name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Store asset must be a regular file: ${name}`);
    }
    const expected = expectedAssets[name];
    const data = await readFile(path);
    if (data.length === 0 || data.length > expected.maxBytes) {
      throw new Error(`Store asset size is outside its reviewed bound: ${name}`);
    }
    const actual = inspectPng(data, name);
    if (
      actual.width !== expected.width ||
      actual.height !== expected.height ||
      actual.colorType !== expected.colorType
    ) {
      throw new Error(`Store asset dimensions or color boundary differ: ${name}`);
    }
    totalBytes += data.length;
  }
  return { profile: "d2_store_asset_candidate_v1", assetCount: names.length, totalBytes };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${JSON.stringify(await validateStoreAssets())}\n`);
}
