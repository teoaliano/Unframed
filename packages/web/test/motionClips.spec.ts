import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries, tweenPlace } from "./motionHelpers.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A clip, Dot, at 1 s for 2 s, and its one tween (a literal start and duration) at the clip's start. */
const CLIP = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="1" data-duration="2"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 1 }, 1);
window.__timelines = { main: tl };
</script></body></html>`;

/** Dot's tween is as long as the parameter `speed` (2 s), so a carried stretch scales the parameter. */
const DIAL = CLIP.replace('tl.to("#dot", { x: 400, duration: 1 }, 1);', 'unframed.dials("Timing", { speed: [2, 0.5, 4, 0.1] }, function (v) {\n  tl.clear();\n  tl.to("#dot", { x: 400, duration: v.speed }, 1);\n});');

/** Dot's tween starts with the agent's `<` position, so the clip cannot move: its carry is refused. */
const REFUSED = CLIP.replace('tl.to("#dot", { x: 400, duration: 1 }, 1);', 'tl.to("#dot", { x: 400, duration: 1 }, "<");');

/** Another clip starts relative to Dot's id, so Dot cannot move. */
const RELATIVE = CLIP.replace('<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">', '<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="other" data-uf-name="Other" class="clip" data-start="dot" data-duration="1"></div>');

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const clipBar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="clip"][data-row-name="Dot"] [data-testid="timeline-clip-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(clipBar(page)).toHaveCount(1, { timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

/** The zoom in pixels a second, which the drags below are measured in. */
const zoomOf = async (page: Page): Promise<number> => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));

/** A value on the composition's own `#dot` element in the frame, as the saved file put it. */
const dotAttribute = async (page: Page, name: string): Promise<string | null | undefined> => {
  for (const frame of page.frames()) {
    if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
    return frame.evaluate((attribute) => document.getElementById("dot")?.getAttribute(attribute) ?? null, name);
  }
  return undefined;
};

/** Drags the clip's bar by `seconds`, from a point at `fraction` of its width (0 or 1 presses the edge). */
const dragClip = async (page: Page, fraction: number, seconds: number) => {
  const box = await clipBar(page).boundingBox();
  if (!box) throw new Error("no clip bar");
  const y = box.y + box.height / 2;
  const x = box.x + box.width * fraction;
  const pxPerSecond = await zoomOf(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + seconds * pxPerSecond, y, { steps: 8 });
  await page.mouse.up();
};

const awaitVersion = async (engine: TestEngine, before: number) => {
  await expect.poll(async () => (await editSummaries(engine)).length, { timeout: 15_000 }).toBe(before + 1);
};

test("moving a clip moves its tweens: the clip and its tween land 0.5 s later in one version", async ({ page, agent }) => {
  await openMotion(page, agent, CLIP);
  const versions = (await editSummaries(agent)).length;

  await dragClip(page, 0.5, 0.5);
  await expect.poll(async () => Number(await clipBar(page).getAttribute("data-start")), { timeout: 5_000 }).toBeCloseTo(1.5, 1);

  await awaitVersion(agent, versions);
  expect((await editSummaries(agent)).at(-1)).toEqual(["Moved clip Dot to 1.5 s"]);
  await expect.poll(() => dotAttribute(page, "data-start"), { timeout: 15_000 }).toBe("1.5");
  await expect.poll(() => tweenPlace(page).then((place) => place.start), { timeout: 15_000 }).toBeCloseTo(1.5, 2);
  expect((await tweenPlace(page)).duration).toBeCloseTo(1, 2);
});

test("stretching a clip's right edge scales its tween, and the version names the new length", async ({ page, agent }) => {
  await openMotion(page, agent, CLIP);
  const versions = (await editSummaries(agent)).length;

  await dragClip(page, 0.999, 0.5);
  await awaitVersion(agent, versions);
  expect((await editSummaries(agent)).at(-1)).toEqual(["Set clip Dot to 2.5 s long"]);
  await expect.poll(() => dotAttribute(page, "data-duration"), { timeout: 15_000 }).toBe("2.5");
  // The tween keeps its start and takes the clip's new span: 1 s becomes 1.25 s.
  const place = await tweenPlace(page);
  expect(place.start).toBeCloseTo(1, 2);
  expect(place.duration).toBeCloseTo(1.25, 2);
});

test("a carried dial moves in the same step as the clip, and one undo takes both back", async ({ page, agent }) => {
  await openMotion(page, agent, DIAL);
  const before = (await fileOf(agent))?.file;
  const versions = (await editSummaries(agent)).length;

  await dragClip(page, 0.999, 0.5);
  await awaitVersion(agent, versions);
  expect((await editSummaries(agent)).at(-1)).toEqual(["Set clip Dot to 2.5 s long"]);
  // The parameter that times the tween is stretched with it: 2 s becomes 2.5 s.
  await expect.poll(async () => (await fileOf(agent))?.dials?.speed, { timeout: 15_000 }).toBeCloseTo(2.5, 1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await fileOf(agent))?.file, { timeout: 15_000 }).toBe(before);
  await expect.poll(async () => Number((await fileOf(agent))?.dials?.speed ?? 2), { timeout: 15_000 }).toBeCloseTo(2, 1);
});

test("a clip whose tween is timed by the agent's code cannot move: its bar says why and a drag writes nothing", async ({ page, agent }) => {
  await openMotion(page, agent, REFUSED);
  const before = (await fileOf(agent))?.file;
  const versions = (await editSummaries(agent)).length;
  await expect(clipBar(page)).toHaveAttribute("title", "This clip can't move: the position tween on Dot is timed by the agent's code.");

  await dragClip(page, 0.5, 0.5);
  await page.waitForTimeout(2_000);
  expect((await editSummaries(agent)).length).toBe(versions);
  expect((await fileOf(agent))?.file).toBe(before);
  expect(Number(await clipBar(page).getAttribute("data-start"))).toBeCloseTo(1, 2);
});

test("a clip another clip starts relative to cannot move, and its bar says so", async ({ page, agent }) => {
  await openMotion(page, agent, RELATIVE);
  await expect(clipBar(page)).toHaveAttribute("title", "This clip can't move: other starts relative to it.");
});
