import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the game client.
 *
 * Deliberately no `webServer` block: the dev server is started by hand, and
 * the run attaches to it. Start it first with `npm run dev`, then
 * `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // The paid ledger is shared state; serial keeps it legible.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
