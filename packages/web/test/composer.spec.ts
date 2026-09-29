import type { Page } from "@playwright/test";
import { gate } from "../../engine/test/openRouterStub.ts";
import { closeSettings } from "./settings.ts";
import { emptyCanvasPoint, openCanvas, roomShapes, shapeOnScreen } from "./canvas.ts";
import { clickShape, composer, expect, instructionBox, openComposer, pressSend, selectGroup, sendButton, sendRun, startGeneration, test, toolbar } from "./generation.ts";
import { pngBytes } from "./images.ts";
import { expectSlot, expectToken, inBothSchemes, resolvedColor, styleOf } from "./kit.ts";
import { emptyMedia, filledMedia, groupRecord, inGroup, promptRecord, putRecords } from "./media.ts";

const GEO = { geo: "rectangle", dash: "draw", url: "", w: 60, h: 40, growY: 0, scale: 1, flipX: false, flipY: false, labelColor: "black", color: "red", fill: "none", size: "m", font: "draw", align: "middle", verticalAlign: "middle", richText: { type: "doc", content: [{ type: "paragraph" }] } };

test("Generate grows the bar into the composer on the same centre and bottom edge; Esc closes it back to the bar", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  const bar = toolbar(page);
  await expect(bar.getByRole("button", { name: "Generate" })).toBeVisible();
  const before = (await bar.boundingBox())!;

  await bar.getByRole("button", { name: "Generate" }).click();
  // The morph animates size and place together, then settles on the composer.
  await expect(bar).toHaveAttribute("data-morphing", "true");
  await expect(bar).not.toHaveAttribute("data-morphing");
  await expect.poll(async () => Math.round((await bar.boundingBox())!.width)).toBe(420);
  const after = (await bar.boundingBox())!;
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 0);
  expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
  expect(after.height).toBeGreaterThan(before.height);

  // Esc from inside the box closes the composer and keeps the selection.
  await expect(instructionBox(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Generate" })).toBeVisible();
});

/** What a box-shadow value computes to on this page. */
const shadowOf = (page: Page, expression: string) =>
  page.evaluate((value) => {
    const probe = document.createElement("div");
    probe.style.boxShadow = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).boxShadow;
    probe.remove();
    return resolved;
  }, expression);

test("the composer is t3code's composer shell, with the kit's segmented medium switch and its primary send button", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  const shell = toolbar(page);
  const media = composer(page).getByRole("radiogroup", { name: "Medium" });
  await expectSlot(media, "toggle-group");
  for (const option of await media.getByRole("radio").all()) await expectSlot(option, "toggle");
  await expectSlot(sendButton(page), "button");
  await expect.poll(async () => Math.round((await shell.boundingBox())!.width)).toBe(420);
  await inBothSchemes(page, async (scheme) => {
    await page.mouse.move(5, 500);
    await expect.poll(() => styleOf(shell, "border-top-left-radius")).toBe("22px");
    const glass = scheme === "light" ? "var(--card)" : "var(--surface-raised)";
    expect(await styleOf(shell, "background-color")).toBe(await resolvedColor(page, `color-mix(in oklab, ${glass} var(--glass-opacity), transparent)`));
    // Light carries t3code's composer shadow; dark drops it, as t3code does.
    const composerShadow = await shadowOf(page, "var(--shadow-composer)");
    if (scheme === "light") expect(await styleOf(shell, "box-shadow")).toContain(composerShadow);
    else expect(await styleOf(shell, "box-shadow")).not.toContain(composerShadow);
    await expectToken(sendButton(page), "background-color", "--message-action");
    await expectToken(composer(page).getByTestId("source-count"), "color", "--color-muted-foreground");
  });
});

