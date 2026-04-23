import { defineConfig, devices } from "@playwright/test";

/** Run `npm run test:e2e` from the `world/` directory so `cwd` matches the monorepo root. */
const repoRoot = process.cwd();

export default defineConfig({
  testDir: "e2e",
  // One worker: tests share one Colyseus room; parallel runs would stack multiple "players" and skew screenshots.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:e2e",
    cwd: repoRoot,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
