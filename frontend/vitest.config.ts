import { defineConfig } from "vitest/config";

// Unit test cho logic game thuần (src/game) – không cần emulator.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
