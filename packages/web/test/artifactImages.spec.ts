import { readFile, utimes } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { centre, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./agent.ts";
import { filledArtifact, projectPath, writeProjectFile } from "./artifacts.ts";
import type { TestEngine } from "../../engine/test/engineProcess.ts";

/** A 1 by 1 PNG: the picker lists files by their type and name, so the bytes only need to be an image. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** An image, two elements with a picture each: an <img>, and a card whose background is a picture. */
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}main{padding:16px}.card{width:200px;height:120px;background-size:cover}</style></head><body><main><h1>Welcome</h1><img alt="Hero picture" src="old.png" width="200" height="120"><div class="card" style="background-image: url(&quot;old.png&quot;)">Card</div></main></body></html>`;

const editor = (page: Page) => page.getByTestId("artifact-editor");
const region = (page: Page) => page.getByRole("region", { name: "Editing Landing" });
const frameOf = (page: Page) => region(page).frameLocator("iframe[data-artifact-frame]");
const parameters = (page: Page) => editor(page).locator('[data-editor-column="parameters"]');
const outline = (page: Page, kind: "hover" | "selected") => page.locator(`[data-edit-outline="${kind}"]`);
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose an image" });

/** The file the Landing page shape names in the room. */
const fileOf = async (engine: TestEngine): Promise<string | undefined> => (await roomShapes(engine, "default", "page")).find((record) => record.id === "shape:landing")?.props?.file;

const textOf = async (engine: TestEngine, file: string): Promise<string> => readFile(projectPath(engine, file), "utf8");

/** Puts an image in the project folder with a set time, so the picker's newest-first order is known. */
const putImage = async (engine: TestEngine, name: string, secondsAgo: number): Promise<void> => {
  await writeProjectFile(engine, name, PNG);
  const when = new Date(Date.now() - secondsAgo * 1000);
  await utimes(projectPath(engine, name), when, when);
};

const onBoard = async (page: Page, engine: TestEngine) => {
  await openCanvas(page, engine);
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "150", at: { x: -520, y: -40 }, size: { w: 400, h: 260 }, title: "Landing", html: PAGE });
  await expect(shapeOnScreen(page, "shape:landing")).toBeVisible();
};

const openEditor = async (page: Page) => {
  await page.mouse.click(640, 600);
  const at = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(at.x, at.y);
  await expect(region(page)).toBeVisible();
};

/** Selects a frame element once the bridge is live: the page is prepared and swapped in first. */
const select = async (page: Page, target: Locator) => {
  await expect(async () => {
    await target.click();
    await expect(outline(page, "selected")).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
};

/** The names the picker lists, in the order they show. */
const listed = (page: Page): Promise<string[]> => picker(page).locator("[data-image-file]").evaluateAll((items) => items.map((item) => item.getAttribute("data-image-file") ?? ""));

test("the picker lists the project's images newest first, filters them, and swaps an img and a background image", async ({ page, agent }) => {
  await onBoard(page, agent);
  await putImage(agent, "old.png", 500);
  await putImage(agent, "older.png", 2000);
  await putImage(agent, "newer.png", 60);
  await openEditor(page);

  await select(page, frameOf(page).getByRole("img", { name: "Hero picture" }));
  await parameters(page).getByRole("button", { name: "Replace image" }).click();
  await expect(picker(page)).toBeVisible();
  expect(await listed(page)).toEqual(["newer.png", "old.png", "older.png"]);

  await picker(page).getByRole("textbox", { name: "Filter images" }).fill("older");
  expect(await listed(page)).toEqual(["older.png"]);
  await picker(page).getByRole("button", { name: "older.png" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(frameOf(page).getByRole("img", { name: "Hero picture" })).toHaveAttribute("src", "older.png");

  // The card's background is a picture too: choosing one there swaps the background image.
  await select(page, frameOf(page).getByText("Card"));
  await parameters(page).getByRole("button", { name: "Replace image" }).click();
  await picker(page).getByRole("button", { name: "newer.png" }).click();
  await expect(frameOf(page).getByText("Card")).toHaveCSS("background-image", /newer\.png/);

  // Both edits reach the file once the element changes are saved.
  await page.getByRole("region", { name: "Editing Landing" }).getByTestId("artifact-editor-title").click();
  await expect.poll(async () => (await fileOf(agent)) ?? "", { timeout: 8000 }).not.toBe("");
  await expect
    .poll(async () => {
      const file = await fileOf(agent);
      return file === undefined ? "" : await textOf(agent, file);
    }, { timeout: 8000 })
    .toMatch(/src="older\.png"[\s\S]*background-image:\s*url\((&quot;|")newer\.png/);
});

test("an upload from the picker lands in the project and is chosen for the picture", async ({ page, agent }) => {
  await onBoard(page, agent);
  await openEditor(page);

  await select(page, frameOf(page).getByRole("img", { name: "Hero picture" }));
  await parameters(page).getByRole("button", { name: "Replace image" }).click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByText("No images in this project yet.")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await picker(page).getByRole("button", { name: "Upload image" }).click();
  (await chooser).setFiles({ name: "Fresh.png", mimeType: "image/png", buffer: PNG });

  await expect(frameOf(page).getByRole("img", { name: "Hero picture" })).toHaveAttribute("src", /fresh\.png$/);
  await expect(picker(page)).toHaveCount(0);
  await page.getByRole("region", { name: "Editing Landing" }).getByTestId("artifact-editor-title").click();
  await expect
    .poll(async () => {
      const file = await fileOf(agent);
      return file === undefined ? "" : await textOf(agent, file);
    }, { timeout: 8000 })
    .toMatch(/<img[^>]*src="[^"]*fresh\.png"/);
});
