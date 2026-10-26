import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { emptyCanvasPoint, openCanvas, roomRecords, settledRecord, shapeOnScreen, toast, waitForRoom } from "./canvas.ts";
import { expect, test } from "./fixtures.ts";
import { inBothSchemes, resolvedColor, styleOf } from "./kit.ts";
import { clickShape, toolbar } from "./generation.ts";
import { openLibrary, presetItem } from "./library.ts";
import { dropFiles, putRecords, styleRecord } from "./media.ts";
import { projectPath } from "./artifacts.ts";
import { engineChat, onlyChat, openRail, rail, say, scriptFolder, startAgentEngine } from "./agent.ts";

const LINEAR = "# Linear\n\nCalm and dense, for focused work.\n\n- Accent: #5E6AD2\n- Canvas: #08090a\n";
const NOTES = "# Standup notes\n\nShip the card by Friday.\n\n- Issue #12 is still open\n";

test("a dropped .md becomes a style card with its title, its colours and its opening lines", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await dropFiles(page, await emptyCanvasPoint(page), [{ name: "linear.md", mime: "text/markdown", bytes: Buffer.from(LINEAR) }]);
  const style = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "style"));
  expect(style.props).toMatchObject({ role: "style", title: "Linear", fileName: "linear.md", swatches: ["#5e6ad2", "#08090a"], excerpt: "Calm and dense, for focused work. Accent: #5E6AD2 Canvas: #08090a" });
  expect(style.props.file).toMatch(/^\d+-linear\.md$/);
  expect(await readFile(projectPath(engine, style.props.file), "utf8")).toBe(LINEAR);
  const card = shapeOnScreen(page, style.id).getByTestId("style-card");
  await expect(card.getByTestId("style-title")).toHaveText("Linear");
  await expect(card.locator("[data-swatch]")).toHaveCount(2);
  // A near-black swatch keeps a visible edge on the card in both schemes: a border from the foreground token.
  await inBothSchemes(page, async () => {
    const edge = await styleOf(card.locator("[data-swatch='#08090a']"), "border-top-color");
    expect(edge).toBe(await resolvedColor(page, "color-mix(in oklab, var(--foreground) 15%, transparent)"));
  });
  await expect(card.getByTestId("style-excerpt")).toContainText("Calm and dense");

  await dropFiles(page, await emptyCanvasPoint(page), [{ name: "huge.md", mime: "text/markdown", size: 102_401 }]);
  await expect(toast(page, "A style document is at most 100 KiB of markdown.")).toBeVisible();
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "style")).toHaveLength(1);
});

test("a dropped .md that names no colours becomes a document card: a file icon, no swatches", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await dropFiles(page, await emptyCanvasPoint(page), [{ name: "notes.md", mime: "text/markdown", bytes: Buffer.from(NOTES) }]);
  const shape = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "style"));
  expect(shape.props).toMatchObject({ role: "document", title: "Standup notes", fileName: "notes.md", swatches: [] });
  const card = shapeOnScreen(page, shape.id).getByTestId("style-card");
  await expect(card).toHaveAttribute("data-role", "document");
  await expect(card.getByTestId("document-icon")).toBeVisible();
  await expect(card.getByTestId("style-icon")).toHaveCount(0);
  await expect(card.getByTestId("style-swatches")).toHaveCount(0);
  await expect(card.getByTestId("style-title")).toHaveText("Standup notes");
  await expect(card.getByTestId("style-excerpt")).toContainText("Ship the card by Friday.");
});

test("a style from the library lands as a new file in the project with that document", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await openLibrary(page);
  await presetItem(page, "Linear").getByRole("button", { name: "Add" }).click();
  const style = await waitForRoom(engine, "default", (records) => records.find((record) => record.type === "style" && record.props.file !== ""));
  expect(style.props.title).toBe("Linear");
  expect(style.props.swatches.length).toBeGreaterThan(0);
  const shipped = await readFile(new URL("../../../assets/design-md/linear.app/DESIGN.md", import.meta.url), "utf8");
  expect(await readFile(projectPath(engine, style.props.file), "utf8")).toBe(shipped);
  expect(JSON.parse(await readFile(projectPath(engine, style.props.file.replace(/\.md$/, ".json")), "utf8"))).toMatchObject({ source: "preset", kind: "style", preset: "style-linear" });
  await expect(shapeOnScreen(page, style.id).getByTestId("style-title")).toHaveText("Linear");
});

