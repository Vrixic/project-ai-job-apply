import { readdir, readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

describe("domain schema registry", () => {
  it("compiles every version-one JSON Schema", async () => {
    const directory = new URL("../schemas/v1/", import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".schema.json"));
    const ajv = new Ajv2020({ strict: true });
    const addFormats = addFormatsModule.default as unknown as (instance: Ajv2020) => Ajv2020;
    addFormats(ajv);

    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const schema = JSON.parse(await readFile(new URL(file, directory), "utf8")) as object;
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  });
});
