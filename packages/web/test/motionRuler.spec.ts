import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A four-second motion whose dot moves across the composition, so the clock and the composition have to agree. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const readout = (page: Page) => timeline(page).getByTestId("timeline-readout");
const ruler = (page: Page) => timeline(page).getByTestId("timeline-ruler");
const track = (page: Page) => timeline(page).getByTestId("timeline-track");
const zoomOf = async (page: Page): Promise<number> => Number(await track(page).getAttribute("data-px-per-second"));
const range = (page: Page) => timeline(page).getByTestId("timeline-range");

/** The clock's seconds, read from the readout's `m:ss.cc`. */
const secondsOf = async (page: Page): Promise<number> => {
  const match = /^(\d+):(\d\d)\.(\d\d)/.exec((await readout(page).textContent()) ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100 : Number.NaN;
};

/** The composition's own time, read from its timeline. */
const compositionTime = async (page: Page): Promise<number> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    const time = await frame.evaluate(() => (window as unknown as { __timelines?: { main: { time(): number } } }).__timelines?.main.time());
    if (typeof time === "number") return time;
  }
  throw new Error("no composition frame");
};

// A motion takes a while to load its player and its composition.
test.setTimeout(150_000);

const openStrip = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Intro" })).toBeVisible();
  await expect(readout(page)).toContainText("0:04.00", { timeout: 40_000 });
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

test("pressing and dragging on the ruler scrubs the motion, and the release commits the time and leaves it paused", async ({ page, agent }) => {
  await openStrip(page, agent);
  const box = await boxOf(ruler(page));

  // Press at half the ruler (two seconds of four), then drag to three quarters (three seconds).
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 8 });
  await expect.poll(() => secondsOf(page)).toBeCloseTo(3, 0);
  await page.mouse.up();

  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  await expect.poll(() => compositionTime(page), { timeout: 10_000 }).toBeGreaterThan(2.9);
  expect(await compositionTime(page)).toBeLessThan(3.1);
  const paused = await readout(page).textContent();
  await page.waitForTimeout(300);
  expect(await readout(page).textContent()).toBe(paused);

  // A click on the readout does nothing.
  await readout(page).click();
  expect(await readout(page).textContent()).toBe(paused);
});

test("the zoom buttons halve and double the scale between 10 % of fit and 1,440 px a second, and Fit to length goes back", async ({ page, agent }) => {
  await openStrip(page, agent);
  const fit = await zoomOf(page);
  // Fit is the strip's width over the four seconds: the strip opens fitted.
  expect(fit).toBeGreaterThan(50);
  expect(fit).toBeLessThan(400);

  await timeline(page).getByRole("button", { name: "Zoom in" }).click();
  expect(await zoomOf(page)).toBeCloseTo(fit * 2, 3);
  // Six more doublings reach the top: 1,440 px a second.
  for (let step = 0; step < 6; step++) await timeline(page).getByRole("button", { name: "Zoom in" }).click();
  expect(await zoomOf(page)).toBe(1440);
  // The ruler's labels follow the scale: at 1,440 px a second a 0.1 s step keeps its labels 144 px apart.
  await expect(timeline(page).locator('[data-testid="timeline-tick"][data-time="0.1"]')).toHaveCount(1);

  // Out to the bottom: a tenth of fit.
  for (let step = 0; step < 14; step++) await timeline(page).getByRole("button", { name: "Zoom out" }).click();
  expect(await zoomOf(page)).toBeCloseTo(fit * 0.1, 3);
  await expect(timeline(page).getByTestId("timeline-past-end")).toHaveCount(1);

  await timeline(page).getByRole("button", { name: "Fit to length" }).click();
  expect(await zoomOf(page)).toBeCloseTo(fit, 3);
  await expect(timeline(page).getByTestId("timeline-past-end")).toHaveCount(0);
  // At fit a second is 98 px, so the step is a second (a half second is under the 64 px a label needs), and the end marker reads the length.
  await expect(timeline(page).locator('[data-testid="timeline-tick"][data-time="1"]')).toHaveCount(1);
  await expect(timeline(page).getByTestId("timeline-end")).toHaveText("4 s");
});

test("Ctrl+wheel zooms around the cursor, so the time under the cursor stays under it", async ({ page, agent }) => {
  await openStrip(page, agent);
  // Zoom in once so the strip scrolls, then point at its middle.
  await timeline(page).getByRole("button", { name: "Zoom in" }).click();
  const scroll = timeline(page).getByTestId("timeline-scroll");
  const area = await boxOf(scroll);
  const cursor = { x: area.x + area.width * 0.4, y: area.y + area.height / 2 };

  // The time starts after the 160 px label column, at the track's left edge.
  const timeUnder = async () => {
    const box = await boxOf(track(page));
    return (cursor.x - box.x - 160) / (await zoomOf(page));
  };
  const before = await timeUnder();
  const zoomBefore = await zoomOf(page);

  await page.keyboard.down("Control");
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");

  await expect.poll(() => zoomOf(page)).toBeGreaterThan(zoomBefore);
  expect(await timeUnder()).toBeCloseTo(before, 1);
});

test("the loop range's In and Out handles drag along the ruler, and an In dragged past the Out is refused", async ({ page, agent }) => {
  await openStrip(page, agent);
  // The focus is on the strip's time area, where I and O act: In at one second, Out at three.
  await timeline(page).getByTestId("timeline-rows").click();
  for (let step = 0; step < 3; step++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("i");
  for (let step = 0; step < 6; step++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  await expect(range(page)).toHaveAttribute("data-out", /^3/);

  const px = await zoomOf(page);
  // The ruler is measured again for each drag, since the strip may have scrolled since the last one.
  const at = async (seconds: number) => (await boxOf(ruler(page))).x + seconds * px;
  const centreOf = async (locator: Locator) => {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // Dragging In from one second to two moves the range's start there, and the handle goes with it.
  const inHandle = await centreOf(timeline(page).getByTestId("timeline-loop-in"));
  await page.mouse.move(inHandle.x, inHandle.y);
  await page.mouse.down();
  await page.mouse.move(await at(2), inHandle.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await range(page).getAttribute("data-in"))).toBeCloseTo(2, 1);

  // Dragging Out from three seconds to two and a half.
  const outHandle = await centreOf(timeline(page).getByTestId("timeline-loop-out"));
  await page.mouse.move(outHandle.x, outHandle.y);
  await page.mouse.down();
  await page.mouse.move(await at(2.5), outHandle.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await range(page).getAttribute("data-out"))).toBeCloseTo(2.5, 1);

  // An In dragged past the Out is refused: the In follows the pointer up to the Out and no further.
  const inAgain = await centreOf(timeline(page).getByTestId("timeline-loop-in"));
  await page.mouse.move(inAgain.x, inAgain.y);
  await page.mouse.down();
  await page.mouse.move(await at(3.5), inAgain.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const reached = Number(await range(page).getAttribute("data-in"));
  expect(reached).toBeGreaterThan(2);
  expect(reached).toBeLessThan(2.5);
});
