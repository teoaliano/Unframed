import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A four-second motion whose dot moves across the composition, so there is something to play. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

/** The same motion with a line of text the frame's own double-click can edit: the way a frame takes the keys (spec 18). */
const MOVER_WITH_TEXT = MOVER.replace('<div id="dot" class="clip"', '<p id="label" class="clip" data-start="0" data-duration="4" style="position:absolute;left:20px;top:20px;margin:0;color:#fff;font:16px sans-serif">Intro</p><div id="dot" class="clip"');

const SHAPE = "shape:intro";
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const readout = (page: Page) => timeline(page).getByTestId("timeline-readout");
const range = (page: Page) => timeline(page).getByTestId("timeline-range");
const player = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]").locator("hyperframes-player");
const mode = (page: Page, name: "Edit" | "Interact") => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });

/** The clock's seconds, read from the readout's `m:ss.cc`. */
const secondsOf = async (page: Page): Promise<number> => {
  const match = /^(\d+):(\d\d)\.(\d\d)/.exec((await readout(page).textContent()) ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 100 : Number.NaN;
};

// A motion takes a while to load its player and its composition.
test.setTimeout(150_000);

/** Opens the motion in the editor, in Edit mode, with the strip's time area focused: the keys act there. */
const openStrip = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(readout(page)).toContainText("0:04.00", { timeout: 40_000 });
  await timeline(page).getByTestId("timeline-rows").click();
};

test("J and L shuttle, the speed rises from 1x to 2x to 4x on each press, K stops, and Space plays again at the chosen speed", async ({ page, agent }) => {
  await openStrip(page, agent);
  await page.keyboard.press("l");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();
  await expect.poll(() => player(page).evaluate((element) => (element as unknown as { playbackRate: number }).playbackRate)).toBe(1);
  await page.keyboard.press("l");
  await expect.poll(() => player(page).evaluate((element) => (element as unknown as { playbackRate: number }).playbackRate)).toBe(2);
  await page.keyboard.press("l");
  await expect.poll(() => player(page).evaluate((element) => (element as unknown as { playbackRate: number }).playbackRate)).toBe(4);

  await page.keyboard.press("k");
  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  await expect.poll(() => player(page).evaluate((element) => (element as unknown as { playbackRate: number }).playbackRate)).toBe(1);
  const stopped = await readout(page).textContent();
  await page.waitForTimeout(300);
  expect(await readout(page).textContent()).toBe(stopped);

  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
});

test("J runs the clock backward from where it is, and K holds the time where it stopped", async ({ page, agent }) => {
  await openStrip(page, agent);
  await page.keyboard.press("l");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();
  await expect.poll(() => secondsOf(page), { timeout: 10_000 }).toBeGreaterThan(0.6);
  await page.keyboard.press("k");
  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  const forward = await secondsOf(page);

  await page.keyboard.press("j");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();
  await expect.poll(() => secondsOf(page), { timeout: 10_000 }).toBeLessThan(forward - 0.2);

  await page.keyboard.press("k");
  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  // The last report of the shuttle can land after the stop: the time settles first, then it holds.
  await page.waitForTimeout(500);
  const held = await readout(page).textContent();
  await page.waitForTimeout(400);
  expect(await readout(page).textContent()).toBe(held);
});

test("I and O set the loop range in the strip and Shift clears each side; elsewhere I is Interact and O does nothing", async ({ page, agent }) => {
  await openStrip(page, agent);
  // One second in: three Shift+Right steps of ten frames.
  for (let step = 0; step < 3; step++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("i");
  await expect(range(page)).toHaveAttribute("data-in", "1");
  await expect(range(page)).not.toHaveAttribute("data-out");

  // One third of a second on, the Out point.
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  await expect(range(page)).toHaveAttribute("data-out", /^1\.3/);

  await page.keyboard.press("Shift+I");
  await expect(range(page)).not.toHaveAttribute("data-in");
  await expect(range(page)).toHaveAttribute("data-out", /^1\.3/);
  await page.keyboard.press("Shift+O");
  await expect(range(page)).toHaveCount(0);

  // Outside the strip: the focus on the editor's title, not on the strip. I switches to Interact, and O does nothing.
  await region(page).getByTestId("artifact-editor-title").click();
  await page.keyboard.press("o");
  await expect(range(page)).toHaveCount(0);
  await expect(mode(page, "Edit")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("i");
  await expect(mode(page, "Interact")).toHaveAttribute("aria-pressed", "true");
});

test("Shift+L turns looping on and off, and looping plays the range from In to Out again", async ({ page, agent }) => {
  await openStrip(page, agent);
  const loop = timeline(page).getByRole("button", { name: "Loop (Shift+L)" });
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+L");
  await expect(loop).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+L");
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+L");
  await expect(loop).toHaveAttribute("aria-pressed", "true");

  // The range: In at one second, Out at one and a half, and the playhead just before the Out.
  for (let step = 0; step < 3; step++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("i");
  // Fifteen frames on is the Out at 1.5 s; nine frames back is 1.2 s.
  for (let step = 0; step < 15; step++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("o");
  for (let step = 0; step < 9; step++) await page.keyboard.press("ArrowLeft");
  await expect(range(page)).toHaveAttribute("data-out", /^1\.5/);

  await page.keyboard.press("Space");
  // Playing from 1.2 s, the playhead nears the Out (1.5 s), then comes back to the In (1 s): it is seen near the Out, then below 1.2 s.
  let nearOut = false;
  let wrapped = false;
  await expect(async () => {
    const at = await secondsOf(page);
    if (at > 1.4) nearOut = true;
    if (nearOut && at < 1.2) wrapped = true;
    expect(wrapped).toBe(true);
  }).toPass({ timeout: 15_000, intervals: [100] });
});

test("keys pressed in the frame in Edit mode reach the transport: Space plays, Shift+Right steps ten frames, and I is Interact", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER_WITH_TEXT });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(readout(page)).toContainText("0:04.00", { timeout: 40_000 });
  // A press does not move the keyboard focus into the frame (the bridge keeps it out), but a double-click on text does: the
  // frame then has the keys, and its bridge forwards them in Edit mode. The text edit it starts ends on Esc, which keeps the focus.
  // The keys typed while the editor answers the double-click are held and replayed into the text, so the keys wait for the edit to begin.
  const label = insideComposition(region(page).frameLocator("iframe[data-artifact-frame]")).locator("#label");
  await expect(async () => {
    await label.dblclick();
    await expect(label).toHaveAttribute("contenteditable", "plaintext-only", { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.locator("iframe[data-artifact-frame]")).toBeFocused({ timeout: 2000 });
  await page.keyboard.press("Escape");
  // The Esc ends the text edit and keeps the focus in the frame, so the next keys are the frame's.
  await expect(page.locator("iframe[data-artifact-frame]")).toBeFocused({ timeout: 2000 });

  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Pause (Space)", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
  // Paused where the Space left it: Shift+Right then steps ten frames from there.
  const framed = async () => Number(/(\d+)f$/.exec((await readout(page).textContent()) ?? "")?.[1]);
  // The last report of the playback can still move the frame by one after the pause: it settles before it is read.
  await page.waitForTimeout(400);
  const paused = await framed();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(framed).toBe(paused + 10);

  // I from the frame is Interact, as it is everywhere but the strip.
  await page.keyboard.press("i");
  await expect(mode(page, "Interact")).toHaveAttribute("aria-pressed", "true");
});
