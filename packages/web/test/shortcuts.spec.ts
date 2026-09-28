import { editorFocused, emptyCanvasPoint, openCanvas, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const newShape = async (engine: Parameters<typeof roomRecords>[0], before: Set<string>, type: string) =>
  waitForRoom(engine, "default", (records) => records.find((record) => record.typeName === "shape" && record.type === type && !before.has(record.id)));

test("I, U, Shift+P and Shift+M add an empty image, video, page and motion at the pointer; tldraw uses none of those keys", async ({ page, engine }) => {
  await openCanvas(page, engine);
  for (const [key, type] of [
    ["i", "image"],
    ["u", "video"],
    ["Shift+P", "page"],
    ["Shift+M", "motion"],
  ] as const) {
    const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
    const at = await emptyCanvasPoint(page);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press(key);
    const made = await newShape(engine, before, type);
    expect(made.parentId).toBe("page:page");
    const box = (await shapeOnScreen(page, made.id).boundingBox())!;
    expect(Math.abs(box.x - at.x)).toBeLessThan(2);
    expect(Math.abs(box.y - at.y)).toBeLessThan(2);
    // tldraw's select tool is still the tool: no default binding took the key too.
    await expect(page.getByTestId("tools.select")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
  }
});

test("the add keys type into a prompt being edited or a dialog's field instead", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = shapeOnScreen(page, "shape:starter-subject");
  await subject.dblclick();
  await editorFocused(page);
  // Editing starts with all text selected, so typing replaces it.
  await page.keyboard.type("iu");
  await page.keyboard.press("Escape");
  await expect(subject.locator(".tl-rich-text")).toHaveText("iu");

  await page.getByRole("button", { name: "Project" }).click();
  await page.getByRole("menuitem", { name: "Add project" }).click();
  await page.getByLabel("Project name").pressSequentially("iu");
  await expect(page.getByLabel("Project name")).toHaveValue("iu");
  await page.getByRole("button", { name: "Cancel" }).click();

  const shapes = (await roomRecords(engine, "default")).filter((record) => record.typeName === "shape");
  expect(shapes.map((record) => record.type).sort()).toEqual(["text", "text"]);
});
