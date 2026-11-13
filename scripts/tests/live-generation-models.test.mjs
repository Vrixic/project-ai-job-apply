import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guards the one list both Terraform roots trust (bootstrap boundary and environment role policy) for live
// generation. A model belongs here only after its AWS retention statements were re-read and recorded in ADR-059.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const document = JSON.parse(read("infrastructure/terraform/live-generation-models.json"));
const adr = read("docs/adr/059-live-generation-through-amazon-bedrock.md");
const entries = Object.entries(document.models);

test("the list is a small, versioned, reviewed allow-list", () => {
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.decision, "docs/adr/059-live-generation-through-amazon-bedrock.md");
  assert.ok(entries.length >= 1 && entries.length <= 4);
});

test("every entry is a US inference profile over exactly one foundation model in US regions", () => {
  for (const [profile, entry] of entries) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "destinationRegions",
      "foundationModelId",
      "reviewed",
    ]);
    assert.match(entry.foundationModelId, /^[a-z0-9]+\.[a-z0-9.-]+$/u);
    assert.equal(profile, `us.${entry.foundationModelId}`);
    assert.deepEqual([...entry.destinationRegions].sort(), entry.destinationRegions);
    assert.equal(new Set(entry.destinationRegions).size, entry.destinationRegions.length);
    assert.ok(entry.destinationRegions.includes("us-east-2"));
    for (const region of entry.destinationRegions) assert.match(region, /^us-(east|west)-[0-9]$/u);
    assert.match(entry.reviewed, /^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/u);
  }
});

test("ADR-059 names every listed model", () => {
  for (const [profile] of entries)
    assert.ok(adr.includes(profile), `${profile} is not named in ADR-059`);
});

test("a model that AWS documents as retaining traffic is never listed", () => {
  // ADR-059: Claude Fable 5.x retain all traffic for up to 30 days, and OpenAI models other than gpt-oss retain
  // classifier-flagged traffic for up to 30 days unless zero data retention is granted. ADR-038 allows neither.
  for (const [profile, entry] of entries) {
    assert.doesNotMatch(entry.foundationModelId, /fable/iu, profile);
    if (/^openai\./u.test(entry.foundationModelId))
      assert.match(entry.foundationModelId, /^openai\.gpt-oss/u, profile);
  }
});
