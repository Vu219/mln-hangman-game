import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["database.rules.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
