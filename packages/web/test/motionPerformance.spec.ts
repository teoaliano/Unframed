import type { Page } from "@playwright/test";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expectFrameBudget, expectNoLongTasks, frameStats, gestureCount, lastGesture } from "./board.ts";
import { expect, test } from "./fixtures.ts";
import { artifactShape } from "./artifacts.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";


const CLIPS = 6;
const TWEENS_PER_CLIP = 10;

const MANY = (() => {
  const elements = (clip: number) =>
    Array.from({ length: TWEENS_PER_CLIP }, (_, index) => `<div id="c${clip}-e${index}" class="dot" style="left:${(index % 5) * 120}px;top:${Math.floor(index / 5) * 150 + clip * 4}px"></div>`).join("");
  const clips = Array.from({ length: CLIPS }, (_, clip) => `<div id="c${clip}" class="clip" data-start="${clip * 0.5}" data-duration="4">${elements(clip)}</div>`).join("");
  const tweens = Array.from({ length: CLIPS }, (_, clip) =>
    Array.from({ length: TWEENS_PER_CLIP }, (_, index) => `tl.to("#c${clip}-e${index}", { x: ${80 + index * 10}, duration: 1.5, ease: "power2.out" }, ${(clip * 0.5 + index * 0.1).toFixed(2)});`).join("\n"),
  ).join("\n");
  return `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}.clip{position:absolute;inset:0}.dot{position:absolute;width:24px;height:24px;background:#f80;border-radius:50%}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360">${clips}</div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
${tweens}
window.__timelines = { main: tl };
</script></body></html>`;
})();

const SHAPE = "shape:many";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Many" });

test.setTimeout(240_000);

test("a motion with 60 tweens over 6 clips plays for 4 s and drags a bar for 2 s in the hosted shape within the frame budget", async ({ page, engine }) => {
  await writeMotion(engine);
  await page.addInitScript(() => {
    (window as any).__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as any).__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`http://127.0.0.1:${engine.port}/?fps=1`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(".tl-shape[data-shape-type='motion']").count(), { timeout: 20_000 }).toBe(1);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(500);

  await page.mouse.click(4, 400);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole("region", { name: "Editing Many" })).toBeVisible({ timeout: 20_000 });
  await expect(timeline(page).locator('[data-testid="timeline-row"]')).not.toHaveCount(0, { timeout: 40_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__fps?.frameTime() ?? 0)).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const mounted = await timeline(page).locator('[data-testid="timeline-row"]').count();
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(30);
  await page.evaluate(() => ((window as any).__longTasks = []));

  const playing = timeline(page).getByRole("button", { name: "Play (Space)", exact: true });
  await timeline(page).getByTestId("timeline-rows").click();
  const beforePlay = await gestureCount(page);
  await playing.click();
  const playStarted = Date.now();
  while (Date.now() - playStarted < 4000) {
    await page.keyboard.press("Shift");
    await page.waitForTimeout(16);
  }
  await timeline(page).getByRole("button", { name: "Pause (Space)", exact: true }).click();
  const play = await lastGesture(page, beforePlay, "keys");
  const playLongTasks = (await page.evaluate(() => (window as any).__longTasks as number[])).filter((ms) => ms > 50);
  const playStats = frameStats(play);
  console.log(`motion timeline play: median ${playStats.median.toFixed(2)} ms, over 33 ms ${(playStats.over33 * 100).toFixed(2)} % of ${playStats.frames} frames, long tasks over 50 ms ${playLongTasks.length}`);
  expectFrameBudget(playStats, "timeline play", { median: 16.7, over33: 0.02 });
  expectNoLongTasks(playLongTasks, "timeline play");

  await page.evaluate(() => ((window as any).__longTasks = []));
  const row = timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"]').first();
  const box = await row.locator('[data-testid="timeline-bar"]').first().boundingBox();
  if (!box) throw new Error("no bar on screen");
  const y = box.y + box.height / 2;
  const x = box.x + box.width * 0.5;
  const beforeDrag = await gestureCount(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const dragStarted = Date.now();
  for (let step = 0; Date.now() - dragStarted < 2000; step++) {
    const offset = Math.floor(step / 30) % 2 === 0 ? step % 30 : 30 - (step % 30);
    await page.mouse.move(x + offset * 2, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const drag = await lastGesture(page, beforeDrag, "drag");
  const dragLongTasks = (await page.evaluate(() => (window as any).__longTasks as number[])).filter((ms) => ms > 50);
  const dragStats = frameStats(drag);
  console.log(`motion timeline bar drag: median ${dragStats.median.toFixed(2)} ms, over 33 ms ${(dragStats.over33 * 100).toFixed(2)} % of ${dragStats.frames} frames, long tasks over 50 ms ${dragLongTasks.length}`);
  expect(drag.kind).toBe("drag");
  expectFrameBudget(dragStats, "timeline bar drag", { median: 16.7, over33: 0.02 });
  expectNoLongTasks(dragLongTasks, "timeline bar drag");
});

const writeMotion = async (engine: TestEngine) => {
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "default" }).catch(() => undefined);
  const { file } = await rpc.call("motion.upload", { project: "default", fileName: "many.html", html: MANY });
  await putRecords(engine, [artifactShape({ id: SHAPE, kind: "motion", ref: "400", at: { x: 0, y: 0 }, size: { w: 480, h: 270 }, file, title: "Many" })]);
};
