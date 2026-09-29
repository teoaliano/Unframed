import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { centre, editorFocused, emptyCanvasPoint, openCanvas, shapeOnScreen } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf, tokenColor } from "./kit.ts";
import { artifactShape, filledArtifact } from "./artifacts.ts";
import { pngBytes } from "./images.ts";
import { emptyMedia, filledMedia, groupRecord, putRecords } from "./media.ts";

const clipPath = fileURLToPath(new URL("./media/clip.webm", import.meta.url));

test("labels, the dot grid, empty media, the remove control, the transport and artifact cards take the kit's type and tokens", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await putRecords(engine, [emptyMedia("shape:empty", "video", "150", { x: -400, y: -100 }), artifactShape({ id: "shape:page", kind: "page", ref: "151", at: { x: -400, y: 380 }, size: { w: 240, h: 160 } })]);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "152", at: { x: 200, y: -100 }, bytes: pngBytes(300, 150), name: "photo.png", mime: "image/png", natural: { w: 300, h: 150 }, width: 200 });
  await filledMedia(engine, { id: "shape:clip", type: "video", ref: "153", at: { x: -100, y: -100 }, bytes: await readFile(clipPath), name: "clip.webm", mime: "video/webm", natural: { w: 320, h: 180 }, width: 240 });
  await filledArtifact(engine, { id: "shape:landing", kind: "page", ref: "154", at: { x: -130, y: 380 }, size: { w: 240, h: 160 }, title: "Landing", html: "<h1>Hello</h1>" });
  await expect(shapeOnScreen(page, "shape:clip")).toBeVisible();

  const empty = shapeOnScreen(page, "shape:empty");
  const label = empty.locator("[data-shape-label]");
  const card = empty.getByTestId("media-empty");
  const photo = shapeOnScreen(page, "shape:photo");
  const remove = photo.getByRole("button", { name: "Remove photo.png" });
  const transport = shapeOnScreen(page, "shape:clip").getByTestId("video-transport");
  const pageCard = shapeOnScreen(page, "shape:page").getByTestId("artifact-card");
  await expect(card).toBeVisible();

  await expectSlot(card.getByRole("button", { name: "Choose file" }), "button");
  await expectSlot(card.getByPlaceholder("or paste an https:// link"), "input");
  await expectSlot(transport.getByRole("button", { name: "Play" }), "button");

  await inBothSchemes(page, async () => {
    expect(await styleOf(label, "font-size")).toBe("11px");
    expect(await styleOf(label, "text-transform")).toBe("none");
    expect(await styleOf(label, "color")).toBe(await tokenColor(page, "--color-muted-foreground"));

    const grid = page.getByTestId("dot-grid");
    await expectToken(grid, "background-color", "--background");
    expect(await styleOf(grid, "background-image")).toContain(await resolvedColor(page, "var(--canvas-dot)"));

    await expectToken(card, "background-color", "--card");
    expect(await styleOf(card, "border-top-color")).toBe(await tokenColor(page, "--color-border"));
    expect(await styleOf(card, "border-top-left-radius")).toBe("10px");

    await expectToken(pageCard, "background-color", "--card");
    expect(await styleOf(pageCard, "border-top-left-radius")).toBe("14px");
    // A live filled page's frame stays white in both schemes (spec 09).
    const landing = shapeOnScreen(page, "shape:landing");
    await page.mouse.click(...(Object.values(await centre(landing)) as [number, number]));
    await expect(landing.locator("iframe[data-artifact-frame]")).toBeVisible();
    expect(await styleOf(landing.locator("iframe[data-artifact-frame]"), "background-color")).toBe("rgb(255, 255, 255)");
    await page.mouse.click(5, 400);

    expect(await styleOf(transport.getByTestId("video-time"), "color")).toBe(await tokenColor(page, "--color-muted-foreground"));

    await page.mouse.click(...(Object.values(await centre(photo.locator(".tl-html-container").first())) as [number, number]));
    await expectSlot(remove, "button");
    expect((await remove.boundingBox())!.width).toBeCloseTo(20, 0);
    await page.mouse.click(5, 400);
  });
});

test("the mention menu is the kit's popup with its row look", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  await editorFocused(page);
  await page.keyboard.type("A photo of @");
  const menu = page.getByRole("listbox", { name: "Mentions" });
  await expect(menu).toBeVisible();
  const glass = "color-mix(in srgb, var(--popover) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))";
  await inBothSchemes(page, async () => {
    expect(await styleOf(menu, "background-color")).toBe(await resolvedColor(page, glass));
    const row = menu.getByRole("option").first();
    expect((await row.boundingBox())!.height).toBe(28);
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expectToken(row, "background-color", "--accent");
  });
});

test("a group is a dashed frame in the border colour on the group fill, solid highlight when selected; its name field and recipe chip are the kit's", async ({ page, engine }) => {
  await openCanvas(page, engine);
  const recipe = { medium: "image", model: "openai/gpt-image-2", params: {}, runs: 2 };
  await putRecords(engine, [{ ...groupRecord("shape:character", "character", { x: -400, y: -100 }), meta: { unframed: { recipe } } }]);
  const group = shapeOnScreen(page, "shape:character");
  const frame = group.getByTestId("group-frame");
  await expect(frame).toBeVisible();
  const chip = group.getByTestId("recipe-chip");
  await expectSlot(chip, "badge");

  await inBothSchemes(page, async () => {
    await page.mouse.click(5, 400);
    expect(await styleOf(frame, "border-top-style")).toBe("dashed");
    expect(await styleOf(frame, "border-top-color")).toBe(await tokenColor(page, "--color-border"));
    expect(await styleOf(frame, "border-top-left-radius")).toBe("14px");
    await expectToken(frame, "background-color", "--group-fill");

    const box = (await frame.boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await expect(frame).toHaveAttribute("data-selected", "true");
    expect(await styleOf(frame, "border-top-style")).toBe("solid");
    expect(await styleOf(frame, "border-top-color")).toBe(await tokenColor(page, "--highlight"));
    expect(await styleOf(frame, "border-top-left-radius")).toBe("0px");

    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Group name" });
    await expectSlot(field, "input");
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
  });
});
