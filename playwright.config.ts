import { defineConfig } from "@playwright/test";

/**
 * The browser seam: Playwright driving the built web client served by an engine at the
 * engine seam. CI installs Playwright's Chromium; a local run uses the installed Chrome.
 */
export default defineConfig({
  testDir: "packages/web/test",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? "list" : "line",
  globalSetup: "./packages/web/test/globalSetup.ts",
  use: {
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
  },
});
