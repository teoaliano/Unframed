import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A four-second motion whose dot moves across the composition, so there is a selectable element and a clock. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };</script></body></html>`;

const SHAPE = "shape:intro";
const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const readout = (page: Page) => timeline(page).getByTestId("timeline-readout");
const composer = (page: Page) => editor(page).locator('[data-editor-column="rail"] [contenteditable="true"]').first();

// A motion takes a while to load its player and its composition.
test.setTimeout(150_000);

/** Opens the motion in the editor and waits for its player to report the timeline. */
const openMotion = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(readout(page)).toContainText("0:04.00", { timeout: 40_000 });
};

test("a focused tab, toggle, menu or composer keeps its own keys, and the transport does not act", async ({ page, agent }) => {
  await openMotion(page, agent);
  const idle = async () => {
    await expect(timeline(page).getByRole("button", { name: "Play (Space)", exact: true })).toBeVisible();
    await expect(readout(page)).toContainText(/0:00\.00 \/ 0:04\.00\s*0f/);
    await expect(timeline(page).getByRole("button", { name: "Unmute (M)", exact: true })).toBeVisible();
  };

  // A tab: the arrows move between the tabs, and the transport's Right step is not taken.
  await editor(page).getByRole("tab", { name: "Layers" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(editor(page).getByRole("tab", { name: "Parameters" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await idle();

  // A toggle group: its own Space switches the mode, and the transport still does not act.
  await region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Interact", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Interact", exact: true })).toHaveAttribute("aria-pressed", "true");
  await idle();
  await region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Edit", exact: true }).focus();
  await page.keyboard.press("Space");
  await idle();

  // A menu: open, its arrows and letters belong to it.
  await timeline(page).getByRole("button", { name: "Playback speed" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("l");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu")).toBeVisible();
  await idle();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();

  // The composer: typing a space, an L, a J, a K, an M and the arrows types them, and nothing plays.
  await composer(page).click();
  await page.keyboard.type(" ljkm");
  await expect(composer(page)).toContainText("ljkm");
  await idle();
});

test("Esc in the strip clears the element selection first, and a second Esc closes the editor", async ({ page, agent }) => {
  await openMotion(page, agent);
  await expect(async () => {
    await insideComposition(region(page).frameLocator("iframe[data-artifact-frame]")).locator("#dot").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 40_000 });

  // Focus the strip: Esc is the editor's, and the strip's transport does not take it.
  await timeline(page).getByTestId("timeline-rows").click();
  await page.keyboard.press("Escape");
  await expect(outline(page, "selected")).toHaveCount(0);
  await expect(region(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(region(page)).toHaveCount(0);
});

test("Esc closes the values panel first, then clears the tween selection, then the element selection, and a last Esc closes the editor", async ({ page, agent }) => {
  await openMotion(page, agent);
  await expect(timeline(page).getByTestId("timeline-row").first()).toBeVisible({ timeout: 40_000 });
  const bar = timeline(page).locator('[data-testid="timeline-bar"][data-tween="0"]').first();
  // The values panel is a popover, so it sits in the page, not in the strip.
  const panel = page.getByRole("region", { name: /^Values for/ });
  const tweenSelected = () => timeline(page).locator('[data-testid="timeline-bar"][data-selected="true"]');

  // A double-click on a bar selects its tween and opens the values panel.
  await bar.dblclick();
  await expect(panel).toBeVisible();
  await expect.poll(() => tweenSelected().count()).toBeGreaterThan(0);

  // Esc closes the panel and keeps the tween selected.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect.poll(() => tweenSelected().count()).toBeGreaterThan(0);
  await expect(region(page)).toBeVisible();

  // The next Esc clears the tween selection, and the element is not touched.
  await page.keyboard.press("Escape");
  await expect.poll(() => tweenSelected().count()).toBe(0);
  await expect(region(page)).toBeVisible();

  // With an element selected in the frame and no tween, Esc clears the element; a further Esc closes the editor.
  await expect(async () => {
    await insideComposition(region(page).frameLocator("iframe[data-artifact-frame]")).locator("#dot").click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await timeline(page).getByTestId("timeline-rows").click();
  await page.keyboard.press("Escape");
  await expect(outline(page, "selected")).toHaveCount(0);
  await expect(region(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(region(page)).toHaveCount(0);
});

test("the arrows, Shift+arrows and J, K and L act after a press on the ruler or with a transport button focused", async ({ page, agent }) => {
  await openMotion(page, agent);
  const frameNumber = async (): Promise<number> => Number(((await readout(page).textContent()) ?? "").match(/(\d+)f\s*$/)?.[1] ?? Number.NaN);

  // A click on the ruler scrubs, and the arrows then step from there.
  const ruler = await timeline(page).getByTestId("timeline-ruler").boundingBox();
  if (!ruler) throw new Error("no ruler");
  await page.mouse.click(ruler.x + ruler.width * 0.5, ruler.y + ruler.height / 2);
  const scrubbed = await frameNumber();
  await page.keyboard.press("ArrowRight");
  await expect.poll(frameNumber).toBe(scrubbed + 1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(frameNumber).toBe(scrubbed + 11);

  // A transport button has the focus: the arrows step, and L shuttles forward until K stops it.
  await timeline(page).getByRole("button", { name: "Next frame (→)" }).focus();
  const focused = await frameNumber();
  await page.keyboard.press("ArrowRight");
  await expect.poll(frameNumber).toBe(focused + 1);
  await page.keyboard.press("l");
  await expect.poll(frameNumber).toBeGreaterThan(focused + 1);
  await page.keyboard.press("k");
  const stopped = await frameNumber();
  await page.waitForTimeout(400);
  expect(await frameNumber()).toBe(stopped);
});
