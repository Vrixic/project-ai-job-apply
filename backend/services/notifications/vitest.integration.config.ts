import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The store test expires everything older than 31 days, so files must not overlap.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
