import { openCanvas, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./generation.ts";
import { centreOf, clickShape, drawWire, imageAsset, imageShape, nodeCard, nodeShape, pageShape, promptShape, seedBoard, selectNode, wires, wireShape } from "./nodes.ts";

test("a wire drawn from a shape's handle onto a node is made with its first role; dropped elsewhere it is refused", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    promptShape("fox", "201", "a lone red fox", { x: -440, y: 0 }),
    promptShape("other", "203", "elsewhere", { x: -440, y: 260 }),
    nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }),
  ]);
  await drawWire(page, "shape:fox", await centreOf(nodeCard(page, "n")));
  const [made] = await waitForRoom(engine, "default", (records) => {
    const found = records.filter((record) => record.type === "wire");
    return found.length === 1 ? found : undefined;
  });
  expect(made!.props).toEqual({ from: "shape:fox", to: "shape:n", role: "prompt" });
  await expect(page.getByTestId("wire-chip")).toHaveText("prompt");

  await drawWire(page, "shape:other", await centreOf(shapeOnScreen(page, "shape:fox")));
  await expect(toast(page, "A wire ends at a node. Drop it on a node.")).toBeVisible();
  expect(await wires(engine)).toHaveLength(1);
});

test("the wire handle shows on the selected shape only; hovering a shape shows none", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [promptShape("fox", "201", "a lone red fox", { x: -440, y: 0 }), promptShape("pic", "203", "a wide field", { x: -440, y: 260 })]);
  const handle = page.getByTestId("wire-handle");
  const fox = await centreOf(shapeOnScreen(page, "shape:fox"));
  await page.mouse.move(fox.x, fox.y);
  await page.mouse.move(fox.x + 2, fox.y + 1);
  await page.waitForTimeout(200);
  await expect(handle).toHaveCount(0);

  await clickShape(page, "shape:fox");
  await expect(handle).toHaveAttribute("data-wire-from", "shape:fox");
  const pic = await centreOf(shapeOnScreen(page, "shape:pic"));
  await page.mouse.move(pic.x, pic.y);
  await page.mouse.move(pic.x + 2, pic.y + 1);
  await page.waitForTimeout(200);
  await expect(handle).toHaveAttribute("data-wire-from", "shape:fox");
});

test("a loop, an audio source and a second first frame are refused with their sentences", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    nodeShape("a", "201", { medium: "image", instruction: "x" }, { x: -440, y: -100 }),
    nodeShape("b", "202", { medium: "video", model: "google/veo-3.1", instruction: "y" }, { x: 120, y: -60 }),
    wireShape("ab", "a", "b", "reference"),
  ]);
  await drawWire(page, "shape:b", await centreOf(nodeCard(page, "a")));
  await expect(toast(page, "That wire would loop back into @202. A node cannot feed itself through other nodes.")).toBeVisible();
  expect(await wires(engine)).toHaveLength(1);
});

test("deleting a source deletes its wires in the same undo step, and Delete removes a selected wire", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    promptShape("fox", "201", "a fox", { x: -440, y: 0 }),
    promptShape("night", "203", "at night", { x: -440, y: 260 }),
    nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }),
    wireShape("w1", "fox", "n", "prompt"),
    wireShape("w2", "night", "n", "prompt"),
  ]);
  await clickShape(page, "shape:fox");
  await page.keyboard.press("Delete");
  await waitForRoom(engine, "default", (records) => records.filter((record) => record.type === "wire").length === 1);
  expect((await wires(engine))[0]!.id).toBe("shape:w2");
  await page.keyboard.press("ControlOrMeta+z");
  await waitForRoom(engine, "default", (records) => records.some((record) => record.id === "shape:fox") && records.filter((record) => record.type === "wire").length === 2);
  await clickShape(page, "shape:fox");
  await page.keyboard.press("Delete");
  await waitForRoom(engine, "default", (records) => records.filter((record) => record.type === "wire").length === 1);
  await selectNode(page, "n");
  await nodeCard(page, "n").getByTestId("node-input").first().click();
  await expect(nodeCard(page, "n")).not.toHaveAttribute("data-node-live", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Delete");
  await waitForRoom(engine, "default", (records) => records.every((record) => record.type !== "wire"));
});

test("the role menu offers what the medium and model take, numbers references by the input list, and a drag renumbers them", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [
    imageAsset("one", "one.png"),
    imageAsset("two", "two.png"),
    imageShape("top", "201", "asset:one", { x: -440, y: -150 }),
    imageShape("low", "203", "asset:two", { x: -440, y: 140 }),
    promptShape("p", "204", "mix them", { x: -440, y: 380 }),
    nodeShape("n", "202", { medium: "image" }, { x: 120, y: -60 }),
    wireShape("wp", "p", "n", "prompt"),
    wireShape("wl", "low", "n", "reference"),
    wireShape("wt", "top", "n", "reference"),
  ]);
  await expect(page.locator('[data-testid="wire-chip"][data-wire-id="shape:wl"]')).toHaveText("image 1");
  await expect(page.locator('[data-testid="wire-chip"][data-wire-id="shape:wt"]')).toHaveText("image 2");
  await page.locator('[data-testid="wire-chip"][data-wire-id="shape:wl"]').getByRole("button").click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["Reference"]);
  await page.keyboard.press("Escape");

  await selectNode(page, "n");
  const rows = nodeCard(page, "n").getByTestId("node-input");
  await expect(rows).toHaveCount(3);
  await rows.nth(2).dragTo(rows.nth(1));
  await expect(page.locator('[data-testid="wire-chip"][data-wire-id="shape:wt"]')).toHaveText("image 1");
  await expect(page.locator('[data-testid="wire-chip"][data-wire-id="shape:wl"]')).toHaveText("image 2");
});

test("a page wire asks what it sends, offers HTML, Picture and Both, and the Files choice", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await seedBoard(engine, [pageShape("pg", "201", { file: "proto.html", title: "Proto" }, { x: -460, y: -100 }), nodeShape("n", "202", { medium: "text", instruction: "review" }, { x: 120, y: -60 })]);
  await drawWire(page, "shape:pg", await centreOf(nodeCard(page, "n")));
  const chip = page.getByTestId("wire-chip");
  await expect(chip).toHaveText("Choose what it sends");
  await chip.getByRole("button").click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["HTML", "Picture", "Both", "The page alone", "With its linked files"]);
  await page.getByRole("menuitemradio", { name: "Both" }).click();
  await expect(chip).toHaveText("Both");
  await chip.getByRole("button").click();
  await page.getByRole("menuitemradio", { name: "The page alone" }).click();
  const [wire] = await waitForRoom(engine, "default", (records) => {
    const found = records.filter((record) => record.type === "wire" && record.props.files === "entry");
    return found.length === 1 ? found : undefined;
  });
  expect(wire!.props).toMatchObject({ role: "both", files: "entry" });
  expect(wire!.meta.unframed.chosen).toBe(true);
  await expect(chip).toHaveText("Both · image 1");
});
