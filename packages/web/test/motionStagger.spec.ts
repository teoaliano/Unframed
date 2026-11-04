import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries, tweenPlace } from "./motionHelpers.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const STAGGER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}.dot{position:absolute;top:120px;width:40px;height:40px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360">
<div class="dot" id="d1" data-uf-name="Dot 1" style="left:20px"></div><div class="dot" id="d2" data-uf-name="Dot 2" style="left:80px"></div><div class="dot" id="d3" data-uf-name="Dot 3" style="left:140px"></div>
</div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to(".dot", { y: -40, duration: 1, stagger: 0.2 }, 1);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bars = (page: Page, name: string) => timeline(page).locator(`[data-testid="timeline-row"][data-row-kind="element"][data-row-name="${name}"] [data-testid="timeline-bar"]`);
const starts = async (page: Page) => [await bars(page, "Dot 1").getAttribute("data-start"), await bars(page, "Dot 2").getAttribute("data-start"), await bars(page, "Dot 3").getAttribute("data-start")].map(Number);
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });

test.setTimeout(150_000);

const openMotion = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: STAGGER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bars(page, "Dot 3")).toHaveCount(1, { timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file;

test("dragging any target's bar moves the whole stagger, and each target keeps its offset", async ({ page, agent }) => {
  await openMotion(page, agent);
  await expect.poll(() => starts(page)).toEqual([1, 1.2, 1.4]);
  const before = await fileOf(agent);
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));

  const box = await bars(page, "Dot 2").boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });
  await expect.poll(() => starts(page)).toEqual([expect.closeTo(1.5, 1), expect.closeTo(1.7, 1), expect.closeTo(1.9, 1)]);
  await expect.poll(async () => (await tweenPlace(page)).start).toBeCloseTo(1.5, 1);
  await page.mouse.up();

  await expect.poll(() => fileOf(agent), { timeout: 15_000 }).not.toBe(before);
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 10_000 }).toMatch(/^Moved Dot 1 position to 1\.5 s$/);
});

test("the stagger field respaces the bars, one number for the whole cascade", async ({ page, agent }) => {
  await openMotion(page, agent);
  await expect.poll(() => starts(page)).toEqual([1, 1.2, 1.4]);

  await bars(page, "Dot 1").dblclick();
  const stagger = page.getByRole("textbox", { name: "Stagger" });
  await expect(stagger).toHaveValue("0.2");
  await stagger.fill("0.4");
  await stagger.press("Enter");

  await expect.poll(() => starts(page)).toEqual([1, 1.4, 1.8]);
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)), { timeout: 15_000 }).toEqual(["Spaced the Dot 1 stagger 0.4 s apart"]);
});
