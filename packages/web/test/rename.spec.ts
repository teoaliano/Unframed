import type { Locator, Page } from "@playwright/test";
import type { TestEngine } from "../../engine/test/engineProcess.ts";
import { test as agentTest } from "./agent.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { centre, editorFocused, emptyCanvasPoint, openCanvas, plainText, roomRecords, shapeOnScreen, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { clickShape, openComposer, sendRun, test as generationTest } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { emptyMedia, filledMedia, promptRecord, putRecords } from "./media.ts";

const field = (page: Page, kind: string) => page.getByRole("textbox", { name: `${kind} name` });

const label = (page: Page, id: string): Locator => shapeOnScreen(page, id).locator("[data-shape-label]").first();

/** Double-clicks a shape's label, a few pixels in from its left end. */
const dblclickLabel = async (page: Page, id: string) => {
  const box = (await label(page, id).boundingBox())!;
  await page.mouse.dblclick(box.x + 6, box.y + box.height / 2);
};

const recordOf = async (engine: TestEngine, id: string) => (await roomRecords(engine, "default")).find((record) => record.id === id);

const refOf = async (engine: TestEngine, id: string) => (await recordOf(engine, id))?.meta?.ref;

const heroImage = (engine: TestEngine) =>
  filledMedia(engine, { id: "shape:hero", type: "image", ref: "102", at: { x: 480, y: 120 }, bytes: pngBytes(64, 40, 7), name: "hero.png", mime: "image/png", natural: { w: 64, h: 40 } });

test("a filled image shows its @id, and double-clicking that label names it, rewriting every prompt that references it in one undo step", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await heroImage(engine);
  await putRecords(engine, [promptRecord("shape:uses", "300", "@102 in the snow, not @1020", { x: 40, y: 500 })]);
  await expect(label(page, "shape:hero")).toHaveText("@102");
  const prompts = (await roomRecords(engine, "default")).filter((record) => record.type === "text").length;

  await dblclickLabel(page, "shape:hero");
  const name = field(page, "Image");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("102");
  expect(await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 3]);
  await page.keyboard.type("Hero shot");
  await page.keyboard.press("Enter");
  await expect(name).toHaveCount(0);

  await expect.poll(() => refOf(engine, "shape:hero")).toBe("hero-shot");
  await expect(label(page, "shape:hero")).toHaveText("@hero-shot");
  await expect.poll(async () => plainText(await recordOf(engine, "shape:uses"))).toBe("@hero-shot in the snow, not @1020");
  // The double-click went to the label: no prompt appeared.
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "text")).toHaveLength(prompts);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => refOf(engine, "shape:hero")).toBe("102");
  await expect.poll(async () => plainText(await recordOf(engine, "shape:uses"))).toBe("@102 in the snow, not @1020");
});

test("a prompt's label renames it, a name in use takes a suffix, and a double-click on its text still edits the text", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [promptRecord("shape:line", "300", "a red fox", { x: 480, y: 120 }), promptRecord("shape:fox", "fox", "taken", { x: 480, y: 300 })]);
  await expect(label(page, "shape:line")).toHaveText("@300");

  await dblclickLabel(page, "shape:line");
  await expect(field(page, "Prompt")).toBeFocused();
  await page.keyboard.type("Fox");
  await page.keyboard.press("Enter");
  await expect.poll(() => refOf(engine, "shape:line")).toBe("fox-2");
  await expect(label(page, "shape:line")).toHaveText("@fox-2");

  // Escape abandons a draft, and Backspace in the field never deletes the prompt.
  await dblclickLabel(page, "shape:line");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("scene");
  await page.keyboard.press("Escape");
  await expect(field(page, "Prompt")).toHaveCount(0);
  expect(await refOf(engine, "shape:line")).toBe("fox-2");

  const text = await centre(shapeOnScreen(page, "shape:line"));
  await page.mouse.dblclick(text.x, text.y);
  await editorFocused(page);
  await expect(field(page, "Prompt")).toHaveCount(0);
});

