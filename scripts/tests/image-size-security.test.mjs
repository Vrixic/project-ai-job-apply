import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const mobileRequire = createRequire(path.join(repositoryRoot, "frontend/mobile/package.json"));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const metroRequire = createRequire(expoRequire.resolve("metro/package.json"));
const imageSizeRoot = path.dirname(metroRequire.resolve("image-size/package.json"));

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function box(type, ...payload) {
  const contents = Buffer.concat(payload);
  return Buffer.concat([uint32(contents.length + 8), Buffer.from(type), contents]);
}

function replaceLength(input, offset, value) {
  const result = Buffer.from(input);
  result.writeUInt32BE(value, offset);
  return result;
}

function heif(brand = "avif", extras = false) {
  const spacer = extras ? box("free", Buffer.alloc(4)) : Buffer.alloc(0);
  const ispe = box("ispe", uint32(0), uint32(320), uint32(240));
  const ipco = box("ipco", spacer, ispe);
  const iprp = box("iprp", spacer, ipco);
  const meta = box("meta", uint32(0), spacer, iprp);
  return Buffer.concat([box("ftyp", Buffer.from(brand), uint32(0)), spacer, meta]);
}

const jxlHeader = Buffer.concat([
  box("JXL ", Buffer.from([13, 10, 135, 10])),
  box("ftyp", Buffer.from("jxl "), uint32(0), Buffer.from("jxl ")),
]);
// Synthetic size-header fixtures; not a complete image-decoding claim.
const jxlCodestream = Buffer.from([255, 10, 1, 0]);
const jxl = (...boxes) => Buffer.concat([jxlHeader, ...boxes]);
const icnsEntry = (type, data = Buffer.alloc(0)) =>
  Buffer.concat([Buffer.from(type), uint32(data.length + 8), data]);
const icns = (...entries) => {
  const data = Buffer.concat(entries);
  return Buffer.concat([Buffer.from("icns"), uint32(data.length + 8), data]);
};

const cases = [];
function rejects(name, input) {
  cases.push({ name, input: input.toString("base64"), rejects: true });
}
function dimensions(name, input, expected) {
  cases.push({ name, input: input.toString("base64"), expected });
}
function find(name, input, offset, end, expected) {
  cases.push({ name, input: input.toString("base64"), find: { offset, end }, expected });
}

for (const size of [0, 1, 2, 3, 4, 5, 6, 7, 9, 0xffffffff]) {
  find(`box rejects matching length ${size}`, replaceLength(box("jxlp"), 0, size), 0, 8, null);
  rejects(`JXL rejects matching partial length ${size}`, jxl(replaceLength(box("jxlp"), 0, size)));
}
for (let length = 0; length < 8; length += 1) {
  find(
    `box rejects ${length}-byte truncated header`,
    box("jxlp").subarray(0, length),
    0,
    length,
    null,
  );
}
find("box accepts exact header boundary", box("jxlp"), 0, 8, { name: "jxlp", offset: 0, size: 8 });
find("box advances across empty sibling", Buffer.concat([box("free"), box("jxlp")]), 0, 16, {
  name: "jxlp",
  offset: 8,
  size: 8,
});
find("box cannot escape parent end", Buffer.concat([box("free"), box("jxlp")]), 0, 8, null);
find("box rejects negative offset", box("jxlp"), -1, 8, null);
find("box rejects fractional offset", box("jxlp"), 0.5, 8, null);
find("box rejects end beyond input", box("jxlp"), 0, 9, null);
find("box rejects offset after end", box("jxlp"), 8, 0, null);

