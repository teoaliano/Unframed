import { editorFocused, emptyCanvasPoint, openCanvas, plainText, roomShapes, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

test.describe("making a prompt", () => {
  test("the text tool makes a prompt with a fresh ref and its @id label above it", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await page.keyboard.press("t");
    await page.mouse.click(point.x, point.y);
    await editorFocused(page);
    await page.keyboard.type("a fox in the snow");
    await page.keyboard.press("Escape");

    const prompt = await waitForRoom(engine, "default", (records) =>
      records.find((record) => record.type === "text" && plainText(record) === "a fox in the snow"),
    );
    expect(prompt.meta.ref).toBe("102");
    const label = shapeOnScreen(page, prompt.id).locator(".unframed-shape-label");
    await expect(label).toHaveText("@102");
    const labelBox = (await label.boundingBox())!;
    const textBox = (await shapeOnScreen(page, prompt.id).locator(".tl-rich-text").boundingBox())!;
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(textBox.y + 1);
    expect(Math.abs(labelBox.x - textBox.x)).toBeLessThan(2);
  });

  test("double-clicking empty canvas starts a new prompt at that spot, ready to type", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const point = await emptyCanvasPoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await editorFocused(page);
    await page.keyboard.type("typed straight away");
    await page.keyboard.press("Escape");

    const prompt = await waitForRoom(engine, "default", (records) =>
      records.find((record) => record.type === "text" && plainText(record) === "typed straight away"),
    );
    expect(prompt.meta.ref).toBe("102");
    const box = (await shapeOnScreen(page, prompt.id).boundingBox())!;
    expect(Math.abs(box.x - point.x)).toBeLessThan(40);
    expect(Math.abs(box.y - point.y)).toBeLessThan(40);
    await expect(shapeOnScreen(page, prompt.id).locator(".unframed-shape-label")).toHaveText("@102");
  });

  test("a new ref skips a number some prompt already mentions, even when nothing holds it", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const scene = (await roomShapes(engine, "default", "text")).find((record) => record.id === "shape:starter-scene")!;
    await (await engine.rpc()).call("testCanvas.apply", {
      project: "default",
      change: {
        put: [{ ...scene, props: { ...scene.props, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "see @140" }] }] } } }],
        remove: [],
      },
      origin: { kind: "server", id: "test" },
    });
    await expect(shapeOnScreen(page, "shape:starter-scene")).toContainText("see @140");
    const point = await emptyCanvasPoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await editorFocused(page);
    await page.keyboard.type("new");
    await page.keyboard.press("Escape");
    const prompt = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "text" && plainText(record) === "new"));
    expect(prompt.meta.ref).toBe("141");
  });
});
