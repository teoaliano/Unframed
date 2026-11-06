import { copySelection, openCanvas, waitForRoom } from "./canvas.ts";
import { expect, test } from "./generation.ts";
import { nodeCard, nodeShape, promptShape, seedBoard, selectNode, wireShape } from "./nodes.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const selectBoth = async (page: Parameters<typeof selectNode>[0]) => {
  await selectNode(page, "n");
  const fox = page.locator('[data-shape-id="shape:fox"]');
  const box = (await fox.boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up("Shift");
};

test("duplicating a node with its wired source keeps the wire between the copies; a node copied alone comes without it", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [promptShape("fox", "201", "a fox", { x: -440, y: 0 }), nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }), wireShape("w", "fox", "n", "prompt")]);
  await selectBoth(page);
  await page.keyboard.press("ControlOrMeta+d");
  const copied = await waitForRoom(engine, "default", (records) => {
    const wires = records.filter((record) => record.type === "wire");
    return wires.length === 2 ? wires.find((wire) => wire.id !== "shape:w") : undefined;
  });
  expect(copied.props.from).not.toBe("shape:fox");
  expect(copied.props.to).not.toBe("shape:n");
  expect(copied.props.role).toBe("prompt");

  await selectNode(page, "n");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ControlOrMeta+d");
  await waitForRoom(engine, "default", (records) => records.filter((record) => record.type === "node").length === 3);
  await page.waitForTimeout(500);
  expect((await waitForRoom(engine, "default", (records) => records.filter((record) => record.type === "wire"))).length).toBe(2);
  await expect(nodeCard(page, "n")).toBeVisible();
});

test("copy and paste of a node with its wired source brings the wire, rewired to the pasted shapes", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [promptShape("fox", "201", "a fox", { x: -440, y: 0 }), nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }), wireShape("w", "fox", "n", "prompt")]);
  await selectBoth(page);
  await copySelection(page);
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await waitForRoom(engine, "default", (records) => {
    const wires = records.filter((record) => record.type === "wire" && record.id !== "shape:w");
    return wires.length === 1 ? wires[0] : undefined;
  });
  const records = await waitForRoom(engine, "default", (all) => all);
  expect(records.find((record) => record.id === pasted.props.from)?.type).toBe("text");
  expect(records.find((record) => record.id === pasted.props.to)?.type).toBe("node");
  expect([pasted.props.from, pasted.props.to]).not.toContain("shape:fox");
});
