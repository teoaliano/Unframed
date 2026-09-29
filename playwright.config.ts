import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Specs that copy, paste or read what the clipboard holds. Every browser this machine runs
 * shares one system clipboard, so these run one at a time in their own project, and no
 * other spec may touch the clipboard: a spec that starts to must be added here.
 */
const CLIPBOARD = /\/(contextMenu|copyImage|copyPaste|groupPaste|groupRefs|menuActions|pasteAcross|resultCopies|systemPaste|textCopies)\.spec\.ts$/;

/** A local run on a Mac starts the installed Chrome through this script: it says why. */
const macChrome = process.env.CI || process.platform !== "darwin" ? undefined : fileURLToPath(new URL("packages/web/test/chrome.sh", import.meta.url));

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
    ...(macChrome === undefined ? {} : { launchOptions: { executablePath: macChrome } }),
    headless: true,
  },
  projects: [
    { name: "canvas", testIgnore: CLIPBOARD },
    { name: "clipboard", testMatch: CLIPBOARD, workers: 1 },
  ],
});
