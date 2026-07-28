// vitest.config.all.ts — FULL SUITE (unit + api + rls + e2e)
import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

const NODE_INCLUDE = [
  "tests/unit/**/*.test.ts",
  "tests/bonds/**/*.test.ts",
  "tests/gl/**/*.test.ts",
  "tests/esg/**/*.test.ts",
  "tests/vendor-portal/**/*.test.ts",
  "tests/portfolio/**/*.test.ts",


  "tests/api/**/*.test.ts",
  "tests/rls/**/*.test.ts",
  "tests/e2e/**/*.test.ts",
  "tests/integrity/**/*.test.ts",
];

export default defineConfig({
  resolve: { alias },
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "all",
          environment: "node",
          globals: true,
          include: NODE_INCLUDE,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        // .tsx suites render React components — they need a DOM.
        resolve: { alias },
        test: {
          name: "all-dom",
          environment: "jsdom",
          globals: true,
          include: ["tests/unit/**/*.test.tsx"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
