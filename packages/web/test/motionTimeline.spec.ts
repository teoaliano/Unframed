import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { artifactShape, filledArtifact, insideComposition } from "./artifacts.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

const SHAPE = "shape:intro";
const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const column = (page: Page, name: "rail" | "centre" | "parameters") => editor(page).locator(`[data-editor-column="${name}"]`);

test.setTimeout(150_000);

const openMotion = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

const expectRestoredEditor = async (page: Page) => {
  await expect(region(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-slot=top-bar] [role=tab][data-active='true']")).toHaveAccessibleName("Intro, default");
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

const dragBy = async (page: Page, locator: Locator, dy: number) => {
  const at = await centre(locator);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + dy, { steps: 8 });
  await page.mouse.up();
};

test("a motion with a file opens its timeline under the frame, and a page has none", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openMotion(page);

  const strip = await boxOf(timeline(page));
  expect(strip.height).toBeGreaterThanOrEqual(230);
  expect(strip.height).toBeLessThanOrEqual(250);
  const frame = await boxOf(editor(page).getByTestId("artifact-preview"));
  expect(frame.y + frame.height).toBeLessThanOrEqual(strip.y + 1);
  const centreColumn = await boxOf(column(page, "centre"));
  expect(Math.abs(strip.x - centreColumn.x)).toBeLessThanOrEqual(1);
  expect(strip.width).toBeCloseTo(centreColumn.width, 0);
  await expect(region(page).frameLocator("iframe[data-artifact-frame]").locator("hyperframes-player")).not.toHaveAttribute("controls", "");
});

test("a page has no timeline", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "151", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: "<!doctype html><html><body><p>Hi</p></body></html>" });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Landing" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Timeline for/ })).toHaveCount(0);
});

test("a motion with no file has no timeline", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, [artifactShape({ id: SHAPE, kind: "motion", ref: "152", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro" })]);
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openMotion(page);
  await expect(region(page).getByText("This motion has no file yet. Ask the agent to write one.")).toBeVisible();
  await expect(timeline(page)).toHaveCount(0);
});

test("the timeline resizes by its top border between 120 px and 60 % of the column, and keeps its height after a reload", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openMotion(page);

  const handle = timeline(page).getByRole("separator", { name: "Resize the timeline" });
  const before = (await boxOf(timeline(page))).height;
  await dragBy(page, handle, -80);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(before + 80, -1);

  await dragBy(page, handle, 1000);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(120, 0);

  await dragBy(page, timeline(page).getByRole("separator", { name: "Resize the timeline" }), -2000);
  const fullColumn = async () => (await boxOf(column(page, "centre"))).height + (await boxOf(timeline(page))).height + 12;
  const cap = Math.floor((await fullColumn()) * 0.6);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(cap, 0);

  await dragBy(page, timeline(page).getByRole("separator", { name: "Resize the timeline" }), 1000);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(120, 0);
  await dragBy(page, timeline(page).getByRole("separator", { name: "Resize the timeline" }), -60);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(180, 0);

  await expect
    .poll(async () => (await (await agent.rpc()).call("preferences.get", { keys: ["editor.timeline"] })).values["editor.timeline"], { timeout: 10_000 })
    .toEqual({ height: 180, open: true });
  await page.reload();
  await expectRestoredEditor(page);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(180, 0);
});

test("Hide timeline collapses the strip to its transport row, Show timeline opens it, and the choice is kept after a reload", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openMotion(page);

  await timeline(page).getByRole("button", { name: "Hide timeline" }).click();
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(40, 0);
  await expect(timeline(page).getByRole("separator", { name: "Resize the timeline" })).toHaveCount(0);
  await expect(timeline(page).getByRole("button", { name: "Show timeline" })).toBeVisible();
  await expect
    .poll(async () => (await (await agent.rpc()).call("preferences.get", { keys: ["editor.timeline"] })).values["editor.timeline"], { timeout: 10_000 })
    .toEqual({ height: 240, open: false });

  await page.reload();
  await expectRestoredEditor(page);
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(40, 0);
  await timeline(page).getByRole("button", { name: "Show timeline" }).click();
  await expect.poll(async () => (await boxOf(timeline(page))).height).toBeCloseTo(240, -1);
  await expect(timeline(page).getByRole("button", { name: "Hide timeline" })).toBeVisible();
});

test("below a 1280 px window the strip spans the centre and right columns, and the right column ends above it", async ({ page, agent }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await openMotion(page);

  const strip = await boxOf(timeline(page));
  const centreBox = await boxOf(column(page, "centre"));
  const rightBox = await boxOf(column(page, "parameters"));
  expect(Math.abs(strip.x - centreBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(strip.x + strip.width - (rightBox.x + rightBox.width))).toBeLessThanOrEqual(1);
  expect(rightBox.y + rightBox.height).toBeLessThanOrEqual(strip.y + 1);
});

test("on the canvas the motion's player keeps its own controls", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.click(at.x, at.y);
  const player = shapeOnScreen(page, SHAPE).frameLocator("iframe[data-artifact-frame]").locator("hyperframes-player");
  await expect(player).toHaveAttribute("controls", "", { timeout: 40_000 });
  await expect(insideComposition(shapeOnScreen(page, SHAPE).frameLocator("iframe[data-artifact-frame]")).locator("#dot")).toBeAttached({ timeout: 40_000 });
});
