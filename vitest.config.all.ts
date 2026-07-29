// vitest.config.all.ts — FULL SUITE (unit + api + rls + e2e)
import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

// Pure in-process suites: no database, safe to fan out wide.
const UNIT_INCLUDE = [
  "tests/unit/**/*.test.ts",
  "tests/bonds/**/*.test.ts",
  "tests/gl/**/*.test.ts",
  "tests/esg/**/*.test.ts",
  "tests/vendor-portal/**/*.test.ts",
];

// Live-database suites. They all share ONE Postgres and ONE GoTrue, so
// unbounded file parallelism produced random statement timeouts and auth
// rate limits (P-262). They run in their own project with a small worker
// pool and longer budgets; sign-ins additionally back off (tests/helpers/
// auth-retry.ts).
const DB_INCLUDE = [
  "tests/api/**/*.test.ts",
  "tests/rls/**/*.test.ts",
  "tests/e2e/**/*.test.ts",
  "tests/integrity/**/*.test.ts",
  "tests/portfolio/**/*.test.ts",
  "tests/subcontracts/**/*.test.ts",
  "tests/documents/**/*.test.ts",
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
          include: UNIT_INCLUDE,
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "all-db",
          environment: "node",
          globals: true,
          include: DB_INCLUDE,
          maxWorkers: 2,
          minWorkers: 1,
          sequence: { groupOrder: 1 },
          maxConcurrency: 2,
          testTimeout: 90_000,
          hookTimeout: 180_000,
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
          sequence: { groupOrder: 0 },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
