import { emptyCanvasPoint, openCanvas, roomRecords, waitForRoom } from "./canvas.ts";
import { expect, test } from "./generation.ts";
import { nodeCard, nodeRecord, nodeShape, promptShape, seedBoard, selectNode, waitForNode, wireShape } from "./nodes.ts";

test("a node from the add menu shows its summary, and its composer only while it is selected", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, []);
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("menuitem", { name: "Node", exact: true }).click();
  const node = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "node"));
  const id = node.id.replace(/^shape:/, "");
  expect(node.props).toMatchObject({ w: 380, h: 360, medium: "image", versions: [], currentVersionId: null });
  const card = nodeCard(page, id);
  await expect(card).toHaveAttribute("data-node-live", "true");
  await expect(card.getByTestId("node-editor")).toBeVisible();
  await expect(card.getByRole("radiogroup", { name: "Node medium" }).getByRole("radio")).toHaveText(["image", "video", "text", "audio", "page"]);
  await expect(card.getByTestId("node-status")).toHaveText("Not run yet.");
  await expect(page.locator(`[data-shape-id="${node.id}"] [data-shape-label]`)).toHaveText(`@${node.meta.ref}`);

  await page.mouse.click(...Object.values(await emptyCanvasPoint(page)) as [number, number]);
  await expect(card).not.toHaveAttribute("data-node-live", "true");
  await expect(card.getByTestId("node-editor")).toHaveCount(0);
  await expect(card.getByTestId("node-result")).toHaveText("No result yet");
});

test("the instruction persists on the node, Cmd+Enter runs it, and the run lands as the current version", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [promptShape("fox", "201", "a lone red fox", { x: -400, y: 0 }), nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }), wireShape("w", "fox", "n", "prompt")]);
  await selectNode(page, "n");
  const box = nodeCard(page, "n").getByRole("textbox");
  await box.click();
  await page.keyboard.type("at golden hour");
  await waitForNode(engine, "n", (props) => props.instruction === "at golden hour");
  await page.keyboard.press("ControlOrMeta+Enter");
  const landed = await waitForNode(engine, "n", (props) => props.currentVersionId !== null);
  expect(landed.props.versions).toHaveLength(1);
  expect(generation.requests.at(-1)!.body.prompt).toBe("a lone red fox\n\nat golden hour");
  await expect(nodeCard(page, "n").getByTestId("node-version")).toHaveCount(1);
  await expect(nodeCard(page, "n").getByTestId("node-status")).toHaveCount(0);
});

test("Run is disabled and reads Running… while the node runs, and a failure stays on the node until it runs again", async ({ page, generation }) => {
  const { engine } = generation;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  generation.answer(async () => {
    await held;
    return { kind: "status", status: 400, body: { error: { message: "The model refused this prompt." } } };
  });
  await openCanvas(page, engine);
  await seedBoard(engine, [nodeShape("n", "202", { medium: "image", instruction: "a fox" }, { x: 120, y: -60 })]);
  await selectNode(page, "n");
  const run = nodeCard(page, "n").getByTestId("node-run");
  await run.click();
  await expect(run).toBeDisabled();
  await expect(run).toHaveText("Running…");
  await expect(nodeCard(page, "n").getByTestId("node-status")).toHaveText("Running…");
  release();
  await expect(nodeCard(page, "n").getByTestId("node-status")).toHaveText(/^Failed: .*The model refused this prompt\./);
  await page.reload();
  await openCanvas(page, engine);
  await expect(nodeCard(page, "n").getByTestId("node-status")).toHaveText(/^Failed: /);
  expect((await nodeRecord(engine, "n"))!.props.error).toContain("The model refused this prompt.");
});

test("a node waiting on an input says which, and an edited input marks it out of date", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    nodeShape("up", "201", { medium: "image", instruction: "a fox" }, { x: -440, y: -60 }),
    nodeShape("down", "202", { medium: "image", instruction: "at night" }, { x: 120, y: -60 }),
    wireShape("w", "up", "down", "reference"),
  ]);
  await expect(nodeCard(page, "down").getByTestId("node-status")).toHaveText("Waiting for @201, which has no result yet.");
  await selectNode(page, "up");
  await nodeCard(page, "up").getByTestId("node-run").click();
  await waitForNode(engine, "up", (props) => props.currentVersionId !== null);
  await expect(nodeCard(page, "down").getByTestId("node-status")).toHaveText("Not run yet.");
  await selectNode(page, "down");
  await nodeCard(page, "down").getByTestId("node-run").click();
  await waitForNode(engine, "down", (props) => props.currentVersionId !== null);
  await expect(nodeCard(page, "down").getByTestId("node-status")).toHaveCount(0);
  await selectNode(page, "up");
  await nodeCard(page, "up").getByTestId("node-run").click();
  await waitForNode(engine, "up", (props) => props.versions.length === 2 && props.run === undefined);
  await expect(nodeCard(page, "down").getByTestId("node-status")).toHaveText("Out of date. An input changed since this ran.");
  await expect(nodeCard(page, "down").getByTestId("node-status")).toHaveAttribute("data-state", "out_of_date");
});

test("Undo takes back an edit to a node but never a version that landed", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [nodeShape("n", "202", { medium: "image", instruction: "a fox" }, { x: 120, y: -60 })]);
  await selectNode(page, "n");
  await nodeCard(page, "n").getByRole("radio", { name: "video" }).click();
  await waitForNode(engine, "n", (props) => props.medium === "video");
  await nodeCard(page, "n").getByRole("radio", { name: "image" }).click();
  await waitForNode(engine, "n", (props) => props.medium === "image");
  await nodeCard(page, "n").getByTestId("node-run").click();
  await waitForNode(engine, "n", (props) => props.currentVersionId !== null && props.run === undefined);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  const undone = await waitForNode(engine, "n", (props) => props.medium === "video");
  expect(undone.props.versions).toHaveLength(1);
  expect(undone.props.currentVersionId).toBe(undone.props.versions[0].id);
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "node")).toHaveLength(1);
});