test("the markdown window shows the document, saves an edit as a new version, and undo on the canvas brings the old one back", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeFile(projectPath(engine, "1-linear.md"), LINEAR);
  await putRecords(engine, [styleRecord("shape:linear", "300", { x: 620, y: 80 }, "1-linear.md", "Linear", { swatches: ["#5e6ad2"] })]);
  await expect(shapeOnScreen(page, "shape:linear")).toBeVisible();
  await clickShape(page, "shape:linear");
  await toolbar(page).getByRole("button", { name: "Open" }).click();
  const window = page.getByTestId("style-window");
  await expect(window.getByRole("heading", { name: "Linear" }).first()).toBeVisible();
  await expect(window.getByTestId("style-read")).toContainText("Calm and dense, for focused work.");

  await window.getByRole("button", { name: "Edit" }).click();
  const body = window.getByTestId("style-editor");
  await expect(body).toBeVisible();
  await body.getByText("Calm and dense, for focused work.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Never loud.");
  // Typing in the window never reaches the canvas: no shape was deleted or added by its keys.
  expect((await roomRecords(engine, "default")).filter((record) => record.type === "style")).toHaveLength(1);
  await window.getByRole("button", { name: "Save" }).click();
  const saved = await waitForRoom(engine, "default", (records) => {
    const shape = records.find((record) => record.id === "shape:linear");
    return shape && shape.props.file !== "1-linear.md" ? shape : undefined;
  });
  const text = await readFile(projectPath(engine, saved.props.file), "utf8");
  expect(text).toContain("Calm and dense, for focused work. Never loud.");
  expect(text).toContain("#5E6AD2");
  expect(await readFile(projectPath(engine, "1-linear.md"), "utf8")).toBe(LINEAR);
  expect(JSON.parse(await readFile(projectPath(engine, saved.props.file.replace(/\.md$/, ".json")), "utf8"))).toMatchObject({ source: "person", kind: "style", shapeId: "linear", of: "1-linear.md" });
  await expect(window.getByTestId("style-read")).toContainText("Never loud.");

  await page.keyboard.press("Escape");
  await expect(window).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:linear"))?.props.file).toBe("1-linear.md");
  expect(existsSync(projectPath(engine, saved.props.file))).toBe(true);
});

