import { emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { centreOf, groupShape, nodeCard, nodeShape, promptShape, seedBoard, selectNode, waitForNode, wireShape } from "./nodes.ts";

const run = async (page: Parameters<typeof selectNode>[0], id: string) => {
  await selectNode(page, id);
  await nodeCard(page, id).getByTestId("node-run").click();
};

test("versions: the newest is current, Use this version and Remove version, the file kept, and a drag out makes an ordinary result", async ({ page, generation }) => {
  const { engine } = generation;
  let seed = 0;
  generation.answer(() => ({ kind: "image", bytes: pngBytes(96, 64, ++seed), cost: 0.02 }));
  await openCanvas(page, engine);
  await seedBoard(engine, [nodeShape("n", "202", { medium: "image", instruction: "a fox" }, { x: 120, y: -60 })]);
  await run(page, "n");
  await waitForNode(engine, "n", (props) => props.versions.length === 1 && props.run === undefined);
  await nodeCard(page, "n").getByTestId("node-run").click();
  const two = await waitForNode(engine, "n", (props) => props.versions.length === 2 && props.run === undefined);
  const [newest, oldest] = two.props.versions;
  expect(two.props.currentVersionId).toBe(newest.id);
  await expect(nodeCard(page, "n").getByTestId("node-version")).toHaveCount(2);
  await expect(nodeCard(page, "n").locator(`[data-version-id="${newest.id}"]`)).toHaveAttribute("data-current", "true");

  await nodeCard(page, "n").locator(`[data-version-id="${oldest.id}"]`).getByTestId("node-version-menu").click();
  await page.getByRole("menuitem", { name: "Use this version" }).click();
  await waitForNode(engine, "n", (props) => props.currentVersionId === oldest.id);

  await nodeCard(page, "n").locator(`[data-version-id="${newest.id}"]`).getByTestId("node-version-menu").click();
  await page.getByRole("menuitem", { name: "Remove version" }).click();
  const after = await waitForNode(engine, "n", (props) => props.versions.length === 1);
  expect(after.props.currentVersionId).toBe(oldest.id);
  expect((await page.request.get(`${engine.origin}/api/file/default/${encodeURIComponent(newest.file)}`)).status()).toBe(200);

  const thumb = nodeCard(page, "n").locator(`[data-version-id="${oldest.id}"]`).getByRole("button").first();
  await thumb.scrollIntoViewIfNeeded();
  const from = await centreOf(thumb);
  const to = await emptyCanvasPoint(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const image = await waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === "image"));
  expect(image.meta.unframed.result).toMatchObject({ sidecar: oldest.file.replace(/\.png$/, ".json"), medium: "image", cost: 0.02 });
  const recipe = await (await engine.rpc()).call("recipe.read", { project: "default", shapeId: image.id });
  expect(recipe).toMatchObject({ medium: "image", node: { shapeId: "shape:n", versionId: oldest.id } });
  expect((await waitForNode(engine, "n", () => true)).props.versions).toHaveLength(1);
});

test("the toolbar: Run and Run downstream for one node, Run chain for several or a group, Generate kept beside it for a mixed selection", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    promptShape("p", "201", "a fox", { x: -440, y: 0 }),
    groupShape("g", "flow", { x: 120, y: -60 }, { w: 800, h: 420 }),
    nodeShape("a", "202", { medium: "text", instruction: "describe a fox" }, { x: 20, y: 40, parentId: "shape:g" }),
    nodeShape("b", "203", { medium: "image" }, { x: 420, y: 40, parentId: "shape:g" }),
    wireShape("ab", "a", "b", "prompt"),
  ]);
  await selectNode(page, "a");
  await expect(toolbar(page).getByTestId("toolbar-node-run")).toHaveText("Run");
  await expect(toolbar(page).getByRole("button", { name: "Generate" })).toHaveCount(0);
  await toolbar(page).getByTestId("toolbar-node-downstream").click();
  await expect(page.getByRole("menuitem")).toHaveText(["Run downstream: failed, waiting or never run (2)", "Run downstream: all (2)"]);
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");
  await shapeOnScreen(page, "shape:g").locator("[data-shape-label]").click();
  await expect(toolbar(page).getByTestId("toolbar-chain-run")).toHaveText(/^Run chain · 2 nodes/);
  await expect(toolbar(page).getByTestId("selection-hint")).toHaveText("2 nodes");

  await page.keyboard.press("ControlOrMeta+a");
  await expect(toolbar(page).getByRole("button", { name: "Generate" })).toBeVisible();
  await expect(toolbar(page).getByTestId("toolbar-chain-run")).toHaveText(/^Run chain · 2 nodes/);
});

test("a chain asks once for its paid steps, runs in order, and a failed step stops what follows, which waits and never runs", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    nodeShape("a", "201", { medium: "image", instruction: "a fox", params: { quality: "low", resolution: "1K" } }, { x: -440, y: -60 }),
    nodeShape("b", "202", { medium: "image", instruction: "at night", params: { quality: "low", resolution: "1K" } }, { x: 120, y: -60 }),
    wireShape("ab", "a", "b", "reference"),
  ]);
  await selectNode(page, "a");
  const other = (await nodeCard(page, "b").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x + other.width - 24, other.y + 14);
  await page.keyboard.up("Shift");
  await expect(toolbar(page).getByTestId("toolbar-chain-run")).toHaveText("Run chain · 2 nodes · ~$0.032");
  await toolbar(page).getByTestId("toolbar-chain-run").click();
  const dialog = page.getByTestId("chain-confirm");
  await expect(dialog.getByTestId("chain-step")).toHaveText([/1@201 · gpt-image-2est\. ~\$0\.011/, /2@202 · gpt-image-2est\. ~\$0\.021/]);
  await dialog.getByRole("button", { name: "Run" }).click();
  await waitForNode(engine, "b", (props) => props.currentVersionId !== null);
  expect(generation.requests.map((request) => request.body.prompt)).toEqual(["a fox", "at night"]);

  generation.answer(() => ({ kind: "status", status: 500, body: { error: { message: "upstream broke" } } }));
  await toolbar(page).getByTestId("toolbar-chain-run").click();
  await dialog.getByRole("button", { name: "Run" }).click();
  await expect(nodeCard(page, "a").getByTestId("node-status")).toHaveText(/^Failed: .*upstream broke/);
  await expect(nodeCard(page, "b").getByTestId("node-status")).toHaveText("Waiting for @201, which failed.");
  await expect(toast(page, /^Chain: 0 of 2 nodes ran\./)).toBeVisible();
  expect(generation.requests).toHaveLength(3);
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "node").every((record) => record.props.run === undefined)).toBe(true);
});
