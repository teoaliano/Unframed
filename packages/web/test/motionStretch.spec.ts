import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries, tweenPlace } from "./motionHelpers.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** Dot runs from 0 to 4 s; Other sits in 2 to 3 s, so its edges are snap targets for Dot's bar. */
const MOTION = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot,#other{position:absolute;width:60px;height:60px;background:#f00}#dot{left:20px;top:120px}#other{left:300px;top:20px;background:#0f0}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div><div id="other" data-uf-name="Other" class="clip" data-start="2" data-duration="1"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
tl.to("#other", { x: 50, duration: 1 }, 2);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const row = (page: Page, name: string) => timeline(page).locator(`[data-testid="timeline-row"][data-row-kind="element"][data-row-name="${name}"]`);
const bar = (page: Page) => row(page, "Dot").getByTestId("timeline-bar");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOTION });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1, { timeout: 40_000 });
  // The zoom is set once the strip has measured its width. One step out keeps a bar's right end clear of the scrollbar.
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  const fitted = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeCloseTo(fitted / 2, 3);
};

/** The strip's zoom and the x of the ruler's time zero, read at the moment the pointer needs them. */
const rulerOf = async (page: Page) => {
  const box = await timeline(page).getByTestId("timeline-ruler").boundingBox();
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  if (!box) throw new Error("no ruler");
  return { x: (seconds: number) => box.x + seconds * pxPerSecond, y: box.y + box.height + 20, pxPerSecond };
};

/** Where the bar's right or left edge is, two pixels inside it. */
const edgeOf = async (locator: Locator, side: "left" | "right") => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bar");
  // Half a pixel inside each edge: at this zoom a pixel is a fiftieth of a second.
  return { x: side === "right" ? box.x + box.width - 0.5 : box.x + 0.5, y: box.y + box.height / 2 };
};

test("dragging the right edge of a literal tween's bar stretches it with its start fixed, and the frame follows", async ({ page, agent }) => {
  await openMotion(page, agent);
  const before = (await roomShapes(agent, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file;
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(3), edge.y, { steps: 8 });
  // Three seconds: the bar ends at 3 s, and the composition's tween is three seconds long.
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3, 1);
  expect(Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(0, 3);
  await expect.poll(async () => (await tweenPlace(page).catch(() => ({ duration: Number.NaN }))).duration).toBeCloseTo(3, 1);
  await page.mouse.up();

  await expect.poll(async () => (await roomShapes(agent, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file, { timeout: 15_000 }).not.toBe(before);
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1))).toEqual(["Set Dot duration to 3 s"]);
});

test("dragging the left edge stretches from the start, so the end stays where it was and both values are written", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "left");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(1), edge.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(1, 1);
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3, 1);
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)), { timeout: 15_000 }).toEqual(["Moved Dot position to 1 s", "Set Dot duration to 3 s"]);
});

test("pressing a bar's end diamond with no movement opens the values panel and writes nothing", async ({ page, agent }) => {
  await openMotion(page, agent);
  const before = (await editSummaries(agent)).length;
  await row(page, "Dot").locator('[data-testid="timeline-diamond"][data-fraction="1"]').click();
  await expect(page.getByRole("region", { name: /^Values for Dot/ })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect((await editSummaries(agent)).length).toBe(before);
});

test("pressing a bar's end diamond and dragging it stretches the bar with its start fixed, and opens no panel", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const diamondAtEnd = row(page, "Dot").locator('[data-testid="timeline-diamond"][data-fraction="1"]');
  const box = await diamondAtEnd.boundingBox();
  if (!box) throw new Error("no diamond");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(3), y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3, 1);
  expect(Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(0, 3);
  await expect(page.getByRole("region", { name: /^Values for/ })).toHaveCount(0);
});

test("the snap guide is a dashed line two pixels wide, so it reads apart from the playhead's one-pixel line", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(3.02), edge.y, { steps: 8 });
  const guide = timeline(page).getByTestId("timeline-snap-guide");
  await expect(guide).toHaveCount(1);
  const drawn = (locator: typeof guide) => locator.evaluate((element) => ({ style: getComputedStyle(element).borderLeftStyle, width: element.getBoundingClientRect().width }));
  const line = await drawn(guide);
  const head = await drawn(timeline(page).getByTestId("timeline-playhead"));
  expect(line.style).toBe("dashed");
  expect(line.width).toBeGreaterThanOrEqual(2);
  expect(head.style).toBe("solid");
  expect(head.width).toBeLessThan(2);
  await page.mouse.up();
});

test("a stretched edge snaps to another bar's edge within 8 px, and a guide shows the snap", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  // 3.02 s is 0.02 s (under 5 px) from Other's end at 3 s: the edge snaps to 3 exactly, not to the frame at 3.033 s.
  await page.mouse.move(ruler.x(3.02), edge.y, { steps: 8 });
  await expect(timeline(page).getByTestId("timeline-snap-guide")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3, 4);
});

test("with no bar edge in reach, a stretched edge lands on a whole frame at 30 fps", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  // 2.75 s is a quarter second from Other's end, outside the 8 px reach at this zoom, so the edge lands on the frame at 83/30 s.
  await page.mouse.move(ruler.x(2.75), edge.y, { steps: 8 });
  await expect(timeline(page).getByTestId("timeline-snap-guide")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(83 / 30, 3);
});

test("holding Alt places the edge freely, to the millisecond, and the strip says so while the drag goes on", async ({ page, agent }) => {
  await openMotion(page, agent);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(bar(page), "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(ruler.x(3.02), edge.y, { steps: 8 });
  await expect(timeline(page).getByText(/Hold (Alt|Option) to place freely/)).toBeVisible();
  await expect(timeline(page).getByTestId("timeline-snap-guide")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  // The pointer's pixels set the place, so the edge is near 3.02 s but not on a frame (3.033 s) nor on a bar edge.
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3.02, 1);
  const placed = Number(await bar(page).getAttribute("data-duration"));
  expect(Math.abs(placed * 30 - Math.round(placed * 30))).toBeGreaterThan(0.05);
  await expect(timeline(page).getByText(/Hold (Alt|Option) to place freely/)).toHaveCount(0);
});
