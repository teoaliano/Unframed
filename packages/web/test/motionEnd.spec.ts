import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries } from "./motionHelpers.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A four-second motion whose last clip, Dot, ends at 3 s, so a drag of the end marker can snap to it. */
const LENGTH = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="1" data-duration="2"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 1 }, 1);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const clipBar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="clip"][data-row-name="Dot"] [data-testid="timeline-clip-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: LENGTH });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(clipBar(page)).toHaveCount(1, { timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

/** The zoom in pixels a second, and the place of a time on the ruler, which starts at the time area's left edge. */
const rulerAt = async (page: Page, seconds: number) => {
  const ruler = await timeline(page).getByTestId("timeline-ruler").boundingBox();
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  if (!ruler) throw new Error("no ruler");
  return { x: ruler.x + seconds * pxPerSecond, y: ruler.y + ruler.height / 2, bottom: ruler.y + ruler.height + 20 };
};

/** The composition's own length, as the frame's root element holds it now. */
const rootDuration = async (page: Page): Promise<string | undefined> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    return frame.evaluate(() => document.getElementById("root")?.getAttribute("data-duration") ?? undefined);
  }
  return undefined;
};

const dragEndTo = async (page: Page, seconds: number, pixelsOff = 0) => {
  const handle = await timeline(page).getByTestId("timeline-end-handle").boundingBox();
  if (!handle) throw new Error("no end marker");
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const to = await rulerAt(page, seconds);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x + pixelsOff, from.y, { steps: 8 });
  return { to, from };
};

test("dragging the end marker near the last clip's end snaps the length to it, and the strip shows it while the drag goes on", async ({ page, agent }) => {
  await openMotion(page, agent);
  const versions = (await editSummaries(agent)).length;

  await dragEndTo(page, 3, 3);
  // While the drag goes on the marker and the readout show the new length: playback follows the drag.
  await expect.poll(() => timeline(page).getByTestId("timeline-end").textContent(), { timeout: 5_000 }).toBe("3 s");
  await page.mouse.up();

  await expect.poll(async () => (await editSummaries(agent)).length, { timeout: 15_000 }).toBe(versions + 1);
  expect((await editSummaries(agent)).at(-1)).toEqual(["Set the length to 3 s"]);
  await expect.poll(() => rootDuration(page), { timeout: 15_000 }).toBe("3");
  expect((await fileOf(agent))?.file).toBeTruthy();
});

test("dragging the end marker onto the playhead snaps the length to the playhead", async ({ page, agent }) => {
  await openMotion(page, agent);
  const versions = (await editSummaries(agent)).length;

  // A press on the ruler seeks paused to 2.5 s, which is where the playhead stays.
  const at = await rulerAt(page, 2.5);
  await page.mouse.click(at.x, at.y);
  await dragEndTo(page, 2.5, 2);
  await page.mouse.up();

  await expect.poll(async () => (await editSummaries(agent)).length, { timeout: 15_000 }).toBe(versions + 1);
  expect((await editSummaries(agent)).at(-1)).toEqual(["Set the length to 2.5 s"]);
  await expect.poll(() => rootDuration(page), { timeout: 15_000 }).toBe("2.5");
});
