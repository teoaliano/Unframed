import type { Page } from "@playwright/test";
import { openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const SHAPE = "shape:landing";
const LONG_TITLE = "Long ".repeat(40).trim();
const editor = (page: Page) => page.getByTestId("artifact-editor");
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);
const region = (page: Page, title: string) => page.getByRole("region", { name: `Editing ${title}` });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return box;
};

const MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };</script></body></html>`;

/** Opens a page, or a motion, in the editor, then sets the window to the size asked for: the shape is opened in a window that shows it. */
const openEditor = async (page: Page, engine: TestEngine, options: { kind: "page" | "motion"; title: string; width?: number; height?: number }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCanvas(page, engine);
  await filledArtifact(engine, {
    id: SHAPE,
    kind: options.kind,
    ref: "150",
    at: { x: -520, y: -40 },
    size: { w: 480, h: 270 },
    title: options.title,
    html: options.kind === "page" ? "<h1>Welcome</h1>" : MOTION,
  });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  const shown = await boxOf(shapeOnScreen(page, SHAPE));
  const { width } = page.viewportSize()!;
  await page.mouse.dblclick((Math.max(shown.x, 0) + Math.min(shown.x + shown.width, width)) / 2, shown.y + shown.height / 2);
  await expect(editor(page)).toBeVisible();
  if (options.width !== undefined) await page.setViewportSize({ width: options.width, height: options.height ?? 700 });
};

test("below 1000 px the agent rail folds into a Show agent sheet, and below 720 px the parameters fold into a Show parameters sheet", async ({ page, agent }) => {
  await openEditor(page, agent, { kind: "page", title: "Landing", width: 800, height: 600 });
  await expect(column(page, "rail")).toBeHidden();
  await expect(column(page, "parameters")).toBeVisible();
  // The preview column keeps the width the rail leaves.
  expect((await boxOf(column(page, "centre"))).width).toBeGreaterThan(400);
  await editor(page).getByRole("button", { name: "Show agent" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("complementary", { name: "Agent" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(editor(page)).toBeVisible();

  await page.setViewportSize({ width: 640, height: 800 });
  await expect(column(page, "parameters")).toBeHidden();
  await expect(column(page, "rail")).toBeHidden();
  // The preview column takes the window less its padding.
  expect((await boxOf(column(page, "centre"))).width).toBeGreaterThan(600);
  await editor(page).getByRole("button", { name: "Show parameters" }).click();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Design" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(editor(page)).toBeVisible();
});

test("a 200-character title truncates with an ellipsis and never runs under the controls at 1440 px", async ({ page, agent }) => {
  await openEditor(page, agent, { kind: "page", title: LONG_TITLE });
  const title = editor(page).getByTestId("artifact-editor-title");
  await expect(title).toHaveText(LONG_TITLE);
  expect(await title.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const box = await boxOf(title);
  for (const control of [region(page, LONG_TITLE).getByRole("group", { name: "Mode" }), editor(page).getByRole("button", { name: "Open in a new tab" })]) {
    const other = await boxOf(control);
    expect(box.x + box.width <= other.x || other.x + other.width <= box.x).toBe(true);
  }
  // The full title is in a tooltip.
  await title.hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText(LONG_TITLE);
});

test("a 200-character title does not run under the controls at 1024 px", async ({ page, agent }) => {
  await openEditor(page, agent, { kind: "page", title: LONG_TITLE, width: 1024, height: 700 });
  const title = editor(page).getByTestId("artifact-editor-title");
  const box = await boxOf(title);
  const mode = await boxOf(region(page, LONG_TITLE).getByRole("group", { name: "Mode" }));
  expect(box.x + box.width <= mode.x).toBe(true);
  expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test("the mode toggle items keep their names in tooltips once their labels fold into icons", async ({ page, agent }) => {
  await openEditor(page, agent, { kind: "page", title: "Landing", width: 1024, height: 700 });
  const group = region(page, "Landing").getByRole("group", { name: "Mode" });
  await group.getByRole("button", { name: "Interact", exact: true }).hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("Interact (I)");
  await group.getByRole("button", { name: "Edit", exact: true }).hover();
  await expect(page.locator("[data-slot='tooltip-popup']")).toHaveText("Edit (V)");
});

test("the transport keeps Zoom in, Fit to length and Hide timeline reachable in a 320 px strip", async ({ page, agent }) => {
  // A window of 344 px leaves a strip of 320 px: the narrowest the editor's motion strip gets.
  await openEditor(page, agent, { kind: "motion", title: "Intro", width: 344, height: 700 });
  const transport = timeline(page).getByTestId("timeline-transport");
  await expect(transport).toBeVisible();
  const frame = await boxOf(transport);
  for (const name of ["Zoom in", "Fit to length", "Hide timeline"]) {
    const control = await boxOf(timeline(page).getByRole("button", { name, exact: true }));
    expect(control.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(control.x + control.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  }
  expect(await transport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("the transport keeps Zoom in, Fit to length and Hide timeline reachable at 800 px", async ({ page, agent }) => {
  await openEditor(page, agent, { kind: "motion", title: "Intro", width: 800, height: 600 });
  await expect(timeline(page).getByRole("button", { name: "Zoom in", exact: true })).toBeVisible();
  await timeline(page).getByRole("button", { name: "Zoom in", exact: true }).click();
  await timeline(page).getByRole("button", { name: "Fit to length", exact: true }).click();
  await timeline(page).getByRole("button", { name: "Hide timeline", exact: true }).click();
  await expect(timeline(page).getByRole("button", { name: "Show timeline", exact: true })).toBeVisible();
});
