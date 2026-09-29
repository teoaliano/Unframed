import { readdir, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { webDist } from "./fixtures.ts";

/*
 * Spec 13: the design-system catalogue exists in the web dev server only. These start that
 * server on a free port, as `pnpm dev` does, and read the build the other specs serve.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
let server: ViteDevServer;
let origin: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  server = await createServer({ root: webRoot, configFile: join(webRoot, "vite.config.ts"), server: { port: 0, strictPort: false }, logLevel: "silent" });
  await server.listen();
  origin = `http://localhost:${(server.httpServer!.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await server.close();
});

test("the menu lists the tokens, every file in the kit folder and the Unframed recipes", async ({ page }) => {
  await page.goto(`${origin}/design-system/`);
  const menu = page.getByRole("navigation", { name: "Components" });
  await expect(menu.getByRole("link", { name: "Tokens" })).toBeVisible();
  const kit = (await readdir(join(webRoot, "src/components/ui"))).filter((file) => file.endsWith(".tsx"));
  for (const file of kit) await expect(menu.locator(`a[href="#${file.slice(0, -4)}"]`)).toHaveCount(1);
  await expect(menu.getByRole("link", { name: "Message action" })).toBeVisible();
});

test("a component's page shows its examples, the variants read from its source and where the product uses it", async ({ page }) => {
  await page.goto(`${origin}/design-system/#button`);
  await expect(page.getByRole("heading", { name: "Button", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Examples" })).toBeVisible();
  const variants = page.getByRole("row").filter({ hasText: /^variant/ });
  await expect(variants).toContainText("outline");
  await expect(variants).toContainText("ghost");
  const usages = page.getByTestId("usages").first();
  await expect(usages.locator("[data-usage-file='/src/generate/SelectionToolbar.tsx']")).toBeVisible();
  await expect(usages.locator("[data-usage-file='/src/generate/SelectionToolbar.tsx']")).toContainText("<Button");
});

test("the tokens page resolves the theme's tokens in the current scheme", async ({ page }) => {
  await page.goto(`${origin}/design-system/#tokens`);
  const background = page.locator("[data-token='--background']");
  await expect(background).toBeVisible();
  await expect(background).not.toContainText("not emitted");
});

test("the production build carries none of the catalogue", async () => {
  const files = await readdir(webDist(), { recursive: true });
  expect(files.filter((file) => file.includes("design-system"))).toEqual([]);
  for (const file of files.filter((each) => /\.(js|html)$/.test(each))) {
    expect(await readFile(join(webDist(), file), "utf8")).not.toContain("Unframed design system");
  }
});

test("every entry has a demo, and every page renders without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${origin}/design-system/`);
  const menu = page.getByRole("navigation", { name: "Components" });
  await expect(menu.getByText("no demo")).toHaveCount(0);
  const ids = await menu.locator("a[href^='#']").evaluateAll((links) => links.map((link) => link.getAttribute("href")!.slice(1)));
  for (const id of new Set(ids)) {
    await page.goto(`${origin}/design-system/#${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Examples" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
