import { emptyCanvasPoint, openCanvas, waitForRoom } from "./canvas.ts";
import { chatCompletions } from "../../engine/test/textStub.ts";
import { expect, startGeneration } from "./generation.ts";
import { test as base } from "./fixtures.ts";
import { centreOf, nodeCard, nodeShape, seedBoard, selectNode, waitForNode } from "./nodes.ts";

const PAGE = "<!doctype html><html><head><title>Coffee site</title></head><body><h1>Beans</h1></body></html>";

const test = base.extend<{ pages: Awaited<ReturnType<typeof startGeneration>> }>({
  pages: async ({}, use) => {
    const chat = chatCompletions(() => ({ kind: "text", text: "```html\n" + PAGE + "\n```", cost: 0.004 }));
    const generation = await startGeneration({ extra: [chat.handler] });
    await use(generation);
    await generation.engine.dispose();
  },
});

test("a page node writes a page version that previews in the node and drags out as a page shape with its title", async ({ page, pages }) => {
  const { engine } = pages;
  await openCanvas(page, engine);
  await seedBoard(engine, [nodeShape("n", "202", { medium: "page", instruction: "a coffee site" }, { x: 120, y: -60 })]);
  await selectNode(page, "n");
  await nodeCard(page, "n").getByTestId("node-run").click();
  const done = await waitForNode(engine, "n", (props) => props.currentVersionId !== null && props.run === undefined);
  const version = done.props.versions[0];
  expect(version.file).toMatch(/-page-coffee-site\.html$/);
  await expect(nodeCard(page, "n").getByTestId("node-result").getByTestId("node-page")).toContainText("Coffee site");
  await expect(nodeCard(page, "n").getByTestId("node-medium")).toHaveText("Page");

  const thumb = nodeCard(page, "n").getByTestId("node-version").getByRole("button").first();
  await thumb.scrollIntoViewIfNeeded();
  const from = await centreOf(thumb);
  const to = await emptyCanvasPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const shape = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === "page"));
  expect(shape.props).toMatchObject({ file: version.file, title: "Coffee site", w: 480, h: 320 });
  expect(typeof shape.meta.ref).toBe("string");
});
