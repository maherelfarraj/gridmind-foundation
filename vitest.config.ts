// vitest.config.ts — UNIT ONLY (default)
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // React Email deep-imports entities v4 paths; jsdom needs modern entities.
      "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities-v4/lib/decode.js"),
      "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities-v4/lib/encode.js"),
      "entities/lib/escape.js": path.resolve(__dirname, "node_modules/entities-v4/lib/escape.js"),
    },
  },
  test: {
    name: "unit",
    environment: "jsdom",
    globals: true,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/bonds/**/*.test.ts",
      "tests/estimating/**/*.test.ts",
      "tests/gl/**/*.test.ts",
      "tests/esg/**/*.test.ts",
      "tests/vendor-portal/**/*.test.ts",

      "tests/rls/esg-carbon.test.ts",
      "tests/rls/vendor-portal.test.ts",
      "tests/rls/bonds.test.ts",
      "tests/rls/estimating.rls.test.ts",
      "tests/rls/timesheets.rls.test.ts",
      "tests/rls/gl.test.ts",
    ],
    exclude: [
      "tests/api/**",
      "tests/rls/**/!(estimating|timesheets).rls.test.ts",

      "tests/e2e/**",
      "node_modules/**",
    ],
    coverage: { provider: "v8", include: ["src/lib/**"] },
  },
});
