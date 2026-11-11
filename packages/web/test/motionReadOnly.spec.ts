import type { Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { engineChats, expect, promptBox, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";
import { editSummaries } from "./motionHelpers.ts";
import { editor } from "./editorHarness.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const READONLY = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}.dot{position:absolute;top:120px;width:60px;height:60px;background:#f00}#dot{left:20px}#box{left:300px;top:40px}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="8" data-width="640" data-height="360">
<div class="dot clip" id="dot" data-uf-name="Dot" data-start="0" data-duration="8"></div><div class="dot clip" id="box" data-uf-name="Box" data-start="0" data-duration="8"></div>
</div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
window.__timelines = { main: tl };
tl.fromTo("#dot", { x: 0 }, { x: 120, duration: 1 }, 0);
for (let i = 0; i < 2; i++) { tl.to("#dot", { y: 10 * i, duration: 0.5 }, 2 + i); }
function nudge(target, at) { tl.to(target, { opacity: 0.5, duration: 0.5 }, at); }
nudge("#box", 4);
tl.to("#dot", { rotation: 90, duration: 0.5 }, Math.min(5, 6));
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page, tween: number) => timeline(page).locator(`[data-testid="timeline-bar"][data-tween="${tween}"]`).first();
const panel = (page: Page) => page.getByRole("region", { name: /^Values for/ });
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const rail = (page: Page) => editor(page).locator('[data-editor-column="rail"]');

test.setTimeout(180_000);

const openMotion = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: READONLY });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page, 3)).toBeAttached({ timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
  await timeline(page).getByRole("button", { name: "Zoom in" }).click();
  await timeline(page).getByRole("button", { name: "Zoom in" }).click();
};

const fileOf = async (engine: TestEngine) => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props;

const dragBar = async (page: Page, tween: number) => {
  const box = await bar(page, tween).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 6 });
  await page.mouse.up();
};

test("a loop's tween shows that the agent's code sets it, with the reason, and a drag never starts", async ({ page, agent }) => {
  await openMotion(page, agent);
  const before = (await fileOf(agent))?.file;
  await dragBar(page, 1);
  await bar(page, 1).dblclick();

  await expect(panel(page).getByText("Set by the agent's code.").first()).toBeVisible();
  await expect(panel(page).getByText("It runs in a loop.")).toBeVisible();
  await page.waitForTimeout(2500);
  expect((await fileOf(agent))?.file).toBe(before);
  expect(await editSummaries(agent)).toEqual([]);
});

test("a tween a helper builds shows its reason, and the ask action puts the element's chip and the instruction into the composer", async ({ page, agent }) => {
  await openMotion(page, agent);
  await bar(page, 2).dblclick();

  await expect(panel(page).getByText("It is built by a helper.")).toBeVisible();
  await panel(page).getByRole("button", { name: "Ask the agent to make this editable", exact: true }).click();

  await expect(rail(page).getByText("div · Box", { exact: true })).toBeVisible();
  await expect(promptBox(rail(page))).toContainText("The animation of this element is set by the agent's code");
  await expect.poll(async () => (await engineChats(agent)).length).toBe(0);
});

test("a start the agent's code computes never moves, and the bar says why", async ({ page, agent }) => {
  await openMotion(page, agent);
  const before = (await fileOf(agent))?.file;
  await dragBar(page, 3);
  await bar(page, 3).dblclick();

  await expect(panel(page).getByText("Set by the agent's code.").first()).toBeVisible();
  await page.waitForTimeout(2500);
  expect((await fileOf(agent))?.file).toBe(before);
  expect(await editSummaries(agent)).toEqual([]);
});
