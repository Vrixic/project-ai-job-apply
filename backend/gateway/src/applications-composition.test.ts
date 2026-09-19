import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The deployed Gateway returned 500 on POST /v1/applications because Applications was composed with
 * the shared Profile/Drizzle client. Both entry points must compose the dedicated client, and neither
 * may hand the shared client to the Applications runtime.
 */
describe("Applications composition", () => {
  for (const file of ["lambda.ts", "main.ts"]) {
    it(`${file} composes Applications over the dedicated client only`, () => {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      const calls = [...source.matchAll(/createApplicationsRuntime\(\{([\s\S]*?)\n\s*\}\)/gu)];
      expect(calls).toHaveLength(1);
      const body = calls[0]?.[1] ?? "";
      expect(body).toContain("createApplicationsDatabase(");
      expect(body).not.toMatch(/database\.client/u);
      expect(source).toMatch(/createApplicationsDatabase,/u);
    });
  }
});
