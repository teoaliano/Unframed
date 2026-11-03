import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, say, test } from "./agent.ts";
import { filledArtifact, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A motion whose one dot moves for four seconds, so its bar on the strip is the whole length at the fitted zoom. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const WARNING = "The agent rewrote this. Your last change wasn't saved.";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const railOf = (page: Page): Locator => page.getByTestId("artifact-editor").getByRole("complementary", { name: "Agent" });
const modeGroup = (page: Page) => region(page).getByRole("group", { name: "Mode" });

test.setTimeout(150_000);

const openMover = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1, { timeout: 40_000 });
  await expect.poll(async () => Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"))).toBeGreaterThan(0);
};

/** The file the motion shape names in the room. The room lags the editor by a sync round, so reads poll. */
const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "motion")).find((record) => record.id === SHAPE)?.props?.file;

/** How many committed edit sidecars the project holds. */
const editCount = async (engine: TestEngine): Promise<number> => {
  const names = (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".json"));
  let count = 0;
  for (const name of names) {
    const sidecar = JSON.parse(await readFile(projectPath(engine, name), "utf8")) as { source?: string };
    if (sidecar.source === "edit") count += 1;
  }
  return count;
};

/** How many HTML files the project folder holds: a version is on disk at once. */
const htmlCount = async (engine: TestEngine): Promise<number> => (await readdir(join(engine.dataDir, "output", "default"))).filter((name) => name.endsWith(".html")).length;

/** Drags the dot's bar a half second to the right, and leaves the pointer down: the burst is pending. */
const dragPending = async (page: Page) => {
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });
  await page.mouse.up();
};

test("a scripted agent write during a timeline burst drops the burst and shows the agent's version with the agent's warning", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = await fileOf(agent);
  const edits = await editCount(agent);
  const htmlBefore = await htmlCount(agent);

  // The burst is still waiting for its pause when the agent answers.
  await dragPending(page);
  await expect(bar(page)).toHaveAttribute("data-selected", "true");
  await say(railOf(page), "motion race now");

  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(htmlBefore + 1);
  await expect(page.getByText(WARNING, { exact: true }).first()).toBeVisible({ timeout: 2000 });
  // Past the burst's pause: the dropped burst writes no version of its own, and the agent's file is the shape's file.
  await page.waitForTimeout(2500);
  expect(await htmlCount(agent)).toBe(htmlBefore + 1);
  expect(await editCount(agent)).toBe(edits);
  expect(await fileOf(agent)).not.toBe(before);
  expect(await readFile(projectPath(agent, (await fileOf(agent))!), "utf8")).toMatch(/Agent motion/);
  // The strip reloads on the agent's version: its tween is the agent's two seconds, and the tween the person had selected is still selected.
  await expect(bar(page)).toHaveAttribute("data-duration", "2", { timeout: 15_000 });
  await expect(bar(page)).toHaveAttribute("data-selected", "true");
});

test("a commit that reaches the engine after the agent's version landed is stale: it writes nothing and shows the agent's warning", async ({ page, agent }) => {
  await openMover(page, agent);
  const edits = await editCount(agent);
  const htmlBefore = await htmlCount(agent);

  await dragPending(page);
  await say(railOf(page), "motion race now");
  await expect.poll(() => htmlCount(agent), { timeout: 8000 }).toBe(htmlBefore + 1);
  // Switching mode is a commit trigger: the burst that was left is already gone, so this commit writes nothing.
  await modeGroup(page).getByRole("button", { name: "Interact", exact: true }).click();
  await expect(modeGroup(page).getByRole("button", { name: "Interact", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(2000);
  expect(await htmlCount(agent)).toBe(htmlBefore + 1);
  expect(await editCount(agent)).toBe(edits);
  await expect(page.getByText(WARNING, { exact: true }).first()).toBeVisible();
});
