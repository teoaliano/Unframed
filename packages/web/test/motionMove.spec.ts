import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const zoomOf = async (page: Page): Promise<number> => {
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  return Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
};

test.setTimeout(150_000);

const openMover = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1, { timeout: 40_000 });
  await zoomOf(page);
};

const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file;

const editSummaries = async (engine: TestEngine): Promise<string[][]> => {
  const names = (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".json"));
  const found: string[][] = [];
  for (const name of names) {
    const sidecar = JSON.parse(await readFile(projectPath(engine, name), "utf8")) as { source?: string; edits?: string[] };
    if (sidecar.source === "edit") found.push(sidecar.edits ?? []);
  }
  return found;
};

const tweenStart = async (page: Page): Promise<number> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    const start = await frame.evaluate(() => {
      const timeline = (window as unknown as { __timelines?: { main: { getChildren(a: boolean, b: boolean, c: boolean): Array<{ startTime(): number }> } } }).__timelines;
      return timeline?.main.getChildren(true, true, false)[0]?.startTime();
    });
    if (typeof start === "number") return start;
  }
  throw new Error("no composition frame");
};

test("dragging a literal tween's bar moves the frame while the drag goes on, and one version is written 1.5 s after the release", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = await fileOf(agent);
  expect(before).toBeTruthy();
  const summaries = (await editSummaries(agent)).length;

  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const pxPerSecond = await zoomOf(page);
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });

  await expect.poll(() => tweenStart(page)).toBeGreaterThan(0.3);
  expect(await tweenStart(page)).toBeCloseTo(0.5, 1);
  await expect.poll(async () => Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(0.5, 1);

  await page.mouse.up();
  const released = Date.now();
  await page.waitForTimeout(800);
  expect(await fileOf(agent)).toBe(before);

  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(before);
  expect(Date.now() - released).toBeGreaterThanOrEqual(1400);

  await expect.poll(async () => (await editSummaries(agent)).length, { timeout: 10_000 }).toBe(summaries + 1);
  const latest = (await editSummaries(agent)).at(-1) ?? [];
  expect(latest).toEqual(["Moved Dot position to 0.5 s"]);
  await expect.poll(() => tweenStart(page).catch(() => Number.NaN), { timeout: 15_000 }).toBeCloseTo(0.5, 2);
});

test("Undo takes back the whole move, and the file the shape names goes back to the one before it", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = await fileOf(agent);
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const pxPerSecond = await zoomOf(page);
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(before);
  const moved = await fileOf(agent);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).toBe(before);
  expect(moved).not.toBe(before);
  await expect.poll(async () => Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(0, 2);
});

const SETTER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
tl.set("#dot", { opacity: 0.5 }, 1.5);
window.__timelines = { main: tl };
</script></body></html>`;

const setStart = async (page: Page): Promise<number> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    const start = await frame.evaluate(() => {
      const timeline = (window as unknown as { __timelines?: { main: { getChildren(a: boolean, b: boolean, c: boolean): Array<{ startTime(): number; vars?: unknown }> } } }).__timelines;
      return timeline?.main.getChildren(true, true, false)[1]?.startTime();
    });
    if (typeof start === "number") return start;
  }
  throw new Error("no composition frame");
};

test("dragging a set's diamond moves its instant in the frame, and the version says so", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: SETTER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page).first()).toBeVisible({ timeout: 40_000 });
  const pxPerSecond = await zoomOf(page);

  const before = await fileOf(agent);
  const diamond = timeline(page).locator('[data-testid="timeline-diamond"][data-tween="1"]').first();
  await expect(diamond).toBeVisible();
  const box = await diamond.boundingBox();
  if (!box) throw new Error("no diamond");
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 0.5 * pxPerSecond, y, { steps: 8 });
  await expect.poll(() => setStart(page)).toBeCloseTo(2, 1);
  await page.mouse.up();

  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(before);
  const latest = (await editSummaries(agent)).at(-1) ?? [];
  expect(latest).toHaveLength(1);
  expect(latest[0]).toMatch(/^Moved Dot visual to 2(\.0+)? s$/);
});
