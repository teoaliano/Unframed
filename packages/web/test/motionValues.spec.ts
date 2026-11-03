import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries } from "./motionHelpers.ts";
import { textOf } from "./editorHarness.ts";
import { putRecords } from "./media.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/**
 * One dot. Tween 0 moves it and animates its colour: a from-value at the start and a to-value at the end, the end's colour an
 * oklch(). Tween 1 sets a named colour at its end. Tween 2 repeats twice, back and forth. Tween 3 has a token duration.
 * Tween 4 is a `from`, whose end diamond has no values of its own.
 */
const VALUES = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="8"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
window.__timelines = { main: tl };
tl.fromTo("#dot", { x: 0, color: "#ffffff" }, { x: 120, color: "oklch(70% 0.2 150)", duration: 1 }, 0);
tl.to("#dot", { backgroundColor: "rebeccapurple", duration: 0.5 }, 2);
tl.to("#dot", { opacity: 0.5, duration: 0.5, repeat: 2, yoyo: true }, 3);
tl.to("#dot", { scale: 2, duration: unframed.token("duration/fast") }, 5);
tl.from("#dot", { opacity: 0.2, duration: 0.5 }, 6);
</script></body></html>`;

/** A colour token on the background, and a parameter that sets the dot's x at its end. */
const DIAL = VALUES.replace('tl.to("#dot", { backgroundColor: "rebeccapurple", duration: 0.5 }, 2);', 'unframed.dials("Move", { toX: [300, 0, 500] }, function (v) {\n  tl.to("#dot", { x: v.toX, duration: 0.5 }, 2);\n});');

const KIT = {
  format: 1,
  name: "Brand",
  modes: ["light", "dark"],
  tokens: [
    { path: "color/brand/accent", type: "color", value: "#e8711a" },
    { path: "color/brand/sky", type: "color", value: "#1a73e8" },
    { path: "duration/fast", type: "duration", value: "0.25s" },
  ],
};

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page, tween: number) => timeline(page).locator(`[data-testid="timeline-bar"][data-tween="${tween}"]`).first();
const diamond = (page: Page, tween: number, fraction: number) => timeline(page).locator(`[data-testid="timeline-diamond"][data-tween="${tween}"][data-fraction="${fraction}"]`).first();
/** Clicks a diamond at its outer tip, past the bar's end (or before its start), so the bar beneath does not take the click. */
const clickDiamond = async (page: Page, tween: number, fraction: number) => {
  await diamond(page, tween, fraction).click({ position: { x: fraction === 1 ? 8 : 2, y: 5 } });
};
const panel = (page: Page) => timeline(page).getByRole("region", { name: /^Values for/ });
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });

test.setTimeout(180_000);

const openMotion = async (page: Page, engine: TestEngine, html: string) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page, 0)).toBeAttached({ timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom out" }).click();
};

const zoomIn = async (page: Page, times: number) => {
  for (let i = 0; i < times; i++) await timeline(page).getByRole("button", { name: "Zoom in" }).click();
};

const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;
const fileText = async (engine: TestEngine) => textOf(engine, (await fileOf(engine))!.file);

test("a diamond opens the values panel with the numbers and colours at that keyframe, with units and an oklch and a named colour", async ({ page, agent }) => {
  await openMotion(page, agent, VALUES);
  await clickDiamond(page, 0, 1);

  await expect(panel(page)).toContainText("Dot");
  await expect(panel(page)).toContainText("Position");
  await expect(panel(page).getByRole("textbox", { name: "x" })).toHaveValue("120");
  await expect(panel(page).getByRole("textbox", { name: "color" })).toHaveValue("oklch(70% 0.2 150)");

  // A number takes its unit and a typed value writes the tween value at once, as one burst edit.
  await panel(page).getByRole("textbox", { name: "x" }).fill("150");
  await panel(page).getByRole("textbox", { name: "x" }).press("Enter");
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Set Dot x to 150");
});

test("a to tween's start diamond and a from tween's end diamond open the values panel with their sentences", async ({ page, agent }) => {
  await openMotion(page, agent, VALUES);
  await clickDiamond(page, 1, 0);
  await expect(panel(page).getByText("Starts from the element's current look.")).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "backgroundColor" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Close values" }).click();

  await clickDiamond(page, 4, 1);
  await expect(panel(page).getByText("Ends at the element's own style.")).toBeVisible();
  await expect(panel(page).getByText("Starts from the element's current look.")).toHaveCount(0);
});

test("a named colour at a diamond shows its name and takes a hex value", async ({ page, agent }) => {
  await openMotion(page, agent, VALUES);
  await clickDiamond(page, 1, 1);
  await expect(panel(page).getByRole("textbox", { name: "backgroundColor" })).toHaveValue("rebeccapurple");
  await panel(page).getByRole("textbox", { name: "backgroundColor" }).fill("#112233");
  await panel(page).getByRole("textbox", { name: "backgroundColor" }).press("Enter");
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Set Dot backgroundColor to #112233");
});

test("a colour token at a diamond shows a chip, another token replaces it, and Detach writes its value", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: KIT } } }]);
  const TOKENED = VALUES.replace('"rebeccapurple"', 'unframed.token("color/brand/sky")');
  await openMotion(page, agent, TOKENED);
  await clickDiamond(page, 1, 1);

  const chip = panel(page).getByRole("button", { name: /brand\/sky/ });
  await expect(chip).toContainText("#1a73e8");
  await chip.click();
  await page.getByRole("button", { name: /color\/brand\/accent/ }).click();
  await expect.poll(() => fileText(agent), { timeout: 15_000 }).toContain('unframed.token("color/brand/accent")');

  await panel(page).getByRole("button", { name: /brand\/accent/ }).click();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Set Dot backgroundColor to #e8711a");
});

test("a token-owned duration shows a token chip, and Detach writes it as a number", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await putRecords(agent, [{ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: { unframed: { kit: KIT } } }]);
  await openMotion(page, agent, VALUES);
  // A short bar's diamonds cover its middle at the fitted zoom, so the strip is zoomed in twice first.
  await zoomIn(page, 2);
  await bar(page, 3).dblclick();

  await expect(panel(page).getByRole("button", { name: /duration\/fast/ })).toContainText("0.25");
  await panel(page).getByRole("button", { name: /duration\/fast/ }).click();
  await page.getByRole("button", { name: "Detach", exact: true }).click();
  await expect.poll(() => editSummaries(agent).then((all) => all.at(-1)?.[0]), { timeout: 15_000 }).toBe("Set Dot scale to 0.25 s long");
});

test("a value a parameter sets shows its parameter, and typing in it moves the parameter", async ({ page, agent }) => {
  await openMotion(page, agent, DIAL);
  await clickDiamond(page, 1, 1);

  await expect(panel(page).getByRole("img", { name: "Parameter toX" })).toBeVisible();
  await panel(page).getByRole("textbox", { name: "x" }).fill("200");
  await panel(page).getByRole("textbox", { name: "x" }).press("Enter");
  await expect.poll(async () => (await fileOf(agent))?.dials?.toX, { timeout: 10_000 }).toBe(200);
});

test("a repeating tween's panel says how often it repeats and whether it goes back and forth", async ({ page, agent }) => {
  await openMotion(page, agent, VALUES);
  await zoomIn(page, 2);
  await bar(page, 2).dblclick();
  await expect(panel(page).getByText("Repeats 2 times, back and forth")).toBeVisible();
});

test("clearing the tween selection commits the open burst at once, as any change of the editor's selection does", async ({ page, agent }) => {
  await openMotion(page, agent, VALUES);
  const before = (await fileOf(agent))?.file;
  // Move the repeating tween's bar (literal timing) a little to the right, and let go.
  await zoomIn(page, 1);
  const box = await bar(page, 2).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, y, { steps: 4 });
  await page.mouse.up();

  // A click on empty track clears the tween selection. The burst commits then, well before its 1.5 s pause would.
  await timeline(page).getByTestId("timeline-rows").click({ position: { x: 4, y: 4 } });
  await expect.poll(async () => (await fileOf(agent))?.file, { timeout: 1000 }).not.toBe(before);
});