test("Rename in the right-click menu and F2 open the field on a video, a page and a motion", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [
    emptyMedia("shape:clip", "video", "110", { x: 480, y: 80 }),
    artifactShape({ id: "shape:landing", kind: "page", ref: "111", at: { x: -400, y: 100 }, size: { w: 300, h: 160 } }),
    artifactShape({ id: "shape:intro", kind: "motion", ref: "112", at: { x: -400, y: 340 }, size: { w: 300, h: 140 } }),
  ]);
  await expect(label(page, "shape:clip")).toHaveText("Video");

  const at = await centre(shapeOnScreen(page, "shape:clip"));
  await page.mouse.move(at.x, at.y + 40);
  await page.waitForTimeout(100);
  await page.mouse.click(at.x, at.y + 40, { button: "right" });
  await page.getByTestId("context-menu").getByRole("menuitem", { name: /^Rename/ }).click();
  await expect(field(page, "Video")).toBeFocused();
  await expect(field(page, "Video")).toHaveValue("110");
  await page.keyboard.type("waves");
  await page.keyboard.press("Enter");
  await expect.poll(() => refOf(engine, "shape:clip")).toBe("waves");
  // An empty medium with a name shows the name instead of its kind.
  await expect(label(page, "shape:clip")).toHaveText("@waves");

  await clickShape(page, "shape:landing");
  await page.keyboard.press("F2");
  await expect(field(page, "Page")).toBeFocused();
  await page.keyboard.type("Pricing page");
  await page.keyboard.press("Enter");
  // A page or motion takes its name as its title too, so every list of artifacts shows it.
  await expect.poll(async () => (await recordOf(engine, "shape:landing"))?.props?.title).toBe("pricing-page");
  expect(await refOf(engine, "shape:landing")).toBe("pricing-page");
  await expect(label(page, "shape:landing")).toHaveText("@pricing-page");

  await clickShape(page, "shape:intro");
  await page.keyboard.press("F2");
  await expect(field(page, "Motion")).toBeFocused();
  await page.keyboard.type("intro");
  await page.mouse.click(40, 40);
  await expect.poll(() => refOf(engine, "shape:intro")).toBe("intro");

  // A right-click on a label opens the menu of the label's shape.
  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x, empty.y);
  const tag = (await label(page, "shape:intro").boundingBox())!;
  await page.mouse.move(tag.x + 6, tag.y + tag.height / 2);
  await page.mouse.click(tag.x + 6, tag.y + tag.height / 2, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu.getByRole("menuitem", { name: "Copy @intro" })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Rename/ }).click();
  await expect(field(page, "Motion")).toBeFocused();
  await page.keyboard.type("opening");
  await page.keyboard.press("Enter");
  await expect.poll(() => refOf(engine, "shape:intro")).toBe("opening");
});

agentTest("double-clicking a page's label renames it, and a double-click on its body still opens the editor", async ({ page, agent }) => {
  await openCanvas(page, agent);
  await filledArtifact(agent, { id: "shape:landing", kind: "page", ref: "150", at: { x: -400, y: 100 }, size: { w: 400, h: 260 }, title: "Landing", html: "<h1>Welcome</h1>" });
  await expect(label(page, "shape:landing")).toHaveText("Landing");

  await dblclickLabel(page, "shape:landing");
  await expect(field(page, "Page")).toBeFocused();
  await expect(field(page, "Page")).toHaveValue("150");
  await page.keyboard.type("home");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await recordOf(agent, "shape:landing"))?.meta?.ref).toBe("home");
  await expect(label(page, "shape:landing")).toHaveText("@home");
  await expect(page.getByRole("region", { name: /^Editing/ })).toHaveCount(0);

  // A selected page's frame takes the pointer, so the double-click lands on an unselected one, as it does without a rename.
  const away = await emptyCanvasPoint(page);
  await page.mouse.click(away.x, away.y);
  const body = await centre(shapeOnScreen(page, "shape:landing"));
  await page.mouse.dblclick(body.x, body.y);
  await expect(page.getByRole("region", { name: "Editing home" })).toBeVisible();
});

