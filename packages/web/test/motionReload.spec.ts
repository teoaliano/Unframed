import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
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
const readout = (page: Page) => timeline(page).getByTestId("timeline-readout");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const frameTime = async (page: Page): Promise<number | undefined> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    const time = await frame.evaluate(() => (window as unknown as { __timelines?: { main: { time(): number } } }).__timelines?.main.time()).catch(() => undefined);
    if (typeof time === "number") return time;
  }
  return undefined;
};
const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file;

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
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
};

const dragBar = async (page: Page) => {
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });
  await page.mouse.up();
};

test("after a new version the playhead stays where it was, paused, and the edited bar does not jump back while the new reading loads", async ({ page, agent }) => {
  await openMover(page, agent);
  await timeline(page).getByTestId("timeline-rows").click();
  for (let step = 0; step < 6; step++) await page.keyboard.press("Shift+ArrowRight");
  await expect(readout(page)).toContainText("0:02.00", { timeout: 10_000 });

  const before = await fileOf(agent);
  await dragBar(page);
  const starts: Array<string | null> = [];
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    starts.push((await bar(page).count()) === 0 ? null : await bar(page).getAttribute("data-start"));
  }
  await expect.poll(() => fileOf(agent), { timeout: 1000 }).not.toBe(before);
  expect(starts.length).toBeGreaterThan(20);
  expect(starts.every((start) => start !== null && Math.abs(Number(start) - 0.5) < 0.05)).toBe(true);

  await expect(readout(page)).toContainText("0:02.00", { timeout: 15_000 });
  await expect.poll(() => frameTime(page), { timeout: 15_000 }).toBeCloseTo(2, 1);
  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  await expect(bar(page)).toHaveAttribute("data-start", "0.5", { timeout: 15_000 });
});

test("after a new version a playing motion keeps playing from where it was", async ({ page, agent }) => {
  await openMover(page, agent);
  await timeline(page).getByTestId("timeline-rows").click();
  for (let step = 0; step < 6; step++) await page.keyboard.press("Shift+ArrowRight");
  await expect(readout(page)).toContainText("0:02.00", { timeout: 10_000 });
  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();

  const before = await fileOf(agent);
  await dragBar(page);
  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(before);
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(readout(page)).toContainText(/0:0[2-3]\.\d\d \/ 0:04\.00/);
  await expect.poll(() => frameTime(page), { timeout: 15_000 }).toBeGreaterThan(2);
});
