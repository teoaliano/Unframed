import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

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

test.setTimeout(150_000);

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

  await editor(page).getByRole("tab", { name: "Layers" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(editor(page).getByRole("tab", { name: "Parameters" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await idle();

  await region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Interact", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Interact", exact: true })).toHaveAttribute("aria-pressed", "true");
  await idle();
  await region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Edit", exact: true }).focus();
  await page.keyboard.press("Space");
  await idle();

  await timeline(page).getByRole("button", { name: "Playback speed" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("l");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu")).toBeVisible();
  await idle();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();

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
  const panel = page.getByRole("region", { name: /^Values for/ });
  const tweenSelected = () => timeline(page).locator('[data-testid="timeline-bar"][data-selected="true"]');

  await bar.dblclick();
  await expect(panel).toBeVisible();
  await expect.poll(() => tweenSelected().count()).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect.poll(() => tweenSelected().count()).toBeGreaterThan(0);
  await expect(region(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect.poll(() => tweenSelected().count()).toBe(0);
  await expect(region(page)).toBeVisible();

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

  const ruler = await timeline(page).getByTestId("timeline-ruler").boundingBox();
  if (!ruler) throw new Error("no ruler");
  await page.mouse.click(ruler.x + ruler.width * 0.5, ruler.y + ruler.height / 2);
  const scrubbed = await frameNumber();
  await page.keyboard.press("ArrowRight");
  await expect.poll(frameNumber).toBe(scrubbed + 1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(frameNumber).toBe(scrubbed + 11);

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