test("Agent opens the composer on its Agent tray, the slot spec 08 fills; Esc closes it back to the bar", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await toolbar(page).getByRole("button", { name: "Agent" }).click();
  await expect(composer(page)).toHaveAttribute("data-tray", "agent");
  await expect(composer(page).getByTestId("agent-tray")).toBeVisible();
  await expect(instructionBox(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Agent" })).toBeVisible();
});

test("clicking a shape while the composer is open adds it; clicking empty canvas closes it", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  await expect(composer(page).getByTestId("source-count")).toHaveText("1 selected");

  await clickShape(page, "shape:starter-scene");
  await expect(composer(page).getByTestId("source-count")).toHaveText("2 selected");
  await expect(composer(page)).toBeVisible();

  const empty = await emptyCanvasPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await expect(composer(page)).toHaveCount(0);
  await expect(toolbar(page)).toHaveCount(0);
});

test("the top band offers only the registered media and names the source by count or group", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await putRecords(generation.engine, [
    groupRecord("shape:character", "character", { x: 420, y: 40 }),
    inGroup(promptRecord("shape:line", "300", "a caption"), "shape:character", { x: 40, y: 60 }),
  ]);
  await expect(shapeOnScreen(page, "shape:line")).toBeVisible();
  await selectGroup(page, "shape:character");
  await openComposer(page);
  const media = composer(page).getByRole("radiogroup", { name: "Medium" });
  await expect(media.getByRole("radio")).toHaveText(["image", "video", "text"]);
  await expect(media.getByRole("radio", { name: "image" })).toHaveAttribute("aria-checked", "true");
  await expect(composer(page).getByTestId("source-count")).toHaveText("@character");
});

test("the box: a placeholder, the @ menu, Enter adds a line, Cmd+Enter sends", async ({ page, generation }) => {
  await openCanvas(page, generation.engine);
  await clickShape(page, "shape:starter-subject");
  await openComposer(page);
  const box = instructionBox(page);
  await expect(box.locator("p").first()).toHaveAttribute("data-placeholder", "What should this make?");

  await page.keyboard.type("in the style of @10");
  const menu = page.getByRole("listbox", { name: "Mentions" });
  await expect(menu.getByRole("option")).toHaveText([/^@100/, /^@101/]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(box).toHaveText("in the style of @101 ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second line");
  await expect(box.locator("p")).toHaveText(["in the style of @101 ", "second line"]);
  expect(generation.requests).toHaveLength(0);

  // Esc closes the mention menu first, then the composer.
  await page.keyboard.type(" @");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  await pressSend(page);
  await expect.poll(() => generation.requests.length).toBe(1);
  // Acknowledged: the composer is back to the bar.
  await expect(composer(page)).toHaveCount(0);
  expect(generation.requests[0]!.body.prompt).toBe("lone red fox\n\nin the style of A lone red fox on a windswept cliff at golden hour, cinematic, 35mm \nsecond line");
  await expect.poll(async () => (await roomShapes(generation.engine, "default", "image")).filter((shape) => shape.props.assetId).length).toBe(1);
});

test("while a send is acknowledged the button spins and is disabled, and a second press does nothing", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "300", at: { x: 420, y: 40 }, bytes: pngBytes(40, 40), name: "photo.png", mime: "image/png", natural: { w: 40, h: 40 }, width: 200 });
  await putRecords(engine, [{ ...(promptRecord("shape:note", "301", "x", { x: 440, y: 60 }) as object), type: "geo", index: "b10", props: GEO, meta: {} }]);
  await expect(shapeOnScreen(page, "shape:note")).toBeVisible();
  // Holding the composite's upload holds the send before it is acknowledged.
  const upload = gate<void>();
  await page.route("**/api/projects/*/files?*source=composite*", async (route) => {
    await upload.promise;
    await route.continue();
  });
  await clickShape(page, "shape:photo");
  await clickShape(page, "shape:starter-subject", ["Shift"]);
  await openComposer(page);
  await sendButton(page).click();
  await expect(sendButton(page)).toBeDisabled();
  await expect(sendButton(page)).toHaveAttribute("data-sending", "true");
  await page.keyboard.press("ControlOrMeta+Enter");
  await sendButton(page).click({ force: true });
  upload.release();
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(() => generation.requests.length).toBe(1);
  await page.waitForTimeout(500);
  expect(generation.requests).toHaveLength(1);
});

