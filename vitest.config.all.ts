import { defineConfig } from "vitest/config";
import path from "node:path";

// Full-suite config: unit + api + rls projects.
// Unit-only runs use vitest.config.ts.
const alias = { "@": path.resolve(__dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
          globals: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "api",
          environment: "node",
          include: ["tests/api/**/*.{test,spec}.{ts,tsx}"],
          globals: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "rls",
          environment: "node",
          include: ["tests/rls/**/*.{test,spec}.{ts,tsx}"],
          globals: true,
        },
      },
    ],
  },
});