const heifInput = heif();
for (const [name, offset, minimum] of [
  ["ftyp", 0, 12],
  ["meta", 16, 12],
  ["iprp", 28, 8],
  ["ipco", 36, 8],
  ["ispe", 44, 20],
]) {
  for (const size of new Set([0, 1, 7, 0xffffffff, minimum - 1])) {
    rejects(`HEIF rejects ${name} length ${size}`, replaceLength(heifInput, offset, size));
  }
}
for (const length of [4, 7, 11, 15, 20, 27, 35, 43, 51, 55, 63]) {
  rejects(`HEIF rejects truncated boundary ${length}`, heifInput.subarray(0, length));
}
for (const [name, offset, size] of [
  ["meta", 16, 12],
  ["iprp", 28, 8],
  ["ipco", 36, 8],
]) {
  rejects(`HEIF rejects child outside ${name}`, replaceLength(heifInput, offset, size));
}
dimensions("HEIF dimensions at exact nested ends", heif(), {
  width: 320,
  height: 240,
  type: "avif",
});
dimensions("HEIF dimensions with unknown siblings", heif("heic", true), {
  width: 320,
  height: 240,
  type: "heic",
});
dimensions("HEIF alternate accepted brand", heif("mif1"), {
  width: 320,
  height: 240,
  type: "mif1",
});

for (const size of [0, 1, 7, 8, 11, 0xffffffff]) {
  rejects(
    `JXL rejects truncated ftyp ${size}`,
    replaceLength(jxl(box("jxlc", jxlCodestream)), 12, size),
  );
}
rejects("JXL rejects missing partial sequence header", jxl(box("jxlp")));
rejects("JXL rejects truncated partial sequence header", jxl(box("jxlp", Buffer.alloc(3))));
rejects("JXL rejects incomplete codestream box", jxl(box("jxlc", jxlCodestream)).subarray(0, 43));
rejects(
  "JXL rejects malformed sibling before partial stream",
  jxl(replaceLength(box("free"), 0, 0), box("jxlp", uint32(0), jxlCodestream)),
);
dimensions("JXL complete dimension header", jxl(box("jxlc", jxlCodestream)), {
  width: 8,
  height: 8,
  type: "jxl",
});
dimensions(
  "JXL multiple partial streams and empty siblings",
  jxl(
    box("free"),
    box("jxlp", uint32(0), jxlCodestream.subarray(0, 2)),
    box("free"),
    box("jxlp", uint32(0x80000001), jxlCodestream.subarray(2)),
  ),
  { width: 8, height: 8, type: "jxl" },
);

for (const size of [0, 1, 2, 7, 9, 0xffffffff]) {
  rejects(
    `ICNS rejects first entry length ${size}`,
    replaceLength(icns(icnsEntry("is32")), 12, size),
  );
  rejects(
    `ICNS rejects later entry length ${size}`,
    replaceLength(icns(icnsEntry("is32"), icnsEntry("il32")), 20, size),
  );
}
for (const size of [0, 7, 8, 15]) {
  rejects(`ICNS rejects file length ${size}`, replaceLength(icns(icnsEntry("is32")), 4, size));
}
for (const length of [4, 7, 8, 11, 15]) {
  rejects(`ICNS rejects truncated input ${length}`, icns(icnsEntry("is32")).subarray(0, length));
}
rejects("ICNS rejects truncated later header", icns(icnsEntry("is32"), Buffer.from("il32")));
rejects(
  "ICNS rejects entry crossing declared file end",
  replaceLength(icns(icnsEntry("is32", Buffer.alloc(8))), 4, 16),
);
dimensions("ICNS exact single header boundary", icns(icnsEntry("is32")), {
  width: 16,
  height: 16,
  type: "is32",
});
dimensions("ICNS full RGB entry", icns(icnsEntry("is32", Buffer.alloc(16 * 16 * 3))), {
  width: 16,
  height: 16,
  type: "is32",
});
dimensions(
  "ICNS supported prefix read skips unsampled entry payload",
  icns(icnsEntry("is32", Buffer.alloc(16 * 16 * 3))).subarray(0, 16),
  { width: 16, height: 16, type: "is32" },
);
dimensions(
  "ICNS multiple RGB entries",
  icns(icnsEntry("is32", Buffer.alloc(16 * 16 * 3)), icnsEntry("il32", Buffer.alloc(32 * 32 * 3))),
  {
    width: 16,
    height: 16,
    type: "icns",
    images: [
      { width: 16, height: 16, type: "is32" },
      { width: 32, height: 32, type: "il32" },
    ],
  },
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
  "base64",
);
dimensions("unchanged complete PNG", png, { width: 1, height: 1, type: "png" });
dimensions(
  "unchanged complete GIF",
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  { width: 1, height: 1, type: "gif" },
);
dimensions(
  "unchanged SVG",
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"></svg>'),
  { width: 32, height: 24, type: "svg" },
);