test("typing @ in a prompt offers images, videos, pages and motions by their names", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await heroImage(engine);
  await putRecords(engine, [
    { ...emptyMedia("shape:clip", "video", "hero-clip", { x: -400, y: 340 }) },
    artifactShape({ id: "shape:landing", kind: "page", ref: "hero-page", at: { x: -400, y: 60 }, size: { w: 300, h: 160 }, title: "Landing" }),
  ]);
  await dblclickLabel(page, "shape:hero");
  await page.keyboard.type("hero");
  await page.keyboard.press("Enter");
  await expect.poll(() => refOf(engine, "shape:hero")).toBe("hero");

  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  await editorFocused(page);
  await page.keyboard.type("put @");
  const rows = page.getByRole("listbox", { name: "Mentions" }).getByRole("option");
  // Names first, then the numbered ones; a picture shows itself, an empty one and an artifact their kind.
  await expect(rows).toHaveText(["@heroImage", "@hero-clipVideo", "@hero-pageLanding", "@100lone red fox", /^@101A @100/]);
  await expect(rows.nth(0).getByTestId("mention-thumb")).toHaveAttribute("data-thumb", "image");
  await expect(rows.nth(0).locator("img")).toHaveCount(1);
  await expect(rows.nth(1).getByTestId("mention-thumb")).toHaveAttribute("data-thumb", "icon");
  await expect(rows.nth(2).getByTestId("mention-thumb")).toHaveAttribute("data-thumb", "icon");
  await expect(rows.nth(3).getByTestId("mention-thumb")).toHaveCount(0);
  await page.keyboard.type("hero");
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const made = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "text" && plainText(record).startsWith("put @hero")));
  expect(plainText(made)).toBe("put @hero ");
});

generationTest("a prompt that names an image by @ sends that image as a reference, numbered after the selection", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  const hero = pngBytes(64, 40, 7);
  const other = pngBytes(64, 40, 9);
  await filledMedia(engine, { id: "shape:hero", type: "image", ref: "hero", at: { x: 480, y: 100 }, bytes: hero, name: "hero.png", mime: "image/png", natural: { w: 64, h: 40 }, width: 160 });
  await filledMedia(engine, { id: "shape:other", type: "image", ref: "301", at: { x: 480, y: 300 }, bytes: other, name: "other.png", mime: "image/png", natural: { w: 64, h: 40 }, width: 160 });
  await putRecords(engine, [promptRecord("shape:line", "300", "put @hero in the snow beside image 1", { x: -400, y: 120 })]);
  await expect(shapeOnScreen(page, "shape:hero")).toBeVisible();

  await clickShape(page, "shape:line");
  await clickShape(page, "shape:other", ["Shift"]);
  await openComposer(page);
  await expect(page.locator(`[data-role-for="shape:other"]`)).toHaveText("image 1");
  await expect(page.locator(`[data-role-for="shape:hero"]`)).toHaveText("image 2");

  await sendRun(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  const body = generation.requests[0]!.body;
  expect(body.prompt).toBe("put image 2 in the snow beside image 1");
  expect(body.input_references.map((ref: { image_url: { url: string } }) => ref.image_url.url)).toEqual(
    [other, hero].map((bytes) => `data:image/png;base64,${bytes.toString("base64")}`),
  );
});

test("while a name field is open the selection bar steps aside, and comes back above the label after", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await heroImage(engine);
  await clickShape(page, "shape:hero");
  const bar = page.getByTestId("selection-toolbar");
  await expect(bar).toBeVisible();
  // The bar clears the label, not only the picture.
  const tag = (await label(page, "shape:hero").boundingBox())!;
  await expect.poll(async () => { const box = (await bar.boundingBox())!; return box.y + box.height; }).toBeCloseTo(tag.y - 12, 0);

  await page.keyboard.press("F2");
  await expect(field(page, "Image")).toBeFocused();
  await expect(bar).toBeHidden();
  await page.keyboard.type("hero");
  await page.keyboard.press("Enter");
  await expect(bar).toBeVisible();
  await page.keyboard.press("F2");
  await expect(bar).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(bar).toBeVisible();
});

