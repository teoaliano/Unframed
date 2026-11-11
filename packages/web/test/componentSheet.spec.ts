import { test } from "@playwright/test";
import { openCanvas } from "./canvas.ts";
import { writeSheet } from "./components.ts";
import { expect, startHostedEngine } from "./fixtures.ts";

test("a sheet opened on its own shows its board: one labelled cell per combination, each with the example", async ({ page }) => {
  const engine = await startHostedEngine();
  try {
    await openCanvas(page, engine);
    await writeSheet(engine, { tag: "uf-price-card", variants: { kind: ["primary", "secondary"], size: ["sm", "md"] }, example: "<span>Example</span>" });
    await page.goto(`http://127.0.0.1:${engine.previewPort}/p/default/1761400000000-price-card.html`);
    await expect(page.getByText("primary · sm", { exact: true })).toBeVisible();
    await expect(page.getByText("secondary · md", { exact: true })).toBeVisible();
    await expect(page.locator("uf-price-card")).toHaveCount(4);
    await expect(page.locator("uf-price-card").first().locator("span")).toHaveText("Example");
    const background = await page.locator("uf-price-card").first().evaluate((host) => getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor);
    expect(background).toBe("rgb(17, 17, 17)");
  } finally {
    await engine.dispose();
  }
});

test("a sheet with no variants shows one cell, labelled Default", async ({ page }) => {
  const engine = await startHostedEngine();
  try {
    await openCanvas(page, engine);
    await writeSheet(engine, { tag: "uf-plain-card" }, "1761400000001-plain-card.html");
    await page.goto(`http://127.0.0.1:${engine.previewPort}/p/default/1761400000001-plain-card.html`);
    await expect(page.getByText("Default", { exact: true })).toBeVisible();
    await expect(page.locator("uf-plain-card")).toHaveCount(1);
  } finally {
    await engine.dispose();
  }
});