test("warnings and the states that disable send", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  await filledMedia(engine, { id: "shape:photo", type: "image", ref: "300", at: { x: 420, y: -60 }, bytes: pngBytes(40, 40), name: "photo.png", mime: "image/png", natural: { w: 40, h: 40 }, width: 140 });
  await filledMedia(engine, { id: "shape:clip", type: "video", ref: "301", at: { x: -380, y: 150 }, bytes: Buffer.from("x"), name: "clip.mp4", mime: "video/mp4", natural: { w: 64, h: 36 }, width: 160 });
  await putRecords(engine, [promptRecord("shape:loop-a", "302", "see @303", { x: 640, y: -60 }), promptRecord("shape:loop-b", "303", "see @302", { x: 640, y: 150 })]);
  await expect(shapeOnScreen(page, "shape:loop-b")).toBeVisible();

  // An image alone: nothing says what to make.
  await clickShape(page, "shape:photo");
  await openComposer(page);
  const status = composer(page).getByTestId("composer-status");
  await expect(status).toHaveText("Nothing says what to make. Select a prompt, or type an instruction.");
  // What stops the send is a kit Alert; a warning is muted text.
  await expectSlot(status.locator("[data-kind='blocked']"), "alert");
  await expect(sendButton(page)).toBeDisabled();
  await page.keyboard.type("make it blue");
  await expect(status).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();

  // A video in an image run is warned about but still allowed.
  await clickShape(page, "shape:clip");
  await expect(status).toHaveText("A video is selected, but image models do not take video input. It will be sent and probably ignored.");
  await expectToken(status.locator("[data-kind='warning']"), "color", "--color-muted-foreground");
  await expect(sendButton(page)).toBeEnabled();
  await page.keyboard.press("Escape");

  // A loop stops the run with its message.
  await clickShape(page, "shape:loop-a");
  await openComposer(page);
  await expect(status).toHaveText("Circular reference: 302 -> 303 -> 302");
  await expect(sendButton(page)).toBeDisabled();
});

test("without a key, send is disabled and the tray says where to add one", async ({ page }) => {
  const generation = await startGeneration({ key: false });
  try {
    await openCanvas(page, generation.engine);
    // A keyless first load opens the settings dialog (spec 10).
    await closeSettings(page);
    await clickShape(page, "shape:starter-subject");
    await openComposer(page);
    await expect(composer(page).getByTestId("composer-status")).toHaveText(
      "No OpenRouter key yet. Add one with the key icon in the top right (it becomes a settings gear once saved).",
    );
    await expect(sendButton(page)).toBeDisabled();
  } finally {
    await generation.engine.dispose();
  }
});

test("more images than the model takes are warned about with the number", async ({ page, generation }) => {
  const { engine } = generation;
  await openCanvas(page, engine);
  for (let index = 0; index < 5; index++) {
    await filledMedia(engine, { id: `shape:img-${index}`, type: "image", ref: String(300 + index), at: { x: 420 + (index % 3) * 150, y: -60 + Math.floor(index / 3) * 160 }, bytes: pngBytes(20, 20, index), name: `p${index}.png`, mime: "image/png", natural: { w: 20, h: 20 }, width: 140 });
  }
  await putRecords(engine, [emptyMedia("shape:blank", "image", "310", { x: 420, y: 300 })]);
  await expect(shapeOnScreen(page, "shape:img-4")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await openComposer(page);
  await expect(composer(page).getByTestId("composer-status")).toContainText(
    "5 images are selected, but this model takes at most 4. Deselect the rest, or pick a model that takes more.",
  );
});
