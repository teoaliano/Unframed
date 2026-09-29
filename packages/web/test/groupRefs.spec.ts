import { editorFocused, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a group is referenceable: the @ menu lists it with no preview, and Copy @id copies its name", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    groupRecord("shape:character", "character", { x: 440, y: 80 }),
    inGroup(promptRecord("shape:line", "300", "a knight in silver armour"), "shape:character", { x: 28, y: 56 }),
  ]);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();

  const box = (await shapeOnScreen(page, "shape:character").boundingBox())!;
  await page.mouse.click(box.x + 10, box.y - 8, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await menu.getByRole("menuitem", { name: "Copy @character" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("@character");

  const subject = (await shapeOnScreen(page, "shape:starter-subject").boundingBox())!;
  await page.mouse.dblclick(subject.x + subject.width / 2, subject.y + subject.height / 2);
  await editorFocused(page);
  await page.keyboard.type("a portrait of @cha");
  const mentions = page.getByRole("listbox", { name: "Mentions" });
  await expect(mentions.getByRole("option")).toHaveText(["@character"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(shapeOnScreen(page, "shape:starter-subject")).toContainText("a portrait of @character");
});
