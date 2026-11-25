import type { Page } from "@playwright/test";
import { openCanvas, settledRecord, shapeOnScreen } from "./canvas.ts";
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

const watermarkOnTop = (page: Page) =>
  page.evaluate(() => {
    const watermark = document.querySelector(".tl-watermark_SEE-LICENSE");
    if (!watermark) return false;
    const box = watermark.getBoundingClientRect();
    return [0.2, 0.5, 0.8].every((fx) => document.elementFromPoint(box.x + box.width * fx, box.y + box.height / 2)?.closest(".tl-watermark_SEE-LICENSE") === watermark);
  });

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
  await expect.poll(() => savedPanel(agent)).toMatchObject({ mode: "float", x: Math.round(edge.x), y: Math.round(edge.y) });

  await page.reload();
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible({ timeout: 20_000 });
  await openPanel(page);
  expect(await boxOf(page)).toEqual(edge);
});

const edgeOf = (page: Page, edge: string) => panel(page).locator(`[data-panel-edge="${edge}"]`);
const middleOf = async (locator: ReturnType<typeof edgeOf>) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("the floating panel resizes from every edge and corner with no visible grip, by Shift and the arrow keys, and remembers its size", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const start = await boxOf(page);
  await dragBy(page, { x: start.x + 60, y: start.y + 24 }, 600 - start.x, 200 - start.y);
  const before = await boxOf(page);
  expect(Math.round(before.x)).toBe(600);
  expect(Math.round(before.width)).toBe(320);
  await expect(panel(page).getByRole("separator")).toHaveCount(0);

  await dragBy(page, await middleOf(edgeOf(page, "e")), 80, 0);
  let box = await boxOf(page);
  expect(Math.round(box.width)).toBe(400);
  expect(box.x).toBe(before.x);

  await dragBy(page, await middleOf(edgeOf(page, "w")), -40, 0);
  box = await boxOf(page);
  expect(Math.round(box.width)).toBe(440);
  expect(Math.round(box.x)).toBe(Math.round(before.x) - 40);
  expect(Math.round(box.x + box.width)).toBe(Math.round(before.x + 400));

  await dragBy(page, await middleOf(edgeOf(page, "s")), 0, 60);
  const tall = await boxOf(page);
  expect(Math.round(tall.height)).toBe(Math.round(before.height + 60));

  await dragBy(page, await middleOf(edgeOf(page, "n")), 0, -30);
  box = await boxOf(page);
  expect(Math.round(box.y)).toBe(Math.round(tall.y) - 30);
  expect(Math.round(box.y + box.height)).toBe(Math.round(tall.y + tall.height));

  await dragBy(page, await middleOf(edgeOf(page, "se")), -40, 20);
  const after = await boxOf(page);
  expect(Math.round(after.width)).toBe(400);
  expect(Math.round(after.height)).toBe(Math.round(box.height + 20));

  await panel(page).getByRole("button", { name: "Move parameters" }).focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(384);
  expect(Math.round((await boxOf(page)).x)).toBe(Math.round(after.x));
  await expect.poll(() => savedPanel(agent)).toMatchObject({ w: 384, h: Math.round(after.height) });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await openPanel(page);
  expect(Math.round((await boxOf(page)).width)).toBe(384);
});

test("the header toggle docks the panel as a right drawer under the top bar, remembered, and floats it back where it was", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const floating = await boxOf(page);
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  const viewport = page.viewportSize()!;
  await expect.poll(async () => Math.round((await boxOf(page)).x)).toBe(viewport.width - 380);
  const docked = await boxOf(page);
  expect(Math.round(docked.width)).toBe(380);
  expect(Math.round(docked.y)).toBe(36);
  expect(Math.round(docked.y + docked.height)).toBe(viewport.height);
  await expect(panel(page).getByRole("slider", { name: "Size" })).toBeVisible();
  await expect(panel(page).locator("[data-panel-edge]")).toHaveCount(0);
  expect(await watermarkOnTop(page)).toBe(true);
  await expect.poll(() => savedPanel(agent)).toMatchObject({ mode: "dock" });

  await page.reload();
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible({ timeout: 20_000 });
  await openPanel(page);
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await panel(page).getByRole("button", { name: "Float parameters" }).click();
  await expect(panel(page)).toHaveAttribute("data-mode", "float");
  await expect.poll(async () => (await boxOf(page)).x).toBe(floating.x);
});

test("the docked drawer resizes from its left edge by pointer and arrow keys from 320 to 640 px, remembered, and a double-click restores 380 px", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await onBoard(page, agent);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await expect(panel(page)).toHaveAttribute("data-shown", "dock");
  const grip = panel(page).getByRole("separator", { name: "Resize parameters drawer" });
  const docked = await boxOf(page);
  await dragBy(page, await middleOf(grip), -100, 0);
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(480);
  expect(Math.round((await boxOf(page)).x + (await boxOf(page)).width)).toBe(1920);
  await expect.poll(() => savedPanel(agent)).toMatchObject({ mode: "dock", dockW: 480 });
  await dragBy(page, await middleOf(grip), -1000, 0);
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(640);
  await dragBy(page, await middleOf(grip), 1000, 0);
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(320);
  await grip.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(336);
  await expect(grip).toHaveAttribute("aria-valuenow", "336");
  await expect.poll(() => savedPanel(agent)).toMatchObject({ dockW: 336 });

  await page.reload();
  await expect(shapeOnScreen(page, "shape:tuned")).toBeVisible({ timeout: 20_000 });
  await openPanel(page);
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(336);
  await panel(page).getByRole("separator", { name: "Resize parameters drawer" }).dblclick();
  await expect.poll(async () => Math.round((await boxOf(page)).width)).toBe(Math.round(docked.width));
});