test("the window's switch makes a style a document as a canvas change, and undo on the canvas makes it a style again", async ({ page, engine }) => {
  await openCanvas(page, engine);
  await writeFile(projectPath(engine, "1-linear.md"), LINEAR);
  await putRecords(engine, [styleRecord("shape:linear", "300", { x: 620, y: 80 }, "1-linear.md", "Linear", { swatches: ["#5e6ad2"] })]);
  await expect(shapeOnScreen(page, "shape:linear")).toBeVisible();
  await clickShape(page, "shape:linear");
  await toolbar(page).getByRole("button", { name: "Open" }).click();
  const window = page.getByTestId("style-window");
  const role = window.getByRole("group", { name: "Use as" });
  await expect(role.getByRole("button", { name: "Style" })).toHaveAttribute("aria-pressed", "true");
  await role.getByRole("button", { name: "Document" }).click();
  await expect(role.getByRole("button", { name: "Document" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:linear"))?.props.role).toBe("document");
  // A role is not a new version: the shape keeps its file.
  expect((await settledRecord(engine, "default", "shape:linear"))?.props.file).toBe("1-linear.md");
  const card = shapeOnScreen(page, "shape:linear").getByTestId("style-card");
  await expect(card).toHaveAttribute("data-role", "document");
  await expect(card.getByTestId("style-swatches")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(window).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  // Back to the props it had: no role, which reads as a style.
  await expect.poll(async () => (await settledRecord(engine, "default", "shape:linear"))?.props.role).toBeUndefined();
  await expect(card).toHaveAttribute("data-role", "style");
  await expect(card.locator("[data-swatch]")).toHaveCount(1);
});

test("the read view shows the document first, its front matter folded under Details and wrapped, and a save keeps the front matter byte for byte", async ({ page, engine }) => {
  const frontMatter = `---\nname: Linear\ndescription: "${"A near-black product-focused marketing canvas built around one lavender accent, ".repeat(3).trim()}"\ncolors:\n  primary: "#5e6ad2"\n---\n`;
  await openCanvas(page, engine);
  await writeFile(projectPath(engine, "1-linear.md"), `${frontMatter}${LINEAR}`);
  await putRecords(engine, [styleRecord("shape:linear", "300", { x: 620, y: 80 }, "1-linear.md", "Linear")]);
  await expect(shapeOnScreen(page, "shape:linear")).toBeVisible();
  await clickShape(page, "shape:linear");
  await toolbar(page).getByRole("button", { name: "Open" }).click();
  const window = page.getByTestId("style-window");
  const read = window.getByTestId("style-read");
  await expect(read).toContainText("Calm and dense, for focused work.");
  await expect(read).not.toContainText("near-black product-focused");
  await expect(read.locator("pre, code").first()).toHaveCount(0);

  await window.getByRole("button", { name: "Details" }).click();
  const yaml = window.getByTestId("style-front-matter");
  await expect(yaml).toContainText('primary: "#5e6ad2"');
  await expect(yaml).toContainText("near-black product-focused");
  expect(await yaml.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // The document comes before Details.
  const [bodyTop, detailsTop] = await Promise.all([read.getByText("Calm and dense, for focused work.").boundingBox(), window.getByTestId("style-details").boundingBox()]);
  expect(bodyTop!.y).toBeLessThan(detailsTop!.y);

  await window.getByRole("button", { name: "Edit" }).click();
  await window.getByTestId("style-editor").getByText("Calm and dense, for focused work.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Never loud.");
  await window.getByRole("button", { name: "Save" }).click();
  const saved = await waitForRoom(engine, "default", (records) => {
    const shape = records.find((record) => record.id === "shape:linear");
    return shape && shape.props.file !== "1-linear.md" ? shape : undefined;
  });
  const text = await readFile(projectPath(engine, saved.props.file), "utf8");
  expect(text.startsWith(frontMatter)).toBe(true);
  expect(text).toContain("Never loud.");
});

test.describe("a chat's style", () => {
  test("selecting a style and sending attaches it to the chat as a chip, and Detach takes it off with an Undo", async ({ page }) => {
    const script = await scriptFolder({ styled: { when: "^make", turns: [{ text: "Following Linear." }] } });
    const agent = await startAgentEngine({ script });
    try {
      await openCanvas(page, agent);
      await writeFile(projectPath(agent, "1-linear.md"), LINEAR);
      await putRecords(agent, [styleRecord("shape:linear", "300", { x: 620, y: 80 }, "1-linear.md", "Linear")]);
      await expect(shapeOnScreen(page, "shape:linear")).toBeVisible();
      await clickShape(page, "shape:linear");
      const panel = await openRail(page);
      await say(panel, "make a landing page");
      await expect(panel.locator("[data-role='assistant']")).toContainText("Following Linear.");
      const chip = rail(page).getByTestId("chat-style");
      await expect(chip.getByTestId("chat-style-label")).toHaveText("Linear");
      // The settled turn's work log says which style the chat now follows.
      await panel.getByTestId("worked-for").getByRole("button").click();
      await expect(panel.getByTestId("work-row-label")).toHaveText(["Following the style “Linear”"]);
      const chat = await onlyChat(agent, (current) => current.style === "shape:linear");

      await chip.getByRole("button", { name: "Detach Linear" }).click();
      await expect(chip).toHaveCount(0);
      await expect.poll(async () => (await engineChat(agent, chat.id)).style).toBeNull();
      await expect(toast(page, "Detached the style Linear")).toBeVisible();
      // The toast sits right of the rail, clear of the composer and its send row.
      const toastBox = (await toast(page, "Detached the style Linear").boundingBox())!;
      const railBox = (await panel.boundingBox())!;
      expect(toastBox.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
      await page.locator("[data-slot='toast-action']").filter({ hasText: "Undo" }).click();
      await expect(rail(page).getByTestId("chat-style-label")).toHaveText("Linear");
      await expect.poll(async () => (await engineChat(agent, chat.id)).style).toBe("shape:linear");
    } finally {
      await agent.dispose();
    }
  });
});

test("a selected document sent to the agent is material, never the chat's style: no chip appears", async ({ page }) => {
  const script = await scriptFolder({ notes: { when: "^summarise", turns: [{ text: "Read the notes." }] } });
  const agent = await startAgentEngine({ script });
  try {
    await openCanvas(page, agent);
    await writeFile(projectPath(agent, "1-notes.md"), NOTES);
    await putRecords(agent, [styleRecord("shape:notes", "300", { x: 620, y: 80 }, "1-notes.md", "Standup notes", { role: "document" })]);
    await expect(shapeOnScreen(page, "shape:notes")).toBeVisible();
    await clickShape(page, "shape:notes");
    const panel = await openRail(page);
    await say(panel, "summarise these notes");
    await expect(panel.locator("[data-role='assistant']")).toContainText("Read the notes.");
    const chat = await onlyChat(agent, (current) => current.turns.length === 1);
    expect(chat.style).toBeNull();
    await expect(rail(page).getByTestId("chat-style")).toHaveCount(0);
  } finally {
    await agent.dispose();
  }
});

test("the work log line naming the chat's style wraps rather than cutting a long title short", async ({ page }) => {
  const script = await scriptFolder({ styled: { when: "^make", turns: [{ text: "Done." }] } });
  const agent = await startAgentEngine({ script });
  try {
    const title = "Linear, calm and dense, for focused product work";
    await openCanvas(page, agent);
    await writeFile(projectPath(agent, "1-linear.md"), LINEAR);
    await putRecords(agent, [styleRecord("shape:linear", "300", { x: 620, y: 80 }, "1-linear.md", title)]);
    await expect(shapeOnScreen(page, "shape:linear")).toBeVisible();
    await clickShape(page, "shape:linear");
    const panel = await openRail(page);
    await say(panel, "make a landing page");
    await expect(panel.locator("[data-role='assistant']")).toContainText("Done.");
    await panel.getByTestId("worked-for").getByRole("button").click();
    const label = panel.getByTestId("work-row-label");
    await expect(label).toHaveText([`Following the style “${title}”`]);
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().height > 30)).toBe(true);
  } finally {
    await agent.dispose();
  }
});
