import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { openCanvas, settledRecord, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { filledArtifact, frameOf, insideFrame } from "./artifacts.ts";

/** A page whose wide layout only applies from 1200 px of viewport width. */
const WIDE_BREAKPOINT = `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}#wide{display:none}@media (min-width:1200px){#wide{display:block}}</style></head><body><p id="wide">Wide layout</p></body></html>`;

/** A page 6000 px tall: its frame is that tall, so the page scrolls inside it. */
const LONG_PAGE = `<!doctype html><html><head><style>body{margin:0;font:14px sans-serif}#end{margin-top:5600px}</style></head><body><p>Top</p><p id="end">End of the long page</p></body></html>`;

/**
 * Drags a shape's bottom-right corner until the shape is `to` canvas pixels, at the zoom it
 * is shown at. Clicks the shape first so it is selected and its frame is live.
 */
const resizeTo = async (page: Page, engine: TestEngine, id: string, to: { w: number; h: number }) => {
  const card = shapeOnScreen(page, id);
  const before = (await settledRecord(engine, "default", id))!;
  const box = (await card.boundingBox())!;
  const zoom = box.width / before.props.w;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to.w * zoom, box.y + to.h * zoom, { steps: 10 });
  await page.mouse.up();
  // The drag lands on a zoomed pixel grid, so a size can be a fraction of a pixel off the target (5999.9997 for 6000).
  await expect
    .poll(async () => {
      const props = (await settledRecord(engine, "default", id))?.props;
      return props === undefined ? undefined : Math.abs(props.w - to.w) < 1 && Math.abs(props.h - to.h) < 1;
    })
    .toBe(true);
};

test("a page resized past 900 wide lays out at its frame's width, so a wide breakpoint applies", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:wide", kind: "page", ref: "160", at: { x: 440, y: 60 }, title: "Wide", html: WIDE_BREAKPOINT });
  await expect(shapeOnScreen(page, "shape:wide")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(400);

  await resizeTo(page, engine, "shape:wide", { w: 1400, h: 320 });
  await expect.poll(() => frameOf(page, "shape:wide").evaluate((frame: HTMLIFrameElement) => frame.offsetWidth)).toBe(1400);
  await expect(insideFrame(page, "shape:wide").locator("#wide")).toBeVisible({ timeout: 10_000 });
});

test("a page resized to 6000 tall gets a frame that tall, and its content reaches the bottom", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:long", kind: "page", ref: "161", at: { x: 440, y: 60 }, title: "Long", html: LONG_PAGE });
  await expect(shapeOnScreen(page, "shape:long")).toBeVisible();
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(300);
  await page.keyboard.press("-");
  await page.waitForTimeout(400);

  await resizeTo(page, engine, "shape:long", { w: 480, h: 6000 });
  await expect.poll(() => frameOf(page, "shape:long").evaluate((frame: HTMLIFrameElement) => frame.offsetHeight)).toBe(6000);
  await expect(insideFrame(page, "shape:long").getByText("End of the long page")).toBeAttached({ timeout: 10_000 });
});
