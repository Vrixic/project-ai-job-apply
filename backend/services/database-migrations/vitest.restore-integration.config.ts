import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/restore-verifier.integration.test.ts"],
    testTimeout: 20_000,
  },
});
