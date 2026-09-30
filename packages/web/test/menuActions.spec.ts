import type { Page } from "@playwright/test";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { centre, openCanvas, shapeOnScreen, toast } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { pngBytes } from "./images.ts";
import { filledMedia } from "./media.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const photo = { type: "image" as const, bytes: pngBytes(300, 150), name: "photo.png", mime: "image/png", natural: { w: 300, h: 150 } };

const choose = async (page: Page, at: { x: number; y: number }, item: string | RegExp) => {
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("context-menu").getByRole("menuitem", { name: item }).click();
};

const twoPhotos = async (page: Page, engine: Parameters<typeof filledMedia>[0]) => {
  await openCanvas(page, engine);
  const one = await filledMedia(engine, { ...photo, id: "shape:one", ref: "150", at: { x: 440, y: 60 } });
  const two = await filledMedia(engine, { ...photo, id: "shape:two", ref: "151", at: { x: 440, y: 260 } });
  await expect(shapeOnScreen(page, "shape:two").locator("img")).toBeVisible();
  return { one, two, at: { one: await centre(shapeOnScreen(page, "shape:one")), two: await centre(shapeOnScreen(page, "shape:two")) } };
};

test("Reveal shows the right-clicked file, or every selected one, and says when it cannot", async ({ page, engine }) => {
  const { one, two, at } = await twoPhotos(page, engine);
  const folder = join(engine.dataDir, "output", "default");

  await choose(page, at.one, "Reveal in Finder");
  await expect.poll(() => engine.messages.filter((message: any) => message.type === "reveal").at(-1)).toMatchObject({ files: [join(folder, one.file)] });

  await page.mouse.click(at.one.x, at.one.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(at.two.x, at.two.y);
  await page.keyboard.up("Shift");
  await choose(page, at.two, "Reveal in Finder (2)");
  await expect
    .poll(() => (engine.messages.filter((message: any) => message.type === "reveal").at(-1) as any)?.files?.slice().sort())
    .toEqual([join(folder, one.file), join(folder, two.file)].sort());

  // With the project folder moved away there is nothing to show.
  await rename(folder, `${folder}-away`);
  try {
    await choose(page, at.two, "Reveal in Finder (2)");
    await expect(toast(page, "Could not show those 2 files: No files for this project yet.")).toBeVisible();
    await page.mouse.click(10, 400);
    await choose(page, at.one, "Reveal in Finder");
    await expect(toast(page, "Could not show that file: No files for this project yet.")).toBeVisible();
  } finally {
    await rename(`${folder}-away`, folder);
  }
});

test("Copy as image puts the picture on the clipboard, and says when it cannot", async ({ page, engine }) => {
  const { one, at } = await twoPhotos(page, engine);
  await choose(page, at.one, "Copy as image");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const item = (await navigator.clipboard.read()).find((candidate) => candidate.types.includes("image/png"));
        if (!item) return undefined;
        const bitmap = await createImageBitmap(await item.getType("image/png"));
        return [bitmap.width, bitmap.height];
      }),
    )
    .toEqual([300, 150]);

  await rm(join(engine.dataDir, "output", "default", one.file));
  await choose(page, at.one, "Copy as image");
  await expect(toast(page, "Could not copy that image to the clipboard.")).toBeVisible();
});

test("Copy @id puts the reference on the clipboard, and says when it cannot", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const subject = await centre(shapeOnScreen(page, "shape:starter-subject"));
  await choose(page, subject, "Copy @100");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("@100");

  // The browser refuses the write, as it does when the page lacks clipboard access.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
  });
  await choose(page, subject, "Copy @100");
  await expect(toast(page, "Could not copy @100 to the clipboard.")).toBeVisible();
});
