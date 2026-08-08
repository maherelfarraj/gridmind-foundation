// GC-17 — real-browser verification (Playwright).
//
// Runs Chromium against the locally served app (the dev preview on :8080 is
// reused when it is already up, otherwise Playwright starts it). Deterministic,
// tenant-isolated fixtures are created in globalSetup and purged in
// globalTeardown. Traces and screenshots stay local test artifacts.
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.GC17_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  globalTeardown: "./tests/browser/global-teardown.ts",
  // One shared Postgres + GoTrue behind every worker: keep it serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: "test-results/browser-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1200 },
        launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
      },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
