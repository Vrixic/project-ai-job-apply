import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeBlocks } from "../../backend/services/documents/dist/src/parsing/normalize.js";
import { parsePdf } from "../../backend/services/documents/dist/src/parsing/pdf.js";

test("fixed rights PDF parses with the production parser and normalization", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const generated = spawnSync(
    process.execPath,
    [
      "scripts/run-powershell.mjs",
      "-NoProfile",
      "-Command",
      ". ./scripts/lib/candidate-rights-resume-fixture.ps1; [Convert]::ToBase64String((New-RightsResumePdf))",
    ],
    { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const bytes = Buffer.from(generated.stdout.trim(), "base64");
  assert.equal(bytes.length, 625);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "a7519896f053a2f52b1490d3d9c817151ba9b47ad8f2a326a6f6193d4f6d54eb",
  );
  const blocks = normalizeBlocks(await parsePdf(new Uint8Array(bytes)));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].page, 1);
  assert.equal(blocks[0].text, "Generated synthetic candidate - Skills: TypeScript");
  assert.equal(blocks[0].text.length, 50);
});