test("the field grows with what is typed, and a name of digits only is refused in place", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await heroImage(engine);
  await dblclickLabel(page, "shape:hero");
  const name = field(page, "Image");
  await expect(name).toBeFocused();
  const before = (await name.boundingBox())!.width;
  await page.keyboard.type("a much longer name for this picture");
  await expect.poll(async () => (await name.boundingBox())!.width).toBeGreaterThan(before * 3);

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  await expect(name).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: "A name needs a letter." })).toBeVisible();
  expect(await refOf(engine, "shape:hero")).toBe("102");
  // Typing again clears the message; a letter makes it a name.
  await page.keyboard.type("b");
  await expect(page.getByRole("alert").filter({ hasText: "A name needs a letter." })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect.poll(() => refOf(engine, "shape:hero")).toBe("42b");
});

test("accents are kept as their letters, and a long name is cut to its shape's width with the whole name on hover", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:hero", type: "image", ref: "102", at: { x: 480, y: 120 }, bytes: pngBytes(64, 40, 7), name: "hero.png", mime: "image/png", natural: { w: 64, h: 40 }, width: 140 });
  await dblclickLabel(page, "shape:hero");
  const long = "Città vista dal mare al tramonto con nuvole basse";
  await page.keyboard.type(long);
  await page.keyboard.press("Enter");
  const named = "citta-vista-dal-mare-al-tramonto-con-nuv";
  await expect.poll(() => refOf(engine, "shape:hero")).toBe(named);
  const shape = (await shapeOnScreen(page, "shape:hero").boundingBox())!;
  const tag = label(page, "shape:hero");
  expect((await tag.boundingBox())!.width).toBeLessThanOrEqual(shape.width + 0.5);
  await tag.hover();
  await expect(tag).toHaveAttribute("title", `@${named}`);
});

test("the field stays readable when the board is zoomed out", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await heroImage(engine);
  await clickShape(page, "shape:hero");
  await page.keyboard.press("Minus");
  await expect.poll(() => page.locator(".tl-container").getAttribute("data-label-level")).not.toBe("on");
  await page.keyboard.press("F2");
  const name = field(page, "Image");
  await expect(name).toBeFocused();
  const size = await name.evaluate((input: HTMLInputElement) => parseFloat(getComputedStyle(input).fontSize) * (input.getBoundingClientRect().height / input.offsetHeight));
  // 11 px is the label's size at 100 %.
  expect(size).toBeGreaterThanOrEqual(10.9);
});

test("a render placeholder shows its name once named", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const failed = emptyMedia("shape:render", "video", "intro-render", { x: 480, y: 120 });
  await putRecords(engine, [{ ...failed, meta: { ref: "intro-render", unframed: { runError: "The render failed." } } }]);
  await expect(shapeOnScreen(page, "shape:render").locator("[data-render='failed']")).toBeVisible();
  await expect(label(page, "shape:render")).toHaveText("@intro-render");
});

test("keys pressed right after F2, before the field has the keyboard, never reach the canvas's shortcuts", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const failed = emptyMedia("shape:render", "video", "521", { x: 480, y: 120 });
  await putRecords(engine, [{ ...failed, meta: { ref: "521", unframed: { runError: "The render failed." } } }]);
  await clickShape(page, "shape:render");
  const before = (await roomRecords(engine, "default")).filter((record) => record.type === "image").length;
  // I straight after F2, as a quick typist would: on the canvas, I alone adds an image.
  await page.keyboard.press("F2");
  await page.keyboard.type("intro");
  await expect(field(page, "Video")).toBeFocused();
  await page.waitForTimeout(300);
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "image")).toHaveLength(before);
  await page.keyboard.press("Escape");
});
