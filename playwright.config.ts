import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const CLIPBOARD = /\/(agentCopyText|agentMarkdown|artifactPaste|agentPlanCopy|contextMenu|copyImage|componentPaste|copyPaste|groupPaste|groupRefs|menuActions|pasteAcross|resultCopies|systemPaste|textCopies)\.spec\.ts$/;

const ISOLATED = /\/projectTabsPerformance\.spec\.ts$/;

const macChrome = process.env.CI || process.platform !== "darwin" ? undefined : fileURLToPath(new URL("packages/web/test/chrome.sh", import.meta.url));

export default defineConfig({
  testDir: "packages/web/test",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  globalSetup: "./packages/web/test/globalSetup.ts",
  use: {
    channel: process.env.CI ? undefined : "chrome",
    launchOptions: { args: ["--site-per-process"], ...(macChrome === undefined ? {} : { executablePath: macChrome }) },
    headless: true,
  },
  projects: [
    { name: "canvas", testIgnore: [CLIPBOARD, ISOLATED] },
    { name: "clipboard", testMatch: CLIPBOARD, workers: 1 },
    { name: "isolated", testMatch: ISOLATED, workers: 1 },
  ],
});
