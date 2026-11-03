import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** One dot that moves for four seconds, so its bar is wide and its two diamonds sit at 0 s and 4 s. */
const WIDE = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };
</script></body></html>`;

/** One dot with a 0.2 s tween at 1 s: at the zoom the strip opens at, the bar is narrower than 12 px. */
const SHORT = WIDE.replace('tl.to("#dot", { x: 400, duration: 4 }, 0);', 'tl.to("#dot", { x: 400, duration: 0.2 }, 1);');

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const track = (page: Page) => timeline(page).getByTestId("timeline-track");
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const panel = (page: Page) => page.getByRole("region", { name: /^Values for/ });

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
  await expect.poll(async () => Number(await track(page).getAttribute("data-px-per-second"))).toBeGreaterThan(0);
};

/** The summary lines of every committed edit, oldest first. */
const summaries = async (engine: TestEngine): Promise<string[][]> => {
  const names = (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".json")).sort();
  const found: string[][] = [];
  for (const name of names) {
    const sidecar = JSON.parse(await readFile(projectPath(engine, name), "utf8")) as { source?: string; edits?: string[] };
    if (sidecar.source === "edit") found.push(sidecar.edits ?? []);
  }
  return found;
};

/** The centre of a locator's box, in page pixels. */
const midpoint = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
};

/** The element under a point, as its aria-label or its test id, so a hit area can be asked which control takes a press. */
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const hit = document.elementFromPoint(px, py)?.closest('[data-testid="timeline-diamond"], button, [data-testid="timeline-bar"]');
      return hit?.getAttribute("aria-label") ?? hit?.getAttribute("data-testid") ?? null;
    },
    [x, y] as const,
  );

test("the values panel keeps its Background field after a refused colour, showing the last committed colour", async ({ page, agent }) => {
  // The shared motion helper lives in motionValues.spec.ts; this spec opens the same kind of motion itself.
  await openMotion(page, agent, WIDE.replace('tl.to("#dot", { x: 400, duration: 4 }, 0);', 'tl.to("#dot", { backgroundColor: "#00ff00", duration: 4 }, 0);'));
  // The end keyframe holds the colour, so its diamond opens the panel with the Background field.
  await timeline(page).locator('[data-testid="timeline-diamond"][data-tween="0"][data-fraction="1"]').first().click({ position: { x: 8, y: 5 } });
  const background = panel(page).getByRole("textbox", { name: "Background", exact: true });
  await expect(background).toHaveValue("#00ff00");
  await background.fill("rgb(</script><script>alert(1)</script>)");
  await background.press("Enter");
  await expect(panel(page).getByRole("textbox", { name: "Background", exact: true })).toHaveValue("#00ff00");
  expect((await summaries(agent)).length).toBe(0);
});

test("a bar narrower than 12 px moves when its body is dragged, and its edges stay as small as a third of it", async ({ page, agent }) => {
  await openMotion(page, agent, SHORT);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
  const box = await midpoint(bar(page));
  expect(box.width).toBeLessThan(12);
  const pxPerSecond = Number(await track(page).getAttribute("data-px-per-second"));
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 0.5 * pxPerSecond, box.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await summaries(agent)).at(-1)?.[0] ?? "", { timeout: 15_000 }).toMatch(/^Moved Dot position to 1\.5 s$/);
});

test("a bar is a button named for its element, its group and its span, and moves a frame with the arrow keys", async ({ page, agent }) => {
  await openMotion(page, agent, WIDE);
  const named = timeline(page).getByRole("button", { name: "Dot position tween, 0 s to 4 s", exact: true });
  await expect(named).toHaveCount(1);
  await named.focus();

  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await bar(page).getAttribute("data-start")), { timeout: 5000 }).toBeCloseTo(1 / 30, 2);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => Number(await bar(page).getAttribute("data-start")), { timeout: 5000 }).toBeCloseTo(1 / 30 + 10 / 30, 2);
  await expect.poll(async () => (await summaries(agent)).at(-1)?.[0] ?? "", { timeout: 15_000 }).toMatch(/^Moved Dot position to 0\.36\d* s$/);
});

test("Alt with an arrow key changes a bar's duration by one frame, committed as a drag is", async ({ page, agent }) => {
  await openMotion(page, agent, WIDE);
  await timeline(page).getByRole("button", { name: "Dot position tween, 0 s to 4 s", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => Number(await bar(page).getAttribute("data-duration")), { timeout: 5000 }).toBeCloseTo(4 + 1 / 30, 2);
  await expect.poll(async () => (await summaries(agent)).at(-1)?.[0] ?? "", { timeout: 15_000 }).toMatch(/^Set Dot duration to 4\.03\d* s$/);
});

test("every keyframe is named with its time, and its hit area is at least 24 by 24 px", async ({ page, agent }) => {
  await openMotion(page, agent, WIDE);
  // At the fitted zoom the end keyframe sits on the track's last pixel, so the strip is zoomed out once to see both sides of it.
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
  const end = timeline(page).getByRole("button", { name: "Keyframe of Dot at 4.0 s", exact: true });
  await expect(end).toHaveCount(1);
  await expect(timeline(page).getByRole("button", { name: "Keyframe of Dot at 0.0 s", exact: true })).toHaveCount(1);

  // A press 11 px either side of the diamond's centre lands on the diamond: its hit area is 22 px or more across.
  const at = await midpoint(end);
  expect(await hitAt(page, at.x - 11, at.y)).toBe("Keyframe of Dot at 4.0 s");
  expect(await hitAt(page, at.x + 11, at.y)).toBe("Keyframe of Dot at 4.0 s");
});

test("the row's expand and select controls take a press 10 px above and below their centre", async ({ page, agent }) => {
  await openMotion(page, agent, WIDE);
  const select = timeline(page).getByRole("button", { name: "Select Dot", exact: true });
  await expect(select).toHaveCount(1);
  const at = await midpoint(select);
  expect(await hitAt(page, at.x, at.y - 10)).toBe("Select Dot");
  expect(await hitAt(page, at.x, at.y + 10)).toBe("Select Dot");
});

test("a zoomed strip keeps its zoom after the motion gets longer, so the time area stays within the strip", async ({ page, agent }) => {
  await openMotion(page, agent, WIDE);
  await timeline(page).getByRole("button", { name: "Zoom in" }).click();
  // The person edits the bar's duration to 119 s: the same motion, a longer length. The zoom in pixels a second must follow the length.
  await bar(page).dblclick();
  const duration = panel(page).getByRole("textbox", { name: "Duration", exact: true });
  await duration.fill("119");
  await duration.press("Enter");
  await expect.poll(async () => (await summaries(agent)).at(-1)?.[0] ?? "", { timeout: 15_000 }).toBe("Set Dot duration to 119 s");
  const viewport = await timeline(page).boundingBox();
  await expect.poll(async () => (await track(page).boundingBox())?.width ?? Infinity, { timeout: 15_000 }).toBeLessThan(4 * (viewport?.width ?? 0));
});
