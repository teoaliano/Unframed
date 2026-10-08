import type { Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { editorFocused, emptyCanvasPoint, openCanvas, plainText, roomRecords, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";

const menu = (page: Page) => page.getByRole("listbox", { name: "Mentions" });
const rows = (page: Page) => menu(page).getByRole("option");

const addGroup = async (engine: TestEngine, name: string) => {
  const rpc = await engine.rpc();
  await rpc.call("testCanvas.apply", {
    project: "default",
    change: {
      put: [
        {
          id: `shape:group-${name}`,
          typeName: "shape",
          type: "frame",
          x: -900,
          y: -900,
          rotation: 0,
          index: "a8",
          parentId: "page:page",
          isLocked: false,
          opacity: 1,
          props: { w: 420, h: 280, name, color: "black" },
          meta: {},
        },
      ],
      remove: [],
    },
    origin: { kind: "server", id: "test" },
  });
};

/** Starts a new prompt and answers its id once the room has it. */
const newPrompt = async (page: Page, engine: TestEngine) => {
  const before = new Set((await roomRecords(engine, "default")).map((record) => record.id));
  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  await editorFocused(page);
  return waitForRoom(engine, "default", (records) => records.find((record) => record.type === "text" && !before.has(record.id))?.id);
};

const textOf = async (engine: TestEngine, id: string) => plainText((await roomRecords(engine, "default")).find((record) => record.id === id));

test.describe("the mention menu", () => {
  test("opens on @, lists the other prompts and groups with previews, and filters by prefix, case-insensitively", async ({ page, engine }) => {
    await openCanvas(page, engine);
    await addGroup(engine, "Hero-shots");
    await newPrompt(page, engine);
    await page.keyboard.type("A photo of @");
    await expect(menu(page)).toBeVisible();
    // Names first, then the numbered refs.
    await expect(rows(page)).toHaveText(["@Hero-shots", "@100lone red fox", "@101A @100 on a windswept cl…"]);

    const box = (await menu(page).boundingBox())!;
    const prompt = (await page.locator(".tl-shape[data-shape-type='text']").filter({ hasText: "A photo of" }).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(prompt.y + prompt.height - 2);
    expect(box.height).toBeLessThanOrEqual(168);

    await page.keyboard.type("10");
    await expect(rows(page)).toHaveText(["@100lone red fox", "@101A @100 on a windswept cl…"]);
    await page.keyboard.type("1");
    await expect(rows(page)).toHaveText(["@101A @100 on a windswept cl…"]);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("hE");
    await expect(rows(page)).toHaveText(["@Hero-shots"]);
    await page.keyboard.type("x");
    await expect(menu(page)).toHaveCount(0);
  });

  test("arrow keys move the highlight and wrap, Enter inserts the ref and a space, and Enter never adds a line while it is open", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const id = await newPrompt(page, engine);
    await page.keyboard.type("see @");
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.type("now");
    await expect.poll(() => textOf(engine, id)).toBe("see @101 now");
  });

  test("Tab inserts, and a mouse press on a row inserts", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const id = await newPrompt(page, engine);
    await page.keyboard.type("@10");
    await page.keyboard.press("Tab");
    await page.keyboard.type("and @");
    await rows(page).filter({ hasText: "@101" }).click();
    await page.keyboard.type("end");
    await expect.poll(() => textOf(engine, id)).toBe("@100 and @101 end");
  });

  test("Escape closes the menu, and a second Escape leaves editing", async ({ page, engine }) => {
    await openCanvas(page, engine);
    const id = await newPrompt(page, engine);
    await page.keyboard.type("@1");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable)).toBe(true);
    await page.keyboard.press("Enter");
    await page.keyboard.type("x");
    await expect.poll(() => textOf(engine, id)).toBe("@1\nx");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false)).toBe(false);
  });
});
