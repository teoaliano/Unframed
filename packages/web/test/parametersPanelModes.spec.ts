import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { clickShape } from "./generation.ts";
import { dialsPage, filledArtifact, writeBridge } from "./artifacts.ts";

const panel = (page: Page) => page.getByRole("region", { name: "Parameters for Tuned" });
const toggle = (page: Page) => page.getByTestId("selection-toolbar").getByRole("button", { name: "Parameters" });
const savedPanel = async (engine: Parameters<typeof openCanvas>[1]) =>
  (await (await engine.rpc()).call("preferences.get", { keys: ["parameters.panel"] })).values["parameters.panel"] as Record<string, unknown> | undefined;

const onBoard = async (page: Page, engine: Parameters<typeof openCanvas>[1]) => {
  await openCanvas(page, engine);
  await writeBridge(engine);
  await filledArtifact(engine, { id: "shape:tuned", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 300, h: 200 }, title: "Tuned", html: dialsPage({ size: [10, 0, 100, 1], accent: "#a78bfa" }) });
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible();
};

const openPanel = async (page: Page) => {
  await clickShape(page, "shape:tuned");
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("slider", { name: "Size" })).toBeVisible();
};

const boxOf = async (page: Page) => {
  await panel(page).evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  return (await panel(page).boundingBox())!;
};

const dragBy = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (dx * step) / 8, from.y + (dy * step) / 8);
  await page.mouse.up();
};

test("the floating panel starts beside its page, stays put while the canvas pans, and drags anywhere by its header, kept on screen", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  await expect(panel(page)).toHaveAttribute("data-mode", "float");
  const shape = (await shapeOnScreen(page, "shape:tuned").boundingBox())!;
  const first = await boxOf(page);
  expect(first.x).toBeGreaterThanOrEqual(shape.x + shape.width);
  expect(Math.abs(first.y - shape.y)).toBeLessThanOrEqual(1);

  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await shapeOnScreen(page, "shape:tuned").boundingBox())!.y).toBeLessThan(shape.y - 100);
  expect(await boxOf(page)).toEqual(first);

  const header = panel(page).locator("header");
  await dragBy(page, { x: first.x + 60, y: first.y + 24 }, 300, 150);
  const moved = await boxOf(page);
  expect(Math.round(moved.x - first.x)).toBe(300);
  expect(Math.round(moved.y - first.y)).toBe(150);
  await expect.poll(() => savedPanel(agent)).toMatchObject({ mode: "float", x: Math.round(moved.x), y: Math.round(moved.y) });

  await dragBy(page, { x: moved.x + 60, y: moved.y + 24 }, 3000, -3000);
  const viewport = page.viewportSize()!;
  const edge = await boxOf(page);
  expect(edge.x + edge.width).toBeLessThanOrEqual(viewport.width - 8 + 0.5);
  expect(edge.y).toBeGreaterThanOrEqual(36 + 8 - 0.5);
  await expect(header).toBeVisible();

  await page.reload();
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible({ timeout: 20_000 });
  await openPanel(page);
  expect(await boxOf(page)).toEqual(edge);
});

test("the floating panel resizes from its corner, by pointer and by arrow keys, and remembers its size", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const before = await boxOf(page);
  expect(Math.round(before.width)).toBe(320);
  const handle = panel(page).getByRole("separator", { name: "Resize parameters" });
  const grip = (await handle.boundingBox())!;
  await dragBy(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, 120, 140);
  const after = await boxOf(page);
  expect(Math.round(after.width)).toBe(440);
  expect(Math.round(after.height)).toBe(Math.round(before.height + 140));
  expect(after.x).toBe(before.x);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(424);
  await expect.poll(() => savedPanel(agent)).toMatchObject({ w: 424, h: Math.round(after.height) });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await openPanel(page);
  expect(Math.round((await boxOf(page)).width)).toBe(424);
});

test("the header toggle docks the panel as a right drawer under the top bar, remembered, and floats it back where it was", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const floating = await boxOf(page);
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  const viewport = page.viewportSize()!;
  await expect.poll(async () => Math.round((await boxOf(page)).x)).toBe(viewport.width - 320);
  const docked = await boxOf(page);
  expect(Math.round(docked.width)).toBe(320);
  expect(Math.round(docked.y)).toBe(36);
  expect(Math.round(docked.y + docked.height)).toBe(viewport.height);
  await expect(panel(page).getByRole("slider", { name: "Size" })).toBeVisible();
  await expect(panel(page).getByRole("separator", { name: "Resize parameters" })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const watermark = document.querySelector(".tl-watermark_SEE-LICENSE");
    if (!watermark) return false;
    const box = watermark.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".tl-watermark_SEE-LICENSE") === watermark;
  })).toBe(true);
  await expect.poll(() => savedPanel(agent)).toMatchObject({ mode: "dock" });

  await page.reload();
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible({ timeout: 20_000 });
  await openPanel(page);
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await panel(page).getByRole("button", { name: "Float parameters" }).click();
  await expect(panel(page)).toHaveAttribute("data-mode", "float");
  await expect.poll(async () => (await boxOf(page)).x).toBe(floating.x);
});
