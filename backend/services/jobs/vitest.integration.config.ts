import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/integration-setup.ts"],
    fileParallelism: false,
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20_000,
  },
});
