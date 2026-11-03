import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries, tweenPlace } from "./motionHelpers.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** Dot's tween lasts as long as the parameter `speed` (2 s, between 0.5 and 4 s in steps of 0.1), and the agent's callback rebuilds it. */
const DIAL = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
window.__timelines = { main: tl };
unframed.dials("Timing", { speed: [2, 0.5, 4, 0.1] }, function (v) {
  tl.clear();
  tl.to("#dot", { x: 400, duration: v.speed }, 0);
});
</script></body></html>`;

/** The same, but the tween starts at 1 s (a literal) and only its duration is the parameter: a left-edge stretch moves both. */
const MIXED = DIAL.replace('tl.to("#dot", { x: 400, duration: v.speed }, 0);', 'tl.to("#dot", { x: 400, duration: v.speed }, 1);');

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const parameters = (page: Page) => page.getByTestId("artifact-editor").locator('[data-editor-column="parameters"]');

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1, { timeout: 40_000 });
  // One step out of the fitted zoom keeps a bar's right end clear of the scrollbar, and the zoom is set once the strip has measured itself.
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

/** The zoom, and the x of the ruler's time zero: the places a pointer goes to. */
const rulerOf = async (page: Page) => {
  const box = await timeline(page).getByTestId("timeline-ruler").boundingBox();
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  if (!box) throw new Error("no ruler");
  return { x: (seconds: number) => box.x + seconds * pxPerSecond, y: box.y + box.height + 20 };
};

const edgeOf = async (page: Page, side: "left" | "right") => {
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  return { x: side === "right" ? box.x + box.width - 2 : box.x + 1, y: box.y + box.height / 2 };
};

const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;

test("dragging a dial-owned bar's end moves the parameter at once, writes no version, and the commit saves the parameter alone", async ({ page, agent }) => {
  await openMotion(page, agent, DIAL);
  const before = (await fileOf(agent))?.file;
  const ruler = await rulerOf(page);
  const edge = await edgeOf(page, "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(3), edge.y, { steps: 8 });

  // The bar, the frame's tween and the parameter all say three seconds while the drag goes on.
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(3, 1);
  await expect.poll(async () => (await tweenPlace(page)).duration).toBeCloseTo(3, 1);
  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  await expect(parameters(page).getByRole("slider", { name: "Speed" })).toHaveAttribute("aria-valuenow", "3", { timeout: 5000 });
  await page.mouse.up();

  // No version: the file the shape names is the one it had, and no edit sidecar was written for the drag.
  await page.waitForTimeout(2500);
  expect((await fileOf(agent))?.file).toBe(before);
  expect((await editSummaries(agent)).length).toBe(0);
  // The parameter is saved once, with the burst's commit, and the shape keeps its file.
  await expect.poll(async () => (await fileOf(agent))?.dials?.speed, { timeout: 10_000 }).toBeCloseTo(3, 1);
  expect((await fileOf(agent))?.file).toBe(before);
});

test("a dial-owned end stops at the parameter's maximum", async ({ page, agent }) => {
  await openMotion(page, agent, DIAL);
  const ruler = await rulerOf(page);
  const edge = await edgeOf(page, "right");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(ruler.x(4.9), edge.y, { steps: 8 });
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(4, 1);
  await page.mouse.up();
  await expect.poll(async () => (await fileOf(agent))?.dials?.speed, { timeout: 10_000 }).toBeCloseTo(4, 3);
});

test("moving the parameter moves the bar, since the bar and the parameter are one value", async ({ page, agent }) => {
  await openMotion(page, agent, DIAL);
  await parameters(page).getByRole("tab", { name: "Parameters" }).click();
  const slider = parameters(page).getByRole("slider", { name: "Speed" });
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "4");
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration"))).toBeCloseTo(4, 1);
});

test("a left-edge stretch on a dial-owned timing moves the start and the parameter in one commit, and one undo takes both back", async ({ page, agent }) => {
  await openMotion(page, agent, MIXED);
  const before = (await fileOf(agent))?.file;
  const ruler = await rulerOf(page);
  const edge = await edgeOf(page, "left");
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  // From 1 s to 1.5 s: the start moves to 1.5 s and the end stays at 3 s, so the parameter becomes 1.5 s.
  await page.mouse.move(ruler.x(1.5), edge.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await fileOf(agent))?.dials?.speed, { timeout: 15_000 }).toBeCloseTo(1.5, 1);
  await expect.poll(async () => (await fileOf(agent))?.file, { timeout: 15_000 }).not.toBe(before);
  const moved = (await fileOf(agent))?.file;
  expect(await editSummaries(agent)).toHaveLength(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await fileOf(agent))?.file, { timeout: 15_000 }).toBe(before);
  await expect.poll(async () => (await fileOf(agent))?.dials?.speed, { timeout: 15_000 }).not.toBeCloseTo(1.5, 1);
  expect(moved).not.toBe(before);
});
