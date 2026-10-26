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
