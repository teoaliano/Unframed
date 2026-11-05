import { readFile } from "node:fs/promises";
import { openCanvas, roomRecords, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./generation.ts";
import { openLibrary, presetItem, presetsFile } from "./library.ts";
import { nodeCard, nodeShape, promptShape, seedBoard, selectNode, waitForNode, wireShape } from "./nodes.ts";

test("a flow saves its nodes and the wires between them with no results, counts the wires left out, and comes back with fresh ids and empty inputs", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    promptShape("outside", "201", "a fox", { x: -440, y: 0 }),
    nodeShape("a", "202", { medium: "image", instruction: "a fox" }, { x: -40, y: -60 }),
    nodeShape("b", "203", { medium: "image", params: { quality: "high" } }, { x: 400, y: -60 }),
    wireShape("in", "outside", "a", "prompt"),
    wireShape("ab", "a", "b", "reference"),
  ]);
  await selectNode(page, "a");
  await nodeCard(page, "a").getByTestId("node-run").click();
  await waitForNode(engine, "a", (props) => props.currentVersionId !== null);

  const other = (await nodeCard(page, "b").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.click(other.x + other.width - 24, other.y + 14);
  await page.keyboard.up("Shift");
  await page.mouse.click(other.x + other.width - 24, other.y + 14, { button: "right" });
  await page.getByTestId("context-menu").getByTestId("context-menu.unframed-add-to-library").click();
  const dialog = page.getByTestId("add-to-library");
  await expect(dialog).toContainText("A flow of 2 nodes and the shapes and wires between them, with no results.");
  await dialog.getByPlaceholder("e.g. Portrait retouch").fill("Story to still");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Saved. 1 wire from outside the set was left out.")).toBeVisible();

  const [saved] = JSON.parse(await readFile(presetsFile(engine), "utf8")) as any[];
  expect(saved).toMatchObject({ name: "Story to still", kind: "flow" });
  const nodes = saved.content.shapes.filter((shape: any) => shape.type === "node");
  expect(nodes.map((shape: any) => shape.props.versions)).toEqual([[], []]);
  expect(nodes.every((shape: any) => shape.props.currentVersionId === null)).toBe(true);
  expect(saved.content.shapes.filter((shape: any) => shape.type === "wire").map((shape: any) => shape.props)).toEqual([{ from: "shape:a", to: "shape:b", role: "reference" }]);

  await page.keyboard.press("Escape");
  await openLibrary(page);
  const item = presetItem(page, "Story to still");
  await expect(item.locator('[data-chip="flow"]')).toHaveText("Flow");
  await item.getByRole("button", { name: "Add" }).click();
  const inserted = await waitForRoom(engine, "default", (records) => {
    const fresh = records.filter((record) => record.type === "node" && record.id !== "shape:a" && record.id !== "shape:b");
    return fresh.length === 2 ? fresh : undefined;
  });
  expect(inserted.every((node) => node.props.versions.length === 0 && node.props.currentVersionId === null)).toBe(true);
  expect(inserted.find((node) => node.props.params.quality === "high")).toBeDefined();
  const records = await roomRecords(engine, "default");
  const freshIds = new Set(inserted.map((node) => node.id));
  const freshWires = records.filter((record) => record.type === "wire" && freshIds.has(record.props.to));
  expect(freshWires).toHaveLength(1);
  expect(freshIds.has(freshWires[0]!.props.from)).toBe(true);
  expect(freshWires[0]!.parentId).toBe("page:page");
});
