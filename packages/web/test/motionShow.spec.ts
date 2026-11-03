import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact } from "./artifacts.ts";

/** Dot fades from its own opacity to 0.2 over 2 s from 1 s, so the Design tab's Opacity is animated by the agent's code. */
const FADE = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:60px;height:60px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" data-uf-name="Dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>
const tl = gsap.timeline({ paused: true });
tl.to("#dot", { x: 300, duration: 1 }, 0);
tl.to("#dot", { opacity: 0.2, duration: 2 }, 1);
window.__timelines = { main: tl };
</script></body></html>`;

const SHAPE = "shape:intro";
const timeline = (page: Page) => page.getByRole("region", { name: "Timeline for Intro" });
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });

test.setTimeout(150_000);

test("Show on timeline opens the strip, expands the element's row and selects the tween that animates the property", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: SHAPE, kind: "motion", ref: "150", at: { x: -520, y: -40 }, size: { w: 480, h: 270 }, title: "Intro", html: FADE });
  await expect(shapeOnScreen(page, SHAPE)).toBeVisible();
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, SHAPE));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
  await expect(timeline(page).getByTestId("timeline-row").first()).toBeVisible({ timeout: 40_000 });

  // Select Dot from its row, so the Design tab shows it, then hide the strip to see it open again.
  await timeline(page).getByRole("button", { name: "Select Dot" }).click();
  await timeline(page).getByRole("button", { name: "Hide timeline" }).click();
  await expect(timeline(page)).toHaveAttribute("data-open", "false");

  const link = page.getByRole("button", { name: "Show on timeline" }).first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();

  await expect(timeline(page)).toHaveAttribute("data-open", "true");
  // The row is expanded: its collapse control is there, and the lanes are drawn.
  await expect(timeline(page).getByRole("button", { name: "Collapse Dot" })).toBeVisible();
  // The opacity tween (the second one) is the selected bar.
  await expect(timeline(page).locator('[data-testid="timeline-bar"][data-selected="true"]')).toHaveCount(1);
  await expect(timeline(page).locator('[data-testid="timeline-bar"][data-selected="true"]')).toHaveAttribute("data-tween", "1");
});
