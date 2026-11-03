import type { Page } from "@playwright/test";
import { centre, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, insideComposition } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

const MOVER = `<!doctype html><html><head><style>#root{position:relative;width:640px;height:360px;background:#000;overflow:hidden}#dot{position:absolute;left:20px;top:120px;width:80px;height:80px;background:#f00}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360"><div id="dot" class="clip" data-start="0" data-duration="4"></div></div>
<script src="gsap.js"></script><script>window.__timelines = { main: gsap.timeline({ paused: true }).to("#dot", { x: 400, duration: 4 }, 0) };</script></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Intro" });
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const viewer = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");

const compositionFrame = async (page: Page) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const frame of page.frames()) {
      if (new URL(frame.url()).pathname.endsWith("-intro.html") && (await frame.evaluate(() => typeof (window as unknown as { __timelines?: unknown }).__timelines === "object").catch(() => false))) return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("no composition frame");
};

test.setTimeout(150_000);

const openMoverWithDotPicked = async (page: Page, agent: TestEngine) => {
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
};

test("Edit mode on a motion: the player pauses on entering Edit, an element is picked through the viewer, and its outline follows it when the motion seeks", async ({ page, agent }) => {
  await openMoverWithDotPicked(page, agent);

  const before = (await outline(page, "selected").boundingBox())!;
  const frame = await compositionFrame(page);
  await frame.evaluate(() => {
    (window as unknown as { __timelines: { main: { seek(time: number): void } } }).__timelines.main.seek(3);
  });
  await expect.poll(async () => (await outline(page, "selected").boundingBox())!.x, { timeout: 5000 }).toBeGreaterThan(before.x + 60);
});

test("an edit commit on a motion paused at 1.5 s shows the new version at 1.5 s", async ({ page, agent }) => {
  await openMoverWithDotPicked(page, agent);

  await region(page).locator("iframe[data-artifact-frame]").evaluate((frame: HTMLIFrameElement) => {
    frame.contentWindow?.postMessage({ type: "unframed:player:control", action: "seek", seconds: 1.5 }, "*");
  });
  const timeOf = async (page: Page) => {
    const frame = await compositionFrame(page);
    return frame.evaluate(() => (window as unknown as { __timelines: { main: { time(): number } } }).__timelines.main.time());
  };
  await expect.poll(() => timeOf(page), { timeout: 10_000 }).toBeCloseTo(1.5, 1);

  await editor(page).getByRole("spinbutton", { name: "Corner radius", exact: true }).fill("12");
  await editor(page).getByRole("spinbutton", { name: "Corner radius", exact: true }).press("Enter");
  await expect
    .poll(async () => {
      const frame = await compositionFrame(page);
      return frame.evaluate(() => ({ radius: getComputedStyle(document.getElementById("dot")!).borderRadius, time: (window as unknown as { __timelines: { main: { time(): number } } }).__timelines.main.time() }));
    }, { timeout: 15_000 })
    .toEqual({ radius: "12px", time: expect.closeTo(1.5, 1) });
});
