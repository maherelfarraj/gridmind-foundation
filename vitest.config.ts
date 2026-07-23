import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit-test config. Runs only tests/unit/**.
// Full suite (unit + api + rls) lives in vitest.config.all.ts.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
  },
});