function pngChunk(type, data) {
  const contents = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of contents) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return Buffer.concat([uint32(data.length), contents, uint32((crc ^ 0xffffffff) >>> 0)]);
}
const rgbaHeader = Buffer.concat([uint32(512), uint32(512), Buffer.from([8, 6, 0, 0, 0])]);
// A complete valid PNG with uncompressed zlib scanlines, large enough to exercise
// image-size's intentional 512 KiB prefix sampling in BOTH filesystem APIs.
const largePng = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", rgbaHeader),
  pngChunk("IDAT", deflateSync(Buffer.alloc((512 * 4 + 1) * 512), { level: 0 })),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const largeIcns = icns(icnsEntry("ic09", largePng));
assert.ok(largeIcns.length > 512 * 1024);
dimensions("ICNS complete PNG payload larger than 512 KiB", largeIcns, {
  width: 512,
  height: 512,
  type: "ic09",
});
for (const fileMode of ["sync", "callback"]) {
  cases.push({
    name: `ICNS ${fileMode} file API preserves 512 KiB prefix sampling`,
    input: largeIcns.toString("base64"),
    fileMode,
    expected: { width: 512, height: 512, type: "ic09" },
  });
}

// Every parser invocation is isolated: malformed fixtures can otherwise block the
// main Node event loop indefinitely. Timeout/OOM/signal/no result are failures.
const childSource = `
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { createRequire } = require("node:module");
  const root = process.argv[1];
  const entry = JSON.parse(fs.readFileSync(0, "utf8"));
  const bytes = Buffer.from(entry.input, "base64");
  const imageSize = require(root);
  (async () => {
  let temporaryDirectory;
  try {
    let result;
    if (entry.fileMode) {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "image-size-security-"));
      const inputFile = path.join(temporaryDirectory, "synthetic.icns");
      fs.writeFileSync(inputFile, bytes, { flag: "wx" });
      result = entry.fileMode === "sync" ? imageSize(inputFile)
        : await new Promise((resolve, reject) => imageSize(inputFile, (error, result) => error ? reject(error) : resolve(result)));
    } else result = entry.find
      ? require(path.join(root, "dist/types/utils.js")).findBox(bytes, "jxlp", entry.find.offset, entry.find.end)
      : entry.metro
        ? createRequire(process.argv[2])("./src/Assets.js").getAssetSize("png", bytes, "synthetic.png")
        : imageSize(bytes);
    process.stdout.write(JSON.stringify({ result: result ?? null }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ rejected: error instanceof Error }));
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true });
  }
  })();
`;

cases.push({
  name: "Metro installed callable API preserves PNG dimensions",
  input: png.toString("base64"),
  metro: true,
  expected: { width: 1, height: 1 },
});

for (const entry of cases) {
  test(entry.name, { timeout: 10000 }, () => {
    const child = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "-e",
        childSource,
        imageSizeRoot,
        expoRequire.resolve("metro/package.json"),
      ],
      {
        input: JSON.stringify(entry),
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
    );
    assert.equal(child.error, undefined, `${entry.name}: parser exceeded its process bound`);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    if (entry.rejects) assert.deepEqual(result, { rejected: true });
    else assert.deepEqual(result, { result: entry.expected });
  });
}
