// vitest.config.all.ts — FULL SUITE (unit + api + rls + e2e)
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    name: "all",
    environment: "node",
    globals: true,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/bonds/**/*.test.ts",
      "tests/gl/**/*.test.ts",
      "tests/api/**/*.test.ts",
      "tests/rls/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