test("the first float of a page scaled to 50 % starts 12 px right of the page as drawn, level with its top", async ({ page, agent }) => {
  await onBoard(page, agent);
  await clickShape(page, "shape:tuned");
  await page.getByTestId("selection-toolbar").getByTestId("artifact-scale").click();
  await page.getByRole("menuitemradio", { name: "50%", exact: true }).click();
  await expect.poll(async () => (await settledRecord(agent, "default", "shape:tuned"))?.props).toMatchObject({ w: 150, h: 100, scale: 0.5 });
  await toggle(page).click();
  await expect(panel(page).getByRole("slider", { name: "Size" })).toBeVisible();
  const shape = (await shapeOnScreen(page, "shape:tuned").boundingBox())!;
  expect(Math.round(shape.width)).toBe(150);
  const first = await boxOf(page);
  expect(Math.round(first.x - (shape.x + shape.width))).toBe(12);
  expect(Math.abs(first.y - shape.y)).toBeLessThanOrEqual(1);
});

test("the watermark stays over the floating panel pushed into the bottom-right corner and resized, and over the docked drawer", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const first = await boxOf(page);
  await dragBy(page, { x: first.x + 60, y: first.y + 24 }, 3000, 3000);
  await dragBy(page, await middleOf(edgeOf(page, "se")), 400, 400);
  const placed = await boxOf(page);
  const host = await page.locator(".tl-watermark_SEE-LICENSE").boundingBox();
  expect(placed.x + placed.width).toBeGreaterThan(host!.x);
  expect(await watermarkOnTop(page)).toBe(true);
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await boxOf(page);
  expect(await watermarkOnTop(page)).toBe(true);
});

const shapeX = async (page: Page) => (await shapeOnScreen(page, "shape:tuned").boundingBox())!.x;

const wheelOver = async (page: Page, at: { x: number; y: number }) => {
  const before = await shapeX(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(150, 0);
  await expect.poll(() => shapeX(page)).not.toBe(before);
};

test("a wheel over the panel's header reaches the canvas, floating, docked and floating again", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const header = async () => {
    const box = (await panel(page).locator("header").boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  await boxOf(page);
  await wheelOver(page, await header());
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await boxOf(page);
  await wheelOver(page, await header());
  await panel(page).getByRole("button", { name: "Float parameters" }).click();
  await boxOf(page);
  await wheelOver(page, await header());
});

test("the floating panel moves with the arrow keys from its move handle", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const before = await boxOf(page);
  const handle = panel(page).getByRole("button", { name: "Move parameters" });
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round((await boxOf(page)).y - before.y)).toBe(16);
  expect(Math.round((await boxOf(page)).x - before.x)).toBe(-16);
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => savedPanel(agent)).toMatchObject({ x: Math.round(before.x) - 16, y: Math.round(before.y) + 16 });
});

test("the floating panel stays on screen when the canvas shrinks", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  const first = await boxOf(page);
  await dragBy(page, { x: first.x + 60, y: first.y + 24 }, 3000, 0);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => { const box = await boxOf(page); return box.x + box.width; }).toBeLessThanOrEqual(900 - 8 + 0.5);
});

for (const width of [1280, 1440]) {
  test(`at ${width} px the agent rail and the docked drawer open together, the same shape on both sides`, async ({ page, agent }) => {
    await page.setViewportSize({ width, height: 900 });
    await onBoard(page, agent);
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
    await expect(panel(page)).toHaveAttribute("data-shown", "dock");
    await page.locator("[data-unframed-toolbar]").getByRole("button", { name: "Agent", exact: true }).click();
    const rail = page.locator("[data-slot='docked-rail'][data-state='open']");
    await expect(rail).toBeVisible();
    await rail.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const railBox = (await rail.boundingBox())!;
    const drawer = await boxOf(page);
    expect(Math.round(drawer.width)).toBe(Math.round(railBox.width));
    expect(Math.round(drawer.y)).toBe(Math.round(railBox.y));
    expect(Math.round(drawer.y + drawer.height)).toBe(Math.round(railBox.y + railBox.height));
    expect(Math.round(drawer.x + drawer.width)).toBe(width);
    const look = (locator: typeof rail) => locator.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderColor }));
    expect(await look(panel(page))).toEqual(await look(rail));
  });
}

test("below 1280 px the docked panel opens as a sheet on the right", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openPanel(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await panel(page).getByRole("button", { name: "Dock parameters to the right" }).click();
  await expect(panel(page)).toHaveAttribute("data-shown", "sheet");
  await expect(page.getByRole("dialog").getByRole("region", { name: "Parameters for Tuned" })).toBeVisible();
  await expect(panel(page).getByRole("slider", { name: "Size" })).toBeVisible();
  const sheet = (await page.getByRole("dialog").boundingBox())!;
  const watermark = (await page.locator(".tl-watermark_SEE-LICENSE").boundingBox())!;
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(watermark.y);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});
