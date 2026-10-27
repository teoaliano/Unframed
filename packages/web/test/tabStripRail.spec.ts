import { openCanvas } from "./canvas.ts";
import { expect, openRail, test } from "./agent.ts";

test("the tab strip keeps its left edge with the rail open and closed, and stays above the docked rail", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const strip = page.getByTestId("tab-strip");
  const closed = (await strip.boundingBox())!;

  await openRail(page);
  const open = (await strip.boundingBox())!;
  expect(open.x).toBe(closed.x);
  expect(open.y).toBe(closed.y);

  // The rail is 380 px wide and runs from the top, so a point on the strip's first tab lies under the rail's top row.
  const point = { x: open.x + 40, y: open.y + open.height / 2 };
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid='tab-strip']") !== null,
    point,
  );
  expect(topmost).toBe(true);
});

test("the docked rail meets the bar's bottom border: no part of it shows in the bar, and the bar has no corner above it", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
  const box = (await panel.boundingBox())!;
  const body = (await page.locator("[data-slot='top-bar-body']").boundingBox())!;
  expect(box.y).toBe(body.y + body.height);
  expect(body.x).toBe(0);

  // The rail's right border and the bar's left end, inside the bar: only the bar paints there.
  for (const point of [{ x: box.x + box.width - 1, y: 24 }, { x: 4, y: 46 }]) {
    const inRail = await panel.evaluate((rail, { x, y }) => document.elementsFromPoint(x, y).some((element) => rail.contains(element)), point);
    expect(inRail).toBe(false);
  }
});
