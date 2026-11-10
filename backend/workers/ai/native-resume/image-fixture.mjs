// Test-only entrypoint. Exercises the immutable image bundle with synthetic external ports.
// Scenario "redraw" has no original file, so the resume is drawn from its layout. Scenario "original"
// supplies a synthetic candidate PDF and its parsed document: the delivered PDF must be that file
// edited in place (it still carries the marker rectangle only the original page content has).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { ORIGINAL_MARKER_COLOUR } from "../../../services/documents/src/render/original/test-support.ts";
import { exerciseResumeRuntime } from "../native-session/resume-runtime-fixture.mjs";

const directory = "/materials/native-resume/";
const manifest = JSON.parse(readFileSync(`${directory}manifest.json`, "utf8"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.getuid(), 65532);
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert.equal(manifest.sourceSha, process.argv[2]);
assert.equal(manifest.platform, "linux/amd64");
for (const name of ["configuration.json", "runtime.cjs", "kernel-deadline.node"]) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`${directory}${name}`))
      .digest("hex"),
    manifest.files[name],
  );
}

/** True when any page-content stream of the PDF (plain or Flate) paints the marker rectangle. */
function carriesOriginalMarker(bytes) {
  const marker = `${ORIGINAL_MARKER_COLOUR} rg`;
  const raw = Buffer.from(bytes);
  const text = raw.toString("latin1");
  for (const match of text.matchAll(/stream\r?\n/gu)) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = raw.subarray(start, end);
    if (chunk.toString("latin1").includes(marker)) return true;
    try {
      if (inflateSync(chunk).toString("latin1").includes(marker)) return true;
    } catch {
      // Not a Flate stream.
    }
  }
  return false;
}

const scenario = process.argv[3] ?? "redraw";
assert.ok(["redraw", "original"].includes(scenario));
const { startNativeResumeImage } = createRequire(import.meta.url)(`${directory}runtime.cjs`);
const fixture =
  scenario === "original"
    ? {
        document: JSON.parse(readFileSync("/native/document.json", "utf8")),
        originalPdfBase64: readFileSync("/native/original.pdf").toString("base64"),
        job: { title: "Graphics Programmer", description: "Vulkan renderer shader tools" },
        onPdf: (bytes) => {
          assert.ok(
            carriesOriginalMarker(bytes),
            "The delivered PDF is not the original edited in place",
          );
        },
      }
    : {};
await exerciseResumeRuntime(
  "resume-runtime-image",
  `${directory}kernel-deadline.node`,
  startNativeResumeImage,
  fixture,
);
