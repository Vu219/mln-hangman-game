import { defineConfig } from "vitest/config";

// Chạy thử cả ván trên Firebase Emulator (auth + database). Xem package.json gốc: npm run e2e:ci
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 60 * 1000,
    fileParallelism: false,
  },
});
