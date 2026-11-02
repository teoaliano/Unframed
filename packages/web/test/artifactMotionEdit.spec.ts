import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";

/** A motion whose dot moves across the composition, so an outline on it has to follow the timeline. */
const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const viewer = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");

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

// A motion takes a while to load its player and its composition: the pick waits for both.
test.setTimeout(150_000);

test("Edit mode on a motion: the player pauses on entering Edit, an element is picked through the viewer, and its outline follows it when the motion seeks", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:intro", kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: MOVER });
  await expect(shapeOnScreen(page, "shape:intro")).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:intro"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(region(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Edit", exact: true })).toHaveAttribute("aria-pressed", "true");

  const dot = insideComposition(viewer(page)).locator("#dot");
  await expect(async () => {
    await dot.click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 40_000 });
  await expect(editor(page).getByTestId("design-tab")).toContainText("dot");

  // Seeking the motion moves the element; the outline follows it.
  const before = (await outline(page, "selected").boundingBox())!;
  const frame = await compositionFrame(page);
  // seek returns the timeline itself, so the evaluate returns nothing: the timeline is not sent back.
  await frame.evaluate(() => {
    (window as unknown as { __timelines: { main: { seek(time: number): void } } }).__timelines.main.seek(3);
  });
  await expect.poll(async () => (await outline(page, "selected").boundingBox())!.x, { timeout: 5000 }).toBeGreaterThan(before.x + 60);
});
