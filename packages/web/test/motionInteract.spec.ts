import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition, projectPath } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A motion whose dot moves for four seconds, and whose dot counts its own clicks, so a click in the frame can be seen. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 400, duration: 4 }, 0);
window.__timelines = { main: tl };
window.clicks = 0;
document.getElementById("dot").addEventListener("click", () => { window.clicks += 1; });
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const bar = (page: Page) => timeline(page).locator('[data-testid="timeline-row"][data-row-kind="element"][data-row-name="Dot"] [data-testid="timeline-bar"]');
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const panel = (page: Page) => timeline(page).getByRole("region", { name: /^Values for/ });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const modeButton = (page: Page, name: "Edit" | "Interact") => region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name, exact: true });
const viewer = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");

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
  await modeButton(page, "Interact").click();
  await expect(modeButton(page, "Interact")).toHaveAttribute("aria-pressed", "true");
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

/** Drags the dot's bar a half second to the right and releases: a burst is pending. */
const dragBar = async (page: Page) => {
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no bar");
  const y = box.y + box.height / 2;
  const pxPerSecond = Number(await timeline(page).getByTestId("timeline-track").getAttribute("data-px-per-second"));
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25 + 0.5 * pxPerSecond, y, { steps: 8 });
  await page.mouse.up();
};

test("in Interact mode a dragged bar edits exactly as in Edit mode: one version after the pause, with its summary line", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = (await summaries(agent)).length;
  await dragBar(page);
  await expect.poll(async () => Number(await bar(page).getAttribute("data-start"))).toBeCloseTo(0.5, 1);
  await expect.poll(async () => (await summaries(agent)).length, { timeout: 15_000 }).toBe(before + 1);
  expect((await summaries(agent)).at(-1)).toEqual(["Moved Dot position to 0.5 s"]);
});

test("in Interact mode the values panel edits a tween's duration as it does in Edit mode", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = (await summaries(agent)).length;
  await bar(page).dblclick();
  await expect(panel(page)).toBeVisible();
  const duration = panel(page).getByRole("textbox", { name: "Duration", exact: true });
  await duration.fill("2");
  await duration.press("Enter");
  await expect.poll(async () => (await summaries(agent)).length, { timeout: 15_000 }).toBe(before + 1);
  expect((await summaries(agent)).at(-1)).toEqual(["Set Dot position to 2 s long"]);
});

test("in Interact mode a click in the frame reaches the motion and does not pick the element", async ({ page, agent }) => {
  await openMover(page, agent);
  await insideComposition(viewer(page)).locator("#dot").click();
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (!new URL(frame.url()).pathname.endsWith("-intro.html")) continue;
        const clicks = await frame.evaluate(() => (window as unknown as { clicks?: number }).clicks ?? 0).catch(() => 0);
        if (clicks > 0) return clicks;
      }
      return 0;
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect(outline(page, "selected")).toHaveCount(0);
});

test("switching mode commits an open burst at once, either way", async ({ page, agent }) => {
  await openMover(page, agent);
  const before = (await summaries(agent)).length;

  // Interact to Edit: a burst begun in Interact commits when the mode changes, well before its pause.
  await dragBar(page);
  await modeButton(page, "Edit").click();
  await expect.poll(async () => (await summaries(agent)).length, { timeout: 1000 }).toBe(before + 1);
  expect((await summaries(agent)).at(-1)).toEqual(["Moved Dot position to 0.5 s"]);

  // Edit to Interact: a burst begun in Edit commits the same way, and the second drag moves the bar on from 0.5 s.
  await dragBar(page);
  await modeButton(page, "Interact").click();
  await expect.poll(async () => (await summaries(agent)).length, { timeout: 1000 }).toBe(before + 2);
  expect((await summaries(agent)).at(-1)).toEqual(["Moved Dot position to 1 s"]);
});
