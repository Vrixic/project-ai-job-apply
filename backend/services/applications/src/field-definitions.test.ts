import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultFieldDefinitions } from "./field-definitions.js";

describe("bundled field definitions", () => {
  it("match the repository taxonomy exactly, so the bundle cannot drift", async () => {
    const source = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL("../../../../data/taxonomies/application-fields.v1.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { fields: Array<{ key: string }> };
    const bundled = defaultFieldDefinitions();
    expect(bundled.size).toBe(source.fields.length);
    for (const field of source.fields) expect(bundled.get(field.key)).toEqual(field);
  });

  it("classify the sensitive keys as restricted never-infer", () => {
    const bundled = defaultFieldDefinitions();
    for (const key of ["authorization.us_authorized", "demographic.gender"]) {
      expect(bundled.get(key)).toMatchObject({
        sensitivity: "restricted",
        answerPolicy: "never_infer",
      });
    }
  });
});
