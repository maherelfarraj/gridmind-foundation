// vitest.config.all.ts — FULL SUITE (unit + api + rls + e2e)
import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "@": path.resolve(__dirname, "src"),
  // React Email deep-imports entities v4 paths; jsdom needs modern entities.
  "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities-v4/lib/decode.js"),
  "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities-v4/lib/encode.js"),
  "entities/lib/escape.js": path.resolve(__dirname, "node_modules/entities-v4/lib/escape.js"),
};

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

// Seeded-volume performance probes. They plant representative row volumes and
// run EXPLAIN/ANALYZE, so they are the single most expensive DB consumer in
// the repository. GC-18 root-caused the transient gate flake to `57014`
// statement timeouts caused by DB-suite groups overlapping each other on one
// shared Postgres — so the perf probes now own their own sequence group and
// never run beside the RLS/integrity suites the CI gates depend on.
const PERF_INCLUDE = ["tests/perf/**/*.test.ts"];

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
        resolve: { alias },
        test: {
          name: "all-perf",
          environment: "node",
          globals: true,
          include: PERF_INCLUDE,
          maxWorkers: 1,
          minWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 3 },
          maxConcurrency: 1,
          testTimeout: 120_000,
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
      {
        // Live-UI suites: render React against the shared database. Same small
        // worker pool as `all-db` so they cannot starve GoTrue or Postgres.
        resolve: { alias },
        test: {
          name: "all-dom-db",
          environment: "jsdom",
          globals: true,
          include: ["tests/e2e/**/*.test.tsx"],
          maxWorkers: 2,
          minWorkers: 1,
          // Own group: live-UI suites must not share Postgres/GoTrue with the
          // `all-db` group (overlapping groups were the flake trigger).
          sequence: { groupOrder: 2 },
          maxConcurrency: 2,
          testTimeout: 90_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
