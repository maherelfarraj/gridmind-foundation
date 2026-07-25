// vitest.config.ts — UNIT ONLY (default)
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    name: "unit",
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    exclude: ["tests/api/**", "tests/rls/**", "tests/e2e/**", "node_modules/**"],
    coverage: { provider: "v8", include: ["src/lib/**"] },
  },
});
