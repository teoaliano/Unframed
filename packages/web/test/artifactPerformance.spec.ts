import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { frameStats, gestureCount, lastGesture } from "./board.ts";
import { centre, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape } from "./generation.ts";
import { putRecords } from "./media.ts";
import { artifactShape, writeProjectFile } from "./artifacts.ts";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const busyPage = fileURLToPath(new URL("../../../assets/perf/busy-page.html", import.meta.url));

const COMPOSITION = (index: number) =>
  `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;overflow:hidden;background:#123}.clip{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:700 48px sans-serif}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="t" class="clip" data-start="0" data-duration="4"><span id="w">Motion ${index}</span></div></div>
<script src="gsap.js"></script>
<script>window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true }); window.__timelines.main.fromTo("#w", { x: -200 }, { x: 200, duration: 4 }, 0);</script>
</body></html>`;

/** Ten pages whose file is the busy fixture and five motions, laid out in rows. */
const busyBoard = async (engine: TestEngine) => {
  const busy = await readFile(busyPage, "utf8");
  const rpc = await engine.rpc();
  await rpc.call("projects.create", { name: "default" }).catch(() => undefined);
  const records: unknown[] = [];
  for (let index = 0; index < 10; index++) {
    const file = `busy-${index}.html`;
    await writeProjectFile(engine, file, busy);
    records.push(artifactShape({ id: `shape:busy-${index}`, kind: "page", ref: String(200 + index), at: { x: (index % 5) * 520, y: Math.floor(index / 5) * 360 }, size: { w: 480, h: 320 }, file, title: `Busy ${index}` }));
  }
  for (let index = 0; index < 5; index++) {
    const { file } = await rpc.call("motion.upload", { project: "default", fileName: `motion-${index}.html`, html: COMPOSITION(index) });
    records.push(artifactShape({ id: `shape:motion-${index}`, kind: "motion", ref: String(300 + index), at: { x: index * 520, y: 760 }, size: { w: 480, h: 300 }, file, title: `Motion ${index}` }));
  }
  await putRecords(engine, records);
};

/**
 * Opens the board in the hosted shape (the production web served by the engine, on
 * 127.0.0.1, as the desktop shell opens it), runs `pinned` busy pages with Keep playing and
 * `selected` more by selecting them, then pans for 4 s over a still.
 */
const panBusyBoard = async (page: Page, engine: TestEngine, running: { pinned: number; selected: number }) => {
  await busyBoard(engine);
  await page.addInitScript(() => {
    (window as any).__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) (window as any).__longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`http://127.0.0.1:${engine.port}/?fps=1`);
  await expect(page.locator("[data-canvas-project] .tl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(".tl-shape[data-shape-type='page'], .tl-shape[data-shape-type='motion']").count(), { timeout: 20_000 }).toBe(15);
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(500);

  for (const id of ["shape:busy-0", "shape:busy-1", "shape:busy-2"].slice(0, running.pinned)) {
    const at = await centre(shapeOnScreen(page, id));
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByRole("menuitemcheckbox", { name: "Keep playing" }).click();
    await page.keyboard.press("Escape");
    await page.mouse.click(4, 400);
  }
  const selected = ["shape:busy-5", "shape:busy-6", "shape:busy-7"].slice(0, running.selected);
  for (const [index, id] of selected.entries()) await clickShape(page, id, index === 0 ? undefined : ["Shift"]);
  const frames = page.locator(".tl-shape iframe[data-artifact-frame]");
  await expect(frames).toHaveCount(running.pinned + running.selected);
  for (const src of await frames.evaluateAll((items) => items.map((item) => (item as HTMLIFrameElement).src))) expect(new URL(src).hostname).toBe("localhost");
  // Let the frames load and start their loops, and the meter learn the display's frame time.
  await page.waitForTimeout(3000);
  await expect.poll(() => page.evaluate(() => (window as any).__fps?.frameTime() ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => ((window as any).__longTasks = []));

  const before = await gestureCount(page);
  // Over a still: a selected frame takes the wheel as its own.
  const over = await centre(shapeOnScreen(page, "shape:busy-9"));
  await page.mouse.move(over.x, over.y);
  const started = Date.now();
  for (let step = 0; Date.now() - started < 4000; step++) {
    const direction = Math.floor(step / 60) % 2 === 0 ? 1 : -1;
    await page.mouse.wheel(10 * direction, 6 * direction);
    await page.waitForTimeout(16);
  }
  const pan = await lastGesture(page, before, "wheel");
  const longTasks = (await page.evaluate(() => (window as any).__longTasks as number[])).filter((ms) => ms > 50);
  const stats = frameStats(pan);
  console.log(
    `artifact pan with ${running.pinned} pinned and ${running.selected} selected busy pages running: median ${stats.median.toFixed(2)} ms, over 33 ms ${(stats.over33 * 100).toFixed(2)} % of ${stats.frames} frames, long tasks over 50 ms ${longTasks.length}, display frame ${pan.frameTime.toFixed(2)} ms`,
  );
  expect(pan.kind).toBe("wheel");
  return { stats, longTasks };
};

test("ten busy pages and five motions pan for 4 s in the hosted shape within the frame budget, three busy pages running", async ({ page, engine }) => {
  const { stats, longTasks } = await panBusyBoard(page, engine, { pinned: 1, selected: 2 });
  expect(stats.median).toBeLessThanOrEqual(16.7);
  expect(stats.over33).toBeLessThanOrEqual(0.02);
  expect(longTasks).toEqual([]);
});

test("with the most that may run at once, three pinned and three selected, the canvas thread still has no long task", async ({ page, engine }) => {
  // Six busy loops each keep a core of the machine busy, so their share of late frames depends on
  // the hardware and its load: measured and reported, while the canvas thread itself stays clear.
  const { stats, longTasks } = await panBusyBoard(page, engine, { pinned: 3, selected: 3 });
  expect(stats.median).toBeLessThanOrEqual(16.7);
  expect(longTasks).toEqual([]);
});
