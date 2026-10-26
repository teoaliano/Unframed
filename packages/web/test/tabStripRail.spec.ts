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

test("the bar's fill and outline stay above the docked rail", async ({ page, agent }) => {
  await openCanvas(page, agent);
  const panel = await openRail(page);
  // The rail slides in; measure it once it has stopped at the left edge.
  await expect.poll(async () => (await panel.boundingBox())?.x).toBe(0);
  const box = (await panel.boundingBox())!;
  await panel.evaluate((element) => element.setAttribute("data-rail-under-test", ""));

  // The rail's right border and the bar's bottom border cross here; the bar's body must paint over the rail.
  const order = await page.evaluate(
    ({ x, y }) =>
      document.elementsFromPoint(x, y).map((element) => {
        if (element.matches("[data-slot='top-bar-body']")) return "bar";
        if (element.closest("[data-rail-under-test]")) return "rail";
        return "";
      }),
    { x: box.x + box.width - 1, y: 46 },
  );
  expect(order).toContain("bar");
  expect(order).toContain("rail");
  expect(order.indexOf("bar")).toBeLessThan(order.indexOf("rail"));
});
