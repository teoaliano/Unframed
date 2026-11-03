import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A four-second motion whose dot moves across the composition: the outline must follow it while the transport plays. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

const SHAPE = "shape:intro";
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const readout = (page: Page) => timeline(page).getByTestId("timeline-readout");
const playhead = (page: Page) => timeline(page).getByTestId("timeline-playhead");

/** The composition's own frame, the one that holds the timeline. */
const compositionFrame = async (page: Page) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const frame of page.frames()) {
      if (new URL(frame.url()).pathname.endsWith("-intro.html") && (await frame.evaluate(() => typeof (window as unknown as { __timelines?: unknown }).__timelines === "object").catch(() => false))) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("no composition frame");
};

const timeInComposition = async (page: Page): Promise<number> => {
  const frame = await compositionFrame(page);
  return frame.evaluate(() => (window as unknown as { __timelines: { main: { time(): number } } }).__timelines.main.time());
};

// A motion takes a while to load its player and its composition.
test.setTimeout(150_000);

/** Opens the motion in the editor, in Edit mode, with the strip's time area focused: keys act there. */
const openStrip = async (page: Page, engine: TestEngine, size = { w: 480, h: 270 }) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(timeline(page).getByRole("button", { name: "Play (Space)" })).toBeVisible();
  // The player is ready once it reports the timeline: the readout shows the length then.
  await expect(readout(page)).toContainText("0:04.00", { timeout: 40_000 });
  await timeline(page).getByTestId("timeline-rows").click();
};

test("Space plays and pauses, and the readout shows seconds and frames while it moves", async ({ page, agent }) => {
  await openStrip(page, agent);
  await expect(readout(page)).toHaveText(/0:00\.00 \/ 0:04\.00\s*0f/);

  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)" })).toBeVisible();
  // The clock has moved on from 0:00.00 (the length also reads 0:04.00, so the check is on the start).
  await expect.poll(async () => (await readout(page).textContent()) ?? "", { timeout: 10_000 }).not.toMatch(/^0:00\.00/);
  const moving = await playhead(page).evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(300);
  expect(await playhead(page).evaluate((element) => getComputedStyle(element).transform)).not.toBe(moving);
  expect(await readout(page).textContent()).toMatch(/\d+f$/);

  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Play (Space)" })).toBeVisible();
  const paused = await readout(page).textContent();
  await page.waitForTimeout(400);
  expect(await readout(page).textContent()).toBe(paused);
});

test("Left and Right step one frame, Shift with them ten, and the Previous and Next frame buttons step one", async ({ page, agent }) => {
  await openStrip(page, agent);
  await page.keyboard.press("ArrowRight");
  await expect(readout(page)).toContainText("1f");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(readout(page)).toContainText("11f");
  await page.keyboard.press("ArrowLeft");
  await expect(readout(page)).toContainText("10f");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(readout(page)).toContainText(/0:00\.00 \/ 0:04\.00\s*0f/);
  // Stepping at the start stays at the start.
  await page.keyboard.press("ArrowLeft");
  await expect(readout(page)).toContainText(/0:00\.00 \/ 0:04\.00\s*0f/);

  await timeline(page).getByRole("button", { name: "Next frame (→)" }).click();
  await expect(readout(page)).toContainText("1f");
  await timeline(page).getByRole("button", { name: "Previous frame (←)" }).click();
  await expect(readout(page)).toContainText(/0:00\.00 \/ 0:04\.00\s*0f/);
  // The composition lands on the frame too: the timeline's time is the readout's time. The buttons took the focus, so the keys need the strip again.
  await timeline(page).getByTestId("timeline-rows").click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => timeInComposition(page), { timeout: 10_000 }).toBeCloseTo(1 / 30, 2);
});

test("the speed menu sets 0.25x to 2x on the player, and mute follows M", async ({ page, agent }) => {
  await openStrip(page, agent);
  await timeline(page).getByRole("button", { name: "Playback speed" }).click();
  for (const label of ["0.25x", "0.5x", "1x", "1.5x", "2x"]) await expect(page.getByRole("menuitemradio", { name: label })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "0.5x" }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(timeline(page).getByRole("button", { name: "Playback speed" })).toHaveText("0.5x");
  const player = region(page).frameLocator("iframe[data-artifact-frame]").locator("hyperframes-player");
  await expect.poll(() => player.evaluate((element) => (element as unknown as { playbackRate: number }).playbackRate)).toBe(0.5);

  // The viewer starts muted, so the button offers to unmute.
  await expect(timeline(page).getByRole("button", { name: "Unmute (M)", exact: true })).toBeVisible();
  // The speed menu gave the focus to its button: the keys need the strip again.
  await timeline(page).getByTestId("timeline-rows").click();
  await page.keyboard.press("m");
  await expect(timeline(page).getByRole("button", { name: "Mute (M)", exact: true })).toBeVisible();
  await expect.poll(() => player.evaluate((element) => (element as unknown as { muted: boolean }).muted)).toBe(false);
  await timeline(page).getByRole("button", { name: "Mute (M)", exact: true }).click();
  await expect(timeline(page).getByRole("button", { name: "Unmute (M)", exact: true })).toBeVisible();
});

test("Loop is a toggle that shows whether looping is on", async ({ page, agent }) => {
  await openStrip(page, agent);
  const loop = timeline(page).getByRole("button", { name: "Loop (Shift+L)" });
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await loop.click();
  await expect(loop).toHaveAttribute("aria-pressed", "true");
  await loop.click();
  await expect(loop).toHaveAttribute("aria-pressed", "false");
});

test("playing from the transport in Edit mode moves the motion, and the outline follows the element", async ({ page, agent }) => {
  await openStrip(page, agent);
  // Select the dot through the viewer: its outline is what has to follow.
  await expect(async () => {
    await insideComposition(region(page).frameLocator("iframe[data-artifact-frame]")).locator("#dot").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await timeline(page).getByTestId("timeline-rows").click();
  const before = (await outline(page, "selected").boundingBox())!;

  await page.keyboard.press("Space");
  await expect.poll(() => timeInComposition(page), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await outline(page, "selected").boundingBox())!.x, { timeout: 5000 }).toBeGreaterThan(before.x + 30);
});

test("a click on the frame's margin in Edit mode does not start playback", async ({ page, agent }) => {
  // A 16:9 motion in a 3:2 frame leaves a band above and below the composition, which only the player takes the click on.
  await openStrip(page, agent, { w: 480, h: 320 });
  await region(page).frameLocator("iframe[data-artifact-frame]").locator("hyperframes-player").click({ position: { x: 100, y: 4 } });
  await page.waitForTimeout(1000);
  await expect(timeline(page).getByRole("button", { name: "Play (Space)" })).toBeVisible();
  expect(await timeInComposition(page)).toBe(0);
});
